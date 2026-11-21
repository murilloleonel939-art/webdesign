import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { validateSiteDocument } from "@webdesign/site-schema";
import {
  CopyUnavailableError,
  PENDING_MARKER,
  copyPrompt,
  draftSite,
  guardCopy,
  normalizeBrief,
  runFastDesign,
  siteCopySchema,
} from "../dist/index.js";

// Textos del modelo (spec 9.1, `generate_copy`).
//
// Lo que se prueba aquí no es "el modelo escribe bonito", sino que NADA inventado
// llega al sitio: la guardia es determinista y se ejecuta aunque el modelo ignore
// el encargo. Sin red: el transporte es falso, como en el resto del paquete.

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [
    { type: "hero" },
    { type: "text" },
    { type: "features" },
    { type: "testimonial" },
    { type: "pricing" },
    { type: "faq" },
    { type: "cta" },
  ],
  dials: { variance: 5, motion: 4, density: 5 },
};

const BRIEF = {
  businessType: "cafetería de especialidad",
  name: "Café Aurora",
  city: "Valencia",
  service: "tueste propio y desayunos",
  contact: "hola@cafeaurora.test",
};

const BUDGET = { maxTokens: 100_000, maxToolCalls: 5, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 24_000 };
const CTX = { runId: "copy", userId: "u1", token: "t", locale: "es", apiBaseUrl: "http://x" };

/** Copy válido mínimo: pasa el esquema sin tocar la guardia. */
function validCopy(over = {}) {
  return {
    businessName: "Café Aurora",
    businessType: "cafetería de especialidad",
    heroHeadline: "Café de especialidad en el centro de Valencia",
    heroSubline: "Tostamos cada semana y servimos desayunos hasta mediodía.",
    heroCta: "Escríbenos",
    servicesHeading: "Qué hacemos",
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa cada semana." },
      { title: "Desayunos", body: "Preparamos desayunos hasta media mañana." },
      { title: "Café para llevar", body: "Te lo servimos para que te lo lleves." },
    ],
    processHeading: "Cómo trabajamos",
    process: [
      { title: "Nos escribes", body: "Cuéntanos qué necesitas." },
      { title: "Elegimos contigo", body: "Vemos juntos la mejor opción." },
      { title: "Nos vemos", body: "Pasas por la cafetería cuando quieras." },
    ],
    aboutHeading: "Quiénes somos",
    aboutBody: "Somos una cafetería de barrio que tuesta su propio café en Valencia.",
    faq: [
      { q: "¿Cómo puedo encargar?", a: "Escríbenos por correo y te contestamos." },
      { q: "¿Dónde estáis?", a: "En el centro de Valencia; escribe y te orientamos." },
    ],
    closingHeadline: "Hablemos de tu próximo café",
    closingCta: "Escribir",
    seoDescription: "Cafetería de especialidad en Valencia con tueste propio y desayunos.",
    ...over,
  };
}

/** Transporte falso: devuelve `text` en cada llamada. */
function fakeClient(text) {
  const tracker = new BudgetTracker(BUDGET);
  const transport = {
    provider: "fake",
    calls: 0,
    async complete() {
      this.calls += 1;
      return {
        text,
        toolCalls: [],
        finishReason: "stop",
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
        model: "fake",
        latencyMs: 1,
      };
    },
  };
  return { client: new LlmClient(transport, tracker), tracker, transport };
}

test("copy: el esquema acepta un ejemplo válido y rechaza lo que se sale", () => {
  assert.equal(siteCopySchema.safeParse(validCopy()).success, true);
  // Titular demasiado corto: no dice nada y el esquema lo rechaza.
  assert.equal(siteCopySchema.safeParse(validCopy({ heroHeadline: "Hola" })).success, false);
  // Menos de tres servicios no es una lista de servicios.
  assert.equal(siteCopySchema.safeParse(validCopy({ services: [] })).success, false);
});

test("copy: el encargo pide JSON y prohíbe los datos inventados", () => {
  const p = copyPrompt(normalizeBrief(BRIEF));
  assert.match(p, /SOLO con un objeto JSON/i);
  assert.match(p, /No inventes cifras, anos, porcentajes/i);
  assert.match(p, /premios/i);
  assert.match(p, /precios/i);
  // El texto libre del dueño viaja como contexto, no como dato a copiar.
  assert.match(copyPrompt(normalizeBrief({ ...BRIEF, description: "trabajo desde 2019" })), /2019/);
});

test("copy: la guardia elimina un servicio con '15 años' y un titular con '100%'", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = validCopy({
    heroHeadline: "100% café de especialidad en Valencia",
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa." },
      { title: "Experiencia", body: "Llevamos 15 años detrás de la barra." },
      { title: "Café para llevar", body: "Te lo servimos para llevar." },
    ],
  });
  const out = guardCopy(copy, brief);
  // El servicio inventado se cae y el titular se sustituye por el del brief.
  assert.equal(out.dropped.includes("services[1]"), true);
  // No se repone el hueco: quedan los dos validos y ningun marcador.
  assert.equal(out.copy.services.length, 2, "se queda con los servicios validos");
  assert.deepEqual(out.copy.services.map((s) => s.title), ["Tueste propio", "Café para llevar"]);
  assert.doesNotMatch(JSON.stringify(out.copy), /pendiente de confirmar/);
  assert.equal(out.copy.heroHeadline, "Café Aurora");
  assert.doesNotMatch(JSON.stringify(out.copy), /15 años|100%/);
});

test("copy: dos servicios validos llegan al borrador como dos ventajas y sin marcador", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      services: [
        { title: "Tueste propio", body: "Tostamos el grano en casa cada semana." },
        { title: "Desayunos", body: "Preparamos desayunos hasta media mañana." },
      ],
    }),
    brief,
  ).copy;
  assert.equal(copy.services.length, 2);
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.equal(features.props.items.length, 2);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar/);
});

test("copy: el tercer servicio con una cifra inventada se poda y quedan los otros dos", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      services: [
        { title: "Tueste propio", body: "Tostamos el grano en casa cada semana." },
        { title: "Desayunos", body: "Preparamos desayunos hasta media mañana." },
        { title: "Clientes", body: "Atendemos a 500 clientes cada semana." },
      ],
    }),
    brief,
  ).copy;
  assert.equal(copy.services.length, 2);
  const doc = draftSite(brief, PRESET, copy);
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.equal(features.props.items.length, 2);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar|500 clientes/);
});

test("copy: una cifra que el dueño escribió se permite", () => {
  const brief = normalizeBrief({ ...BRIEF, description: "abrimos a las 8 y tenemos 3 mesas en la terraza" });
  const out = guardCopy(validCopy({ heroSubline: "Abrimos a las 8 con 3 mesas en la terraza." }), brief);
  assert.equal(out.copy.heroSubline, "Abrimos a las 8 con 3 mesas en la terraza.");
  assert.deepEqual(out.dropped, []);
});

test("copy: los reclamos sin cifra también se caen y el about se queda vacío", () => {
  const out = guardCopy(validCopy({ aboutBody: "Somos la empresa líder del sector y estamos certificados." }), normalizeBrief(BRIEF));
  // Sin texto propio no se escribe el marcador: cadena vacía y la sección se omite.
  assert.equal(out.copy.aboutBody, "");
  assert.equal(out.dropped.includes("aboutBody"), true);
  // El SEO no cae al marcador: baja al subtitular del hero, que sí es del copy.
  assert.equal(out.copy.seoDescription, out.copy.heroSubline);
});

test("copy: con aboutBody podado no hay sección about en el documento", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy({ aboutBody: "Somos la empresa líder del sector." }), brief).copy;
  assert.equal(copy.aboutBody, "");
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  assert.equal(doc.pages[0].sections.some((s) => s.type === "text"), false);
});

test("draftSite con copy: features con 3+, titular del copy, sin testimonio ni precio", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy(), brief).copy;
  const doc = draftSite(brief, PRESET, copy);

  assert.equal(validateSiteDocument(doc).ok, true);
  const types = doc.pages[0].sections.map((s) => s.type);
  assert.equal(types.includes("testimonial"), false, "no se inventa un testimonio");
  assert.equal(types.includes("pricing"), false, "no se inventa un precio");

  const hero = doc.pages[0].sections.find((s) => s.type === "hero");
  assert.equal(hero.props.headline, copy.heroHeadline);
  assert.equal(hero.props.cta.label, copy.heroCta);

  const features = doc.pages[0].sections.filter((s) => s.type === "features");
  assert.equal(features[0].props.items.length >= 3, true);
  // El proceso va SIEMPRE detrás de las ventajas, con id propio.
  assert.ok(features.some((s) => s.id === "s_process"));
  assert.equal(doc.pages[0].seo.description, copy.seoDescription);
  assert.equal(doc.meta.name, "Café Aurora");
});

test("draftSite con copy y brief de solo description: ninguna sección visible lleva el marcador", () => {
  // El brief no trae mas que la descripcion: businessType, name, city, service y
  // contact quedan con el marcador, y `design.brief` (draft.ts:224) lo guarda
  // como frase del brief. Lo visible es `doc.pages`, y ahi no puede estar.
  const brief = normalizeBrief({ description: "somos una tienda de barrio que abre todos los dias" });
  const copy = guardCopy(validCopy({ businessName: "Café Aurora" }), brief).copy;
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  assert.match(doc.design.brief, /pendiente de confirmar/);
  assert.doesNotMatch(JSON.stringify(doc.pages), /pendiente de confirmar/);
});

test("draftSite sin copy: el comportamiento de antes sigue intacto", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET);
  assert.equal(validateSiteDocument(doc).ok, true);
  // Sin copy no hay ventajas: se degradan a texto con el marcador.
  assert.equal(doc.pages[0].sections.some((s) => s.type === "features"), false);
  assert.equal(doc.pages[0].sections.some((s) => s.type === "testimonial"), false);
  assert.match(JSON.stringify(doc), /pendiente de confirmar/);
});

test("runFastDesign: un client que devuelve JSON válido usa el copy", async () => {
  const { client, tracker, transport } = fakeClient(JSON.stringify(validCopy()));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(transport.calls, 2);
  assert.equal(out.warnings.includes("copy_fallback"), false);
  const types = out.doc.pages[0].sections.map((s) => s.type);
  assert.ok(types.includes("features"));
  assert.equal(types.includes("testimonial"), false);
});

test("runFastDesign: JSON envuelto en ```json también se acepta", async () => {
  const { client, tracker } = fakeClient("Aquí tienes:\n```json\n" + JSON.stringify(validCopy()) + "\n```\n");
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(out.warnings.includes("copy_fallback"), false);
});

test("runFastDesign: con JSON roto cae a copy_fallback y sigue con marcadores", async () => {
  const { client, tracker } = fakeClient("{ esto no es json valido");
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.ok(out.warnings.some((w) => w.startsWith("copy_fallback")), `warnings: ${out.warnings}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
  assert.match(JSON.stringify(out.doc), /pendiente de confirmar/);
});

/** Transporte falso que devuelve una respuesta distinta por llamada (cicla la última). */
function sequencedClient(replies) {
  const tracker = new BudgetTracker(BUDGET);
  let n = 0;
  const transport = {
    provider: "fake",
    calls: 0,
    async complete() {
      this.calls += 1;
      const r = replies[Math.min(n, replies.length - 1)];
      n += 1;
      return {
        text: r.text,
        toolCalls: [],
        finishReason: r.finishReason ?? "stop",
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
        model: "fake",
        latencyMs: 1,
      };
    },
  };
  return { client: new LlmClient(transport, tracker), tracker, transport };
}

test("runFastDesign: JSON valido envuelto en prosa (sin bloque de codigo) tambien se acepta", async () => {
  const text = `Aquí tienes los textos que pediste.\n${JSON.stringify(validCopy())}\nEspero que te sirvan.`;
  const { client, tracker } = fakeClient(text);
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), false, `warnings: ${out.warnings}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

test("runFastDesign: un heroSubline de 400 caracteres se recorta y el copy vale", async () => {
  const largo = "Café de especialidad tostado en casa, servido cada mañana con calma para quien llega al centro de Valencia a desayunar o a hacer una pausa, disfrutando del aroma recien molido en un ambiente tranquilo pensado para quedarse un rato charlando con amigos o trabajando".padEnd(400, ".");
  assert.equal(largo.length, 400);
  const { client, tracker } = fakeClient(JSON.stringify(validCopy({ heroSubline: largo })));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), false, `warnings: ${out.warnings}`);
  const hero = out.doc.pages[0].sections.find((s) => s.type === "hero");
  assert.ok(hero.props.subline.length <= 220, `subline: ${hero.props.subline.length}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

test("runFastDesign: primer intento con JSON cortado y segundo valido -> copy valido y dos llamadas de copy", async () => {
  const broken = '{ "heroHeadline": "Café de especialidad en Valencia", "services": [ { "title": "a"';
  const { client, tracker, transport } = sequencedClient([
    { text: broken },
    { text: JSON.stringify(validCopy()) },
    { text: "Resumen final." },
  ]);
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), false, `warnings: ${out.warnings}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
  // Dos llamadas de copy (intento + reintento con JSON cortado) y una del resumen.
  assert.equal(transport.calls, 3, "intento + reintento del copy, mas el resumen de la ronda");
});

test("runFastDesign: dos intentos rotos con brief de solo description lanza CopyUnavailableError", async () => {
  const { client, tracker, transport } = fakeClient("no es json en absoluto");
  const brief = { description: "somos una tienda de barrio que abre todos los dias" };
  await assert.rejects(
    runFastDesign({ brief, presets: [PRESET], client, tracker, ctx: CTX }),
    (err) => err instanceof CopyUnavailableError,
  );
  assert.equal(transport.calls, 2, "agota el intento y el reintento antes de lanzar");
});

test("runFastDesign: sin ningun servicio valido el copy no sirve (empty_services)", async () => {
  // Los dos servicios llevan cifras que el dueño no dio: la guardia los poda
  // todos y no queda `features`. Eso es copy no disponible, no una seccion vacia.
  const { client, tracker, transport } = fakeClient(
    JSON.stringify(
      validCopy({
        services: [
          { title: "Clientes", body: "Atendemos a 500 clientes cada semana." },
          { title: "Experiencia", body: "Llevamos 15 años detrás de la barra." },
        ],
      }),
    ),
  );
  const brief = { description: "somos una tienda de barrio que abre todos los dias" };
  await assert.rejects(
    runFastDesign({ brief, presets: [PRESET], client, tracker, ctx: CTX }),
    (err) => err instanceof CopyUnavailableError && /empty_services/.test(err.message),
  );
  assert.equal(transport.calls, 2, "empty_services es motivo de lectura: se reintenta una vez");
});
