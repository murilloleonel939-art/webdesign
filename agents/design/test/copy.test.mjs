import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { validateSiteDocument } from "@webdesign/site-schema";
import {
  PENDING_MARKER,
  copyPrompt,
  draftSite,
  genericCopy,
  guardCopy,
  normalizeBrief,
  planSections,
  retryLine,
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

// Brief que clasifica como landing (T-003.3): las pruebas de completitud de
// una sola página (T-002.6) necesitan un brief que no dispare la rama site.
const BRIEF_LANDING = {
  businessType: "diseño web",
  name: "Studio Aurora",
  city: "Valencia",
  service: "webs y branding",
  contact: "hola@studioaurora.test",
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

test("copy: dos servicios validos no llegan al minimo y la seccion pasa entera a la generica", () => {
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
  // La guardia no cambia: sigue dejando los dos servicios validos.
  assert.equal(copy.services.length, 2);
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  // Cambiado en T-002.3 (completitud por seccion): antes el documento publicaba
  // 2 tarjetas. Con menos de 3 la seccion se sustituye ENTERA por la generica;
  // no se mezclan las dos del modelo con una de plantilla.
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.deepEqual(features.props.items, genericCopy(brief).services);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar/);
});

test("copy: el tercer servicio con una cifra inventada se poda y la seccion pasa a la generica", () => {
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
  // La guardia no cambia: poda el tercero y quedan los otros dos (A3).
  assert.equal(copy.services.length, 2);
  const doc = draftSite(brief, PRESET, copy);
  // Cambiado en T-002.3: el documento ya no publica 2 tarjetas; la seccion es
  // la generica completa. Lo inventado sigue sin llegar al sitio.
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.deepEqual(features.props.items, genericCopy(brief).services);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar|500 clientes/);
});

test("copy: una cifra que el dueño escribió se permite", () => {
  const brief = normalizeBrief({ ...BRIEF, description: "abrimos a las 8 y tenemos 3 mesas en la terraza" });
  const out = guardCopy(validCopy({ heroSubline: "Abrimos a las 8 con 3 mesas en la terraza." }), brief);
  assert.equal(out.copy.heroSubline, "Abrimos a las 8 con 3 mesas en la terraza.");
  assert.deepEqual(out.dropped, []);
});

test("copy: los reclamos sin cifra también se caen y el about se queda vacío", () => {
  const input = validCopy({ aboutBody: "Somos la empresa líder del sector y estamos certificados." });
  const out = guardCopy(input, normalizeBrief(BRIEF));
  // Sin texto propio no se escribe el marcador: cadena vacía y la sección se omite.
  assert.equal(out.copy.aboutBody, "");
  assert.equal(out.dropped.includes("aboutBody"), true);
  // El SEO no se recalcula porque el about se pode: la descripcion del modelo
  // ("Cafeteria de especialidad en Valencia con tueste propio y desayunos") no
  // lleva ningun invento y se conserva tal cual (ADR 0002, decision 2). Solo cae
  // al subtitular cuando es la propia `seoDescription` la que se poda.
  assert.equal(out.copy.seoDescription, input.seoDescription);
  assert.equal(out.dropped.includes("seoDescription"), false);
  // No se sustituye por el subtitular cuando no hay nada que podar.
  assert.notEqual(out.copy.seoDescription, out.copy.heroSubline);
  // Y en ningun caso queda vacia ni con el marcador.
  assert.notEqual(out.copy.seoDescription, "");
  assert.doesNotMatch(out.copy.seoDescription, /pendiente de confirmar/);
});

test("copy: con aboutBody podado la sección about es la genérica entera", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy({ aboutBody: "Somos la empresa líder del sector." }), brief).copy;
  // La guardia no cambia: el about del modelo se queda vacío.
  assert.equal(copy.aboutBody, "");
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  // T-003.3: con shape=site el about vive en /sobre-nosotros, no en la portada.
  // Cambiado en T-002.3: antes la sección se omitía. Ahora el documento lleva el
  // about genérico completo, encabezado incluido.
  const pgSobre = doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const about = pgSobre.sections.find((s) => s.type === "text");
  const generic = genericCopy(brief);
  assert.deepEqual(about.props, { heading: generic.aboutHeading, body: generic.aboutBody });
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
  // Con shape site (BRIEF de cafetería) el proceso vive en /servicios, con sus
  // 3 pasos y con id propio; en la portada no se duplica.
  const servicios = doc.pages.find((p) => p.slug === "/servicios");
  assert.ok(servicios, "la página /servicios existe");
  const proceso = servicios.sections.filter((s) => s.type === "features").find((s) => s.id === "s_process");
  assert.ok(proceso, "el proceso está en /servicios");
  assert.equal(proceso.props.items.length >= 3, true, "los 3 pasos siguen en /servicios");
  assert.ok(!doc.pages[0].sections.some((s) => s.id === "s_process"), "la portada no duplica el proceso");
  assert.equal(doc.pages[0].seo.description, copy.seoDescription);
  assert.equal(doc.meta.name, "Café Aurora");
});

test("draftSite con copy y brief de solo description: el documento entero va sin marcador", () => {
  // El brief no trae mas que la descripcion: businessType, name, city, service y
  // contact quedan pendientes. Cambiado en T-002.3: antes se aceptaba el marcador
  // en `design.brief`, pero `design.brief` viaja dentro del documento entregado y
  // B1 lo mira entero, no solo `doc.pages`.
  const brief = normalizeBrief({ description: "somos una tienda de barrio que abre todos los dias" });
  const copy = guardCopy(validCopy({ businessName: "Café Aurora" }), brief).copy;
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar/, "ni en pages ni en design.brief");
  // Lo que el dueño sí dijo (su descripcion libre) no se pierde.
  assert.match(doc.design.brief, /tienda de barrio/);
});

test("draftSite sin copy: usa el copy generico y entrega un sitio completo", () => {
  // Cambiado en T-002.3: antes esta prueba fijaba que sin copy no había ventajas
  // y que el marcador aparecía. Eso es justo lo que B1/B2 prohíben.
  // T-003.3: con BRIEF de cafetería el doc es shape=site (4 páginas).
  const doc = draftSite(normalizeBrief(BRIEF), PRESET);
  assert.equal(validateSiteDocument(doc).ok, true);
  assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar/);
  // B2 por documento (T-003.3): las secciones están repartidas entre páginas.
  const allSections = doc.pages.flatMap((p) => p.sections);
  assert.ok(allSections.some((s) => s.type === "features"), "B2: hay ventajas");
  assert.ok(allSections.some((s) => s.type === "text"), "B2: hay about");
  assert.equal(allSections.some((s) => s.type === "testimonial"), false, "sin testimonio inventado");
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

test("runFastDesign: con JSON roto cae a copy_fallback y entrega el sitio igual", async () => {
  // Cambiado en T-002.3: antes el respaldo del copy dejaba marcadores en el
  // sitio. Ahora cae a `genericCopy`: el aviso queda para el panel y la página
  // se entrega completa y publicable.
  const { client, tracker } = fakeClient("{ esto no es json valido");
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.ok(out.warnings.some((w) => w.startsWith("copy_fallback")), `warnings: ${out.warnings}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
  assert.doesNotMatch(JSON.stringify(out.doc), /pendiente de confirmar/);
  assert.ok(out.doc.pages[0].sections.some((s) => s.type === "features"));
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

test("copy: el reintento por empty_services dice que se podaron datos, no que no se leyo", () => {
  // La guardia no tuvo un fallo de lectura: descarto los servicios por inventos.
  // Decirle "no se pudo leer" hace que el modelo repita la misma cifra.
  const line = retryLine("empty_services");
  assert.match(line, /cifras/i);
  assert.doesNotMatch(line, /no se pudo leer/i);
  // Sigue pidiendo solo el JSON y mas corto.
  assert.match(line, /SOLO el objeto JSON/);
  assert.match(line, /mas corto/i);
});

test("copy: el reintento por schema conserva el texto de lectura", () => {
  const line = retryLine("schema:services,faq");
  assert.match(line, /no se pudo leer/i);
  // No se nombra la guardia ni los datos podados: ahi no hubo poda.
  assert.doesNotMatch(line, /empty_services|guardia|descart/i);
  assert.doesNotMatch(line, /cifras|premios|certificaciones/i);
});

test("copy: cualquier otro motivo cae en el texto de lectura, sin inventar la causa", () => {
  const line = retryLine("otra_cosa");
  assert.match(line, /no se pudo leer/i);
  assert.doesNotMatch(line, /cifras|descart/i);
});

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

test("runFastDesign: dos intentos rotos con brief de solo description entrega la pagina y avisa copy_fallback", async () => {
  // Antes esto abortaba con CopyUnavailableError; ya no: el sistema entrega la
  // pagina terminada (copy generico) y el cliente decide que cambiar.
  const { client, tracker, transport } = fakeClient("no es json en absoluto");
  const brief = { description: "somos una tienda de barrio que abre todos los dias" };
  const out = await runFastDesign({ brief, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(validateSiteDocument(out.doc).ok, true);
  assert.doesNotMatch(JSON.stringify(out.doc), /pendiente de confirmar/);
  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), true, `warnings: ${out.warnings}`);
  assert.equal(transport.calls, 3, "intento + reintento del copy y resumen; la recomendacion es un handler en proceso");
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
  // Antes esto abortaba con CopyUnavailableError; ya no: se avisa copy_fallback y
  // el sitio sale con copy generico, sin tarjetas podadas ni marcador.
  const out = await runFastDesign({ brief, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(validateSiteDocument(out.doc).ok, true);
  assert.doesNotMatch(JSON.stringify(out.doc), /pendiente de confirmar|500 clientes|15 años/);
  assert.equal(
    out.warnings.some((w) => w.startsWith("copy_fallback") && /empty_services/.test(w)),
    true,
    `warnings: ${out.warnings}`,
  );
  assert.equal(transport.calls, 3, "empty_services es motivo de lectura: un reintento, y luego sigue hasta el resumen");
});

// --- T-002.3: el marcador fuera del sitio (criterios B1 y B2) ----------------

/**
 * Diez briefs distintos: desde uno vacio de campos hasta el que los trae todos,
 * pasando por los que solo dan un dato, con acentos, contactos raros y nombres
 * con cifras. Todos tienen que salir sin el marcador (B1) y con copy completo
 * (B2). Se prueban por los dos caminos: sin copy del modelo (genérico) y con un
 * copy valido del modelo.
 */
const BRIEFS_B1 = [
  { description: "somos una tienda de barrio que abre todos los dias" },
  { name: "Café Aurora" },
  { name: "Café 2019", city: "Valencia" },
  { businessType: "cafetería de especialidad", name: "Café Aurora", city: "Valencia" },
  { businessType: "peluquería canina", city: "Alcalá de Henares" },
  { businessType: "clínica dental", name: "Clínica Sonrisa", city: "Sevilla", service: "implantes" },
  { businessType: "abogado", name: "Despacho Romero", city: "Madrid", service: "derecho laboral", contact: "+34 600 333 444" },
  { businessType: "taller", name: "Taller Norte", city: "Bilbao", service: "chapa y pintura", contact: "hola@taller.test" },
  { name: "Bar Pepe", service: "menú del día" },
  { businessType: "floristería", service: "ramos por encargo", contact: "600 123 456" },
];

for (const [i, entrada] of BRIEFS_B1.entries()) {
  test(`B1/B2 (brief ${i + 1}): el documento va sin marcador y con copy completo`, () => {
    const brief = normalizeBrief(entrada);
    for (const conCopy of [false, true]) {
      const copy = conCopy ? guardCopy(validCopy(), brief).copy : undefined;
      const doc = draftSite(brief, PRESET, copy);
      assert.equal(validateSiteDocument(doc).ok, true);
      // B1: ni en las secciones ni en ninguna parte del documento entregado.
      assert.doesNotMatch(JSON.stringify(doc), /pendiente de confirmar/, `brief ${i + 1}, conCopy=${conCopy}`);
      // B2 por documento (T-003.3): las secciones pueden estar repartidas entre
      // páginas (shape=site) o en una sola (landing). Se suma sobre todas.
      const allSections = doc.pages.flatMap((p) => p.sections).filter((s) => s.id !== "s_process");
      const features = allSections.find((s) => s.type === "features");
      assert.ok(features, `brief ${i + 1}: hay ventajas`);
      assert.ok(features.props.items.length >= 3, `servicios: ${features.props.items.length}`);
      const about = allSections.find((s) => s.type === "text");
      assert.ok(about, `brief ${i + 1}: hay about`);
      assert.notEqual(about.props.body.trim(), "", `brief ${i + 1}: el about no esta vacio`);
      const faq = allSections.find((s) => s.type === "faq");
      assert.ok(faq, `brief ${i + 1}: hay faq`);
      assert.ok(faq.props.items.length >= 2, `faq: ${faq.props.items.length}`);
    }
  });
}

// Cambio 1: la guardia confia en los campos que el dueño relleno.
test("guardia: el nombre con cifra que escribio el dueño no se poda", () => {
  // Sin descripcion: antes el corpus era solo `description`, asi que el nombre
  // del propio dueño se tomaba por inventado y se caia a un titular generico.
  const brief = normalizeBrief({ name: "Café 2019", city: "Valencia" });
  const out = guardCopy(validCopy({ heroHeadline: "Café 2019 en Valencia" }), brief);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.copy.heroHeadline, "Café 2019 en Valencia");
  // Y el dato del dueño llega al sitio, no solo al copy.
  const doc = draftSite(brief, PRESET, out.copy);
  assert.match(JSON.stringify(doc), /Café 2019/);
});

test("guardia: el corpus son todos los campos que describen el negocio", () => {
  const brief = normalizeBrief({ businessType: "taller", city: "Bilbao", service: "revisiones cada 20000 km" });
  // Cambiado en T-002.5: `contact` sale del corpus numérico. Un teléfono o un
  // correo no autorizan cifras de plazo, cantidad ni año (hallazgo 1 de
  // seguridad). Se prueba aparte, más abajo, con su propio caso.
  for (const campo of ["name", "city", "service", "businessType", "description"]) {
    const entrada = { businessType: "taller", city: "Bilbao", service: "revisiones", contact: "hola@taller.test", name: "Taller Norte" };
    const conDato = normalizeBrief({ ...entrada, [campo]: "llevamos 3 anos" });
    const out = guardCopy(validCopy({ heroSubline: "Llevamos 3 anos en el barrio." }), conDato);
    assert.deepEqual(out.dropped, [], `campo ${campo}: la cifra la escribio el dueño`);
    assert.equal(out.copy.heroSubline, "Llevamos 3 anos en el barrio.");
  }
  // Control: la misma cifra sin que la diga nadie SI se poda.
  const sinDato = guardCopy(validCopy({ heroSubline: "Llevamos 3 anos en el barrio." }), brief);
  assert.equal(sinDato.dropped.includes("heroSubline"), true);
});

test("guardia: un reclamo se poda aunque el dueño lo escriba (CLAIM no se ablanda)", () => {
  const brief = normalizeBrief({
    businessType: "cafetería",
    name: "Café Aurora",
    city: "Valencia",
    description: "somos lideres del sector y estamos certificados",
  });
  const out = guardCopy(validCopy({ aboutBody: "Somos líderes del sector" }), brief);
  assert.equal(out.dropped.includes("aboutBody"), true, "el reclamo se poda aunque venga del dueño");
  assert.notEqual(out.copy.aboutBody, "Somos líderes del sector");
  // El plural y las formas flexionadas cuentan: "lideres" no es una excepcion.
  for (const texto of ["Somos líderes del sector", "Somos lideres", "Equipo premiado", "Productos certificados", "Resultado garantizado"]) {
    assert.equal(guardCopy(validCopy({ aboutBody: texto }), brief).dropped.includes("aboutBody"), true, `deberia podarse: ${texto}`);
  }
});

// Cambio 3: los avisos son del intento que gana, no del que se descarta.
test("runFastDesign: los avisos de guardia del intento descartado no llegan al panel", async () => {
  // Primer intento: todos los servicios con cifras inventadas -> la guardia los
  // poda (aviso `copy_guard`) y el copy se descarta por `empty_services`.
  // Segundo intento: copy limpio. Solo este llega al sitio, y no tiene podas.
  const { client, tracker, transport } = sequencedClient([
    {
      text: JSON.stringify(
        validCopy({
          services: [
            { title: "Clientes", body: "Atendemos a 500 clientes cada semana." },
            { title: "Experiencia", body: "Llevamos 15 años detrás de la barra." },
            { title: "Premios", body: "Somos líderes del sector." },
          ],
        }),
      ),
    },
    { text: JSON.stringify(validCopy()) },
    { text: "Resumen final." },
  ]);
  const brief = normalizeBrief({ name: "Café Aurora", businessType: "cafetería", city: "Valencia", service: "tueste propio", contact: "hola@cafe.test" });
  const out = await runFastDesign({ brief, presets: [PRESET], client, tracker, ctx: CTX });
  assert.equal(transport.calls, 3, "intento descartado + reintento + resumen");
  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), false, "el segundo intento salvo el copy");
  assert.equal(out.warnings.some((w) => w.startsWith("copy_guard")), false, `warnings: ${out.warnings}`);
  // Y el copy que se publica no lleva nada del intento descartado.
  assert.doesNotMatch(JSON.stringify(out.doc), /500 clientes|15 años|líderes/);
});

test("runFastDesign: si el copy que gana tiene podas, el aviso SI llega", async () => {
  // Control del caso anterior: sin este, el test de arriba pasaria tambien si
  // el aviso se hubiera perdido siempre. El copy gana (le quedan 2 servicios
  // validos) y arrastra un aviso por el que se podo.
  const { client, tracker } = sequencedClient([
    {
      text: JSON.stringify(
        validCopy({
          services: [
            { title: "Tueste propio", body: "Tostamos el grano en casa cada semana." },
            { title: "Desayunos", body: "Preparamos desayunos hasta media mañana." },
            { title: "Clientes", body: "Atendemos a 500 clientes cada semana." },
          ],
        }),
      ),
    },
    { text: "Resumen final." },
  ]);
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });
  assert.ok(out.warnings.some((w) => w.startsWith("copy_guard: services[2]")), `warnings: ${out.warnings}`);
  // Con 2 servicios validos la seccion pasa entera a la generica (T-002.3); el
  // aviso sigue llegando porque la poda ocurrio en el copy que gano.
  assert.deepEqual(
    out.doc.pages[0].sections.filter((s) => s.type === "features")[0].props.items,
    genericCopy(normalizeBrief(BRIEF)).services,
  );
});

// --- T-002.3: completitud por sección ---------------------------------------
//
// La guardia no cambia: sigue podando y sigue quedándose corta. Lo que cambia es
// el borrador, que sustituye la SECCIÓN ENTERA por la genérica cuando el copy del
// modelo no llega al mínimo. Todo o nada: medio bloque del modelo y medio de
// plantilla se nota, y el visitante no sabría qué está leyendo.

/** Copy del modelo con textos propios, para distinguirlos de los genéricos. */
const COPY_MODELO = {
  heroHeadline: "Café de especialidad en el centro de Valencia",
  heroSubline: "Tostamos en casa cada semana.",
  services: [
    { title: "Tueste artesanal de origen", body: "Elegimos el grano y lo tostamos nosotros." },
    { title: "Degustación guiada", body: "Te acompañamos para que encuentres tu tueste." },
    // Limpio a proposito: el control necesita 3 servicios validos del modelo.
    { title: "Café para llevar", body: "Te lo servimos molido o en grano." },
  ],
  aboutBody: "Abrimos en 2015 en el barrio del Carmen con una idea simple.",
  faq: [
    { q: "¿Tenéis terraza?", a: "Sí, con sombra por la mañana." },
    { q: "¿Cuántos clientes atendéis al día?", a: "Atendemos a 400 clientes al día." },
  ],
};

test("completitud: servicios podados a 1 -> los 3 genéricos, sin nada del modelo", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      services: [
        { title: "Clientes fieles", body: "Atendemos a 900 clientes cada mes." },
        { title: "Experiencia", body: "Llevamos 15 años detrás de la barra." },
        { title: "Tueste artesanal de origen", body: "Elegimos el grano y lo tostamos nosotros." },
      ],
    }),
    brief,
  ).copy;
  // La guardia deja 1 solo servicio válido: el mínimo son 3.
  assert.equal(copy.services.length, 1);

  const doc = draftSite(brief, PRESET, copy);
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  // Exactamente la sección genérica, encabezado incluido.
  assert.deepEqual(features.props, { heading: genericCopy(brief).servicesHeading, items: genericCopy(brief).services });
  // Y ni un fragmento del que sobrevivió a la guardia.
  const json = JSON.stringify(doc);
  assert.doesNotMatch(json, /Tueste artesanal de origen|Elegimos el grano/);
  assert.doesNotMatch(json, /900 clientes|15 años/);
});

test("completitud: aboutBody podado -> el párrafo genérico entero, sin nada del modelo", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy({ aboutBody: COPY_MODELO.aboutBody, services: COPY_MODELO.services }), brief).copy;
  // "Abrimos en 2015" lleva una cifra que el dueño no dio: el about se poda.
  assert.equal(copy.aboutBody, "");

  const doc = draftSite(brief, PRESET, copy);
  const generic = genericCopy(brief);
  // T-003.3: con shape=site el about vive en /sobre-nosotros.
  const pgSobre = doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const about = pgSobre.sections.find((s) => s.type === "text");
  assert.ok(about, "hay sección text en /sobre-nosotros");
  assert.deepEqual(about.props, { heading: generic.aboutHeading, body: generic.aboutBody });
  assert.doesNotMatch(JSON.stringify(doc), /Abrimos en 2015/);
});

test("completitud: faq podada a 1 -> las 3 genéricas, sin nada del modelo", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      faq: [
        { q: "¿Tenéis terraza?", a: "Sí, con sombra por la mañana." },
        { q: "¿Cuántos clientes atendéis al día?", a: "Atendemos a 400 clientes al día." },
      ],
    }),
    brief,
  ).copy;
  // Queda 1 pregunta válida: el mínimo para que haya sección es 2.
  assert.equal(copy.faq.length, 1);

  const doc = draftSite(brief, PRESET, copy);
  const faq = doc.pages[0].sections.find((s) => s.type === "faq");
  assert.deepEqual(faq.props.items, genericCopy(brief).faq);
  assert.doesNotMatch(JSON.stringify(doc), /¿Tenéis terraza\?|400 clientes/);
});

test("completitud: si la sección llega al mínimo, se conserva la del modelo", () => {
  // Control: sin esto, las tres pruebas de arriba pasarían también si el
  // borrador sustituyera siempre, que sería perder el copy del modelo.
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy({ services: COPY_MODELO.services, faq: COPY_MODELO.faq }), brief).copy;
  assert.equal(copy.services.length, 3);
  assert.equal(copy.faq.length, 1);
  assert.notEqual(copy.aboutBody, "");

  const doc = draftSite(brief, PRESET, copy);
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.deepEqual(features.props.items, copy.services);
  // T-003.3: con shape=site el about vive en /sobre-nosotros.
  const pgSobre = doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const about = pgSobre.sections.find((s) => s.type === "text");
  assert.ok(about, "hay sección text en /sobre-nosotros");
  assert.equal(about.props.body, copy.aboutBody);
  // La faq quedó corta (1 tras podar) y es genérica; en site vive en portada y /sobre-nosotros.
  const allFaq = doc.pages.flatMap((p) => p.sections).filter((s) => s.type === "faq");
  assert.ok(allFaq.every((s) => JSON.stringify(s.props.items) === JSON.stringify(genericCopy(brief).faq)));
});

test("completitud: pasos podados a 1 -> los 3 genéricos, sin nada del modelo", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      // Los servicios llegan al mínimo para aislar el caso del proceso.
      process: [
        { title: "Clientes fieles", body: "Atendemos a 900 clientes cada mes." },
        { title: "Experiencia", body: "Llevamos 15 años detrás de la barra." },
        // Texto distinto de cualquier paso genérico, para poder buscarlo.
        { title: "Pasas a probarlo", body: "Te esperamos en la barra del local." },
      ],
    }),
    brief,
  ).copy;
  // La guardia deja 1 de 3 pasos válidos.
  assert.equal(copy.process.length, 1);
  assert.equal(copy.services.length, 3);

  const doc = draftSite(brief, PRESET, copy);
  const generic = genericCopy(brief);
  // T-003.3: con shape=site el proceso vive en /servicios, no en la portada.
  const pgServicios = doc.pages.find((p) => p.slug === "/servicios");
  assert.ok(pgServicios, "la página /servicios existe");
  const process = pgServicios.sections.find((s) => s.id === "s_process");
  assert.ok(process, "el proceso está en /servicios");
  assert.deepEqual(process.props, { heading: generic.processHeading, items: generic.process });
  // Ni el paso que sobrevivió ni los podados (en todo el documento).
  const json = JSON.stringify(doc);
  assert.doesNotMatch(json, /Pasas a probarlo|Te esperamos en la barra|900 clientes|15 años/);
  // Los servicios del modelo siguen intactos en la portada.
  const features = doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.deepEqual(features.props.items, copy.services);
  // El plan marca el bloque sustituido como plantilla, igual que las demás.
  const plan = planSections(brief, PRESET, copy);
  // T-003.3: plan.pages[0] = portada; el proceso está en plan.pages[1] (/servicios).
  const planServicios = plan.pages.find((p) => p.slug === "/servicios");
  assert.ok(planServicios, "el plan tiene /servicios");
  assert.equal(planServicios.sections.find((s) => s.type === "process").origin, "copy_generico");
  assert.equal(plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_del_dueno");
});

test("completitud: con 3 pasos válidos se conservan los del modelo", () => {
  // Control: sin esto, la prueba de arriba pasaría también si el borrador
  // reemplazara siempre el proceso, perdiendo el texto del modelo.
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(
    validCopy({
      process: [
        { title: "Nos escribes", body: "Cuéntanos qué necesitas y para cuándo." },
        { title: "Lo concretamos", body: "Vemos juntos la mejor forma de hacerlo." },
        { title: "Lo llevamos a cabo", body: "Nos ponemos con ello y te avisamos." },
      ],
    }),
    brief,
  ).copy;
  assert.equal(copy.process.length, 3);

  const doc = draftSite(brief, PRESET, copy);
  // T-003.3: con shape=site el proceso vive en /servicios, no en la portada.
  const pgServicios = doc.pages.find((p) => p.slug === "/servicios");
  assert.ok(pgServicios, "la página /servicios existe");
  const process = pgServicios.sections.find((s) => s.id === "s_process");
  assert.ok(process, "el proceso está en /servicios");
  assert.deepEqual(process.props.items, copy.process);
  // Y el plan lo marca como del modelo, no como plantilla.
  const plan = planSections(brief, PRESET, copy);
  // T-003.3: el proceso está en plan.pages[1] (/servicios).
  const planServicios = plan.pages.find((p) => p.slug === "/servicios");
  assert.ok(planServicios, "el plan tiene /servicios");
  assert.equal(planServicios.sections.find((s) => s.type === "process").origin, "copy_del_dueno");
});

// --- T-002.4: los cuatro hallazgos de testing y seguridad -------------------

/** ¿El documento entregado lleva el marcador en cualquier sitio? */
const conMarcador = (doc) => /pendiente de confirmar/i.test(JSON.stringify(doc));

// Fix A.1 — el marcador DENTRO de un texto del modelo también es invención.
test("Fix A: un aboutBody que contiene el marcador se poda, no solo el valor exacto", () => {
  const brief = normalizeBrief(BRIEF);
  const out = guardCopy(validCopy({ aboutBody: "Horario pendiente de confirmar." }), brief);
  assert.equal(out.dropped.includes("aboutBody"), true);
  assert.equal(out.copy.aboutBody, "");
  const doc = draftSite(brief, PRESET, out.copy);
  assert.equal(conMarcador(doc), false);
  // T-003.3: con shape=site el about vive en /sobre-nosotros.
  const pgSobre = doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const about = pgSobre.sections.find((s) => s.type === "text");
  assert.ok(about, "hay sección text en /sobre-nosotros");
  assert.equal(about.props.body, genericCopy(brief).aboutBody);
});

test("Fix A: el marcador se detecta sin distinguir mayúsculas", () => {
  const brief = normalizeBrief(BRIEF);
  const out = guardCopy(validCopy({ aboutBody: "PENDIENTE DE CONFIRMAR el horario." }), brief);
  assert.equal(out.dropped.includes("aboutBody"), true);
});

// Fix A.2 — una descripción del dueño con el marcador no es un dato suyo.
test("Fix A: una description con el marcador no se da por aportada", () => {
  const brief = normalizeBrief({ name: "Pan de Alba", description: "Horario pendiente de confirmar." });
  assert.equal("description" in brief, false);
  const doc = draftSite(brief, PRESET);
  assert.equal(conMarcador(doc), false);
});

test("Fix A: una description limpia se sigue respetando", () => {
  // Control: la red no puede vaciar un dato legítimo del dueño.
  const brief = normalizeBrief({ name: "Pan de Alba", description: "abrimos todos los dias menos el lunes" });
  assert.equal(brief.description, "abrimos todos los dias menos el lunes");
});

// Fix A.3 — la red final del borrador, probada SIN pasar por la guardia.
test("Fix A: la red final de draftSite sustituye el marcador aunque el copy no venga de la guardia", () => {
  const brief = normalizeBrief(BRIEF);
  // Copy fabricado a mano: no ha pasado por `guardCopy`, es el caso que se colaba.
  const sucio = { ...genericCopy(brief), aboutBody: "Horario pendiente de confirmar." };
  const doc = draftSite(brief, PRESET, sucio);
  assert.equal(conMarcador(doc), false);
  // T-003.3: con shape=site el about vive en /sobre-nosotros.
  // Solo cae la sección afectada; el resto del copy se conserva.
  const pgSobre = doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const texto = pgSobre.sections.filter((s) => s.type === "text").map((s) => s.props.body);
  assert.deepEqual(texto, [genericCopy(brief).aboutBody]);
  assert.equal(doc.pages[0].sections.find((s) => s.type === "features").props.items[0].title, sucio.services[0].title);
});

test("Fix A: la red final también cubre las tarjetas de un servicio", () => {
  const brief = normalizeBrief(BRIEF);
  const sucio = genericCopy(brief);
  sucio.services = [...sucio.services.slice(0, 2), { title: "Horario", body: "Atención pendiente de confirmar." }];
  const doc = draftSite(brief, PRESET, sucio);
  assert.equal(conMarcador(doc), false);
  // La sección de servicios se rehace entera con la genérica.
  assert.deepEqual(doc.pages[0].sections.find((s) => s.id === "s_features").props.items, genericCopy(brief).services);
});

// Fix B — una cifra solo la avala la cifra completa, no un trozo.
test("Fix B: «19» no se avala con el «2019» del nombre del dueño", () => {
  const brief = normalizeBrief({ name: "Café 2019" });
  const out = guardCopy(validCopy({ heroSubline: "Tenemos 19 sucursales." }), brief);
  assert.equal(out.dropped.includes("heroSubline"), true);
  assert.notEqual(out.copy.heroSubline, "Tenemos 19 sucursales.");
});

test("Fix B: una cifra completa del dueño sí se conserva", () => {
  const brief = normalizeBrief({ name: "Café Aurora", description: "abrimos en 2019" });
  const out = guardCopy(validCopy({ heroSubline: "Desde 2019 te atendemos." }), brief);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.copy.heroSubline, "Desde 2019 te atendemos.");
});

test("Fix B: la comparación es por token, no por subcadena, en cualquier campo", () => {
  const brief = normalizeBrief({ businessType: "taller", city: "Bilbao", service: "revisiones cada 20000 km" });
  // "2000" está dentro de "20000" pero no es la misma cifra.
  assert.equal(guardCopy(validCopy({ heroSubline: "Revisamos tu coche cada 2000 km." }), brief).dropped.includes("heroSubline"), true);
  // La cifra exacta, sí.
  assert.equal(guardCopy(validCopy({ heroSubline: "Revisamos tu coche cada 20000 km." }), brief).dropped.includes("heroSubline"), false);
});

// Fix C — una prueba por forma: las que se podan y las que no.
test("Fix C: se podan las diez formas de reclamo", () => {
  const brief = normalizeBrief(BRIEF);
  for (const texto of [
    "Un equipo premiado",
    "Somos premiados por la ciudad",
    "Producto certificado",
    "Contamos con certificaciones oficiales",
    "Servicio garantizado",
    "Somos el líder del barrio",
    "Somos líderes del sector",
    "El nº1 de Valencia",
    "Muchos clientes satisfechos",
    "Veinte años de experiencia",
  ]) {
    assert.equal(guardCopy(validCopy({ aboutBody: texto }), brief).dropped.includes("aboutBody"), true, `debería podarse: ${texto}`);
  }
});

test("Fix C: NO se podan las actividades ni el texto normal", () => {
  const brief = normalizeBrief(BRIEF);
  for (const texto of [
    // Actividades: describen lo que se hace, no presumen un estado del negocio.
    "Ana se encarga de liderar las reuniones.",
    "Nos gusta coliderar proyectos con el barrio.",
    "Podemos certificar tu documento ante notario.",
    "Estamos liderando el cambio en el barrio",
    // Cambiado en T-002.5: "liderazgo" SÍ se poda, porque es un sustantivo que
    // presume posición. Esta línea lo afirmaba como tema conservable.
    // Texto normal.
    "Atendemos por la mañana.",
    "Tostamos el grano en casa cada semana.",
  ]) {
    assert.equal(guardCopy(validCopy({ aboutBody: texto }), brief).dropped.includes("aboutBody"), false, `no debería podarse: ${texto}`);
  }
});

// Fix D — los valores del brief pasan la guardia antes de entrar en la plantilla.
test("Fix D: un tipo de negocio con reclamo no entra en el copy genérico ni en el documento", () => {
  const brief = normalizeBrief({ businessType: "taller certificado", city: "Bilbao", name: "Taller Norte" });
  const copy = genericCopy(brief);
  const serializado = JSON.stringify(copy);
  // Ni el tipo, ni el encabezado, ni el about, ni el SEO.
  assert.doesNotMatch(serializado, /certificad/i);
  assert.equal(copy.businessType, "negocio local");
  assert.equal(copy.aboutHeading, "Quiénes somos");
  assert.doesNotMatch(copy.aboutBody, /taller/i);
  // Y el documento final: ni en las secciones ni en el SEO. `meta.name` y
  // `design.brief` quedan fuera del Fix D (llevan el nombre del negocio tal cual,
  // que es un dato identificativo, no un texto redactado); el reporte lo deja
  // anotado como riesgo para que lo decida el lead.
  const doc = draftSite(brief, PRESET);
  assert.doesNotMatch(JSON.stringify(doc.pages), /certificad/i);
  assert.doesNotMatch(JSON.stringify(doc.pages[0].seo.description), /certificad/i);
});

test("Fix D: un tipo de negocio limpio sí se usa", () => {
  // Control: el filtro no puede vaciar datos legítimos.
  const brief = normalizeBrief({ businessType: "taller de bicicletas", city: "Bilbao" });
  const copy = genericCopy(brief);
  assert.equal(copy.businessType, "taller de bicicletas");
  assert.equal(copy.aboutHeading, "taller de bicicletas");
  assert.match(copy.aboutBody, /taller de bicicletas en Bilbao/);
  assert.match(copy.seoDescription, /taller de bicicletas en Bilbao/);
});

test("Fix D: el nombre del dueño con reclamo no llega a la plantilla del copy ni a las secciones", () => {
  const brief = normalizeBrief({ name: "Café nº1 de Valencia", city: "Valencia" });
  const copy = genericCopy(brief);
  assert.equal("businessName" in copy, false);
  assert.doesNotMatch(copy.heroHeadline, /nº1/i);
  assert.doesNotMatch(copy.aboutBody, /nº1/i);
  // Las secciones del documento y su SEO de página salen limpios. `meta.name` es
  // el nombre del negocio y sí lo conserva: fuera del alcance del Fix D.
  const doc = draftSite(brief, PRESET);
  assert.doesNotMatch(JSON.stringify(doc.pages[0].sections), /nº1/i);
  assert.equal(doc.meta.name, "Café nº1 de Valencia");
});

test("Fix D: el respaldo del titular en la guardia no restaura un reclamo del brief", () => {
  // Seguridad: la guardia poda el titular inventado y cae a `heroHeadline(brief)`,
  // que interpolaba el tipo de negocio sin filtrar. "taller certificado en Bilbao"
  // volvía al hero justo después de que la guardia lo podara.
  const brief = normalizeBrief({ businessType: "taller certificado", city: "Bilbao" });
  const out = guardCopy(validCopy({ heroHeadline: "Los 25 mejores mecánicos" }), brief);
  assert.equal(out.dropped.includes("heroHeadline"), true);
  assert.doesNotMatch(out.copy.heroHeadline, /certificad/i);
  // Control: con un tipo limpio el respaldo sigue usando los datos del dueño.
  const limpio = normalizeBrief({ businessType: "taller de bicicletas", city: "Bilbao" });
  assert.equal(guardCopy(validCopy({ heroHeadline: "Los 25 mejores mecánicos" }), limpio).copy.heroHeadline, "taller de bicicletas en Bilbao");
});

// --- T-002.5: liderazgo y el contacto fuera del corpus numérico -------------

test("T-002.5: «liderazgo» presume posición y se poda; las actividades se conservan", () => {
  const brief = normalizeBrief(BRIEF);
  const poda = (texto) => guardCopy(validCopy({ aboutBody: texto }), brief).dropped.includes("aboutBody");
  // Afirmaciones de estado: se podan.
  for (const texto of ["Nuestro liderazgo en el barrio", "Tres liderazgos reconocidos", "Somos el líder", "Somos líderes del sector"]) {
    assert.equal(poda(texto), true, `debería podarse: ${texto}`);
  }
  // Actividades: se conservan.
  for (const texto of ["Nos gusta liderar proyectos", "Vamos a coliderar la feria", "Seguimos liderando equipos pequeños"]) {
    assert.equal(poda(texto), false, `no debería podarse: ${texto}`);
  }
});

test("T-002.5: una cifra del teléfono no autoriza un plazo", () => {
  // Hallazgo 1 de seguridad: con el contacto en el corpus, el "24" del número
  // validaba "Entrega en 24 horas", un plazo que el dueño nunca dio.
  const brief = normalizeBrief({ name: "Taller Norte", contact: "600 24 24 24" });
  const out = guardCopy(validCopy({ heroSubline: "Entrega en 24 horas" }), brief);
  assert.equal(out.dropped.includes("heroSubline"), true);
  assert.notEqual(out.copy.heroSubline, "Entrega en 24 horas");
});

test("T-002.5: el mismo plazo escrito por el dueño en la descripción se conserva", () => {
  // Control: la cifra sale del contacto, no deja de valer cuando la dice el dueño.
  const brief = normalizeBrief({ name: "Taller Norte", contact: "600 24 24 24", description: "entrega en 24 horas" });
  const out = guardCopy(validCopy({ heroSubline: "Entrega en 24 horas" }), brief);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.copy.heroSubline, "Entrega en 24 horas");
});

test("T-002.5: el contacto se sigue publicando aunque no avale cifras", () => {
  // Que no avale cifras no significa que se pierda: va a su sección, tal cual.
  // T-003.3: "Taller Norte" tiene señal de site (taller); el contacto
  // está en /contacto. Se busca en todas las páginas del documento.
  const brief = normalizeBrief({ name: "Taller Norte", contact: "600 24 24 24" });
  const doc = draftSite(brief, { ...PRESET, sections: [...PRESET.sections, { type: "contact" }] });
  const allSections = doc.pages.flatMap((p) => p.sections);
  const contacto = allSections.find((s) => s.type === "contact");
  assert.ok(contacto, "hay sección de contacto en el documento");
  assert.equal(contacto.props.phone, "600 24 24 24");
});

// --- T-002.6: el preset decide estilo, no qué contenido existe ---------------
//
// Presets mínimos: solo hero y lo que se pruebe. La completitud no puede
// depender de que el preset traiga la sección.
// T-003.3: estos tests prueban la completitud en el camino landing (1 página).
// BRIEF_LANDING usa un brief que clasifica como landing para que toda la
// lógica de completitud se aplique sobre pages[0].
const SOLO_HERO = { ...PRESET, sections: [{ type: "hero" }] };
const HERO_CONTACTO = { ...PRESET, sections: [{ type: "hero" }, { type: "contact" }] };
const ids = (doc) => doc.pages[0].sections.map((s) => s.id);

test("T-002.6: preset con solo hero y contact -> la página lleva todo el contenido", () => {
  // T-003.3: usa BRIEF_LANDING para probar el camino landing (1 página con
  // todas las secciones), que es lo que T-002.6 cubre.
  const brief = normalizeBrief(BRIEF_LANDING);
  const doc = draftSite(brief, HERO_CONTACTO, guardCopy(validCopy(), brief).copy);
  const secciones = doc.pages[0].sections;
  const tipos = secciones.map((s) => s.type);
  // Hero primero y cierre al final.
  assert.equal(secciones[0].type, "hero");
  assert.equal(secciones.at(-2).type, "contact");
  assert.equal(secciones.at(-1).type, "cta");
  // Y el contenido que el preset no pedía, en el orden canónico.
  assert.deepEqual(ids(doc), ["s_hero", "s_features", "s_text", "s_process", "s_faq", "s_contact", "s_cta"]);
  assert.ok(tipos.includes("features"));
  assert.ok(tipos.includes("text"));
  assert.ok(tipos.includes("faq"));
});

test("T-002.6: preset sin faq -> la FAQ aparece igualmente antes de contact", () => {
  // T-003.3: usa BRIEF_LANDING.
  const brief = normalizeBrief(BRIEF_LANDING);
  const sinFaq = { ...PRESET, sections: [{ type: "hero" }, { type: "features" }, { type: "text" }, { type: "contact" }] };
  const doc = draftSite(brief, sinFaq, guardCopy(validCopy(), brief).copy);
  const orden = ids(doc);
  assert.ok(orden.includes("s_faq"), "la FAQ existe aunque el preset no la pida");
  assert.ok(orden.indexOf("s_faq") < orden.indexOf("s_contact"), "va antes del contacto");
  // El plan dice lo mismo que el documento.
  const plan = planSections(brief, sinFaq, guardCopy(validCopy(), brief).copy);
  assert.equal(plan.pages[0].sections.find((s) => s.type === "faq").action, "write");
  assert.match(plan.pages[0].sections.find((s) => s.type === "faq").reason, /^completitud_/);
});

test("T-002.6: preset con pricing y testimonial -> se omiten y el resto está completo", () => {
  // T-003.3: usa BRIEF_LANDING.
  const brief = normalizeBrief(BRIEF_LANDING);
  const conTodo = { ...PRESET, sections: [{ type: "hero" }, { type: "pricing" }, { type: "testimonial" }] };
  const copy = guardCopy(validCopy(), brief).copy;
  const doc = draftSite(brief, conTodo, copy);
  const tipos = doc.pages[0].sections.map((s) => s.type);
  assert.equal(tipos.includes("pricing"), false, "sin precios inventados");
  assert.equal(tipos.includes("testimonial"), false, "sin testimonios inventados");
  // Pero el contenido obligatorio sí.
  for (const id of ["s_hero", "s_features", "s_text", "s_process", "s_faq", "s_contact", "s_cta"]) {
    assert.ok(ids(doc).includes(id), `falta ${id}`);
  }
  assert.doesNotMatch(JSON.stringify(doc), /\d+\s?€|premiad|certificad/i);
});

test("T-002.6: sin copy (rama genérica) la completitud es la misma", () => {
  // T-003.3: usa BRIEF_LANDING.
  const brief = normalizeBrief(BRIEF_LANDING);
  const soloHeroLanding = { ...SOLO_HERO };
  const doc = draftSite(brief, soloHeroLanding);
  assert.deepEqual(ids(doc), ["s_hero", "s_features", "s_text", "s_process", "s_faq", "s_contact", "s_cta"]);
  // Y el plan coincide con el documento, sección a sección.
  const plan = planSections(brief, soloHeroLanding);
  assert.deepEqual(
    plan.pages[0].sections.filter((s) => s.action !== "omit").map((s) => s.as),
    ["hero", "features", "text", "process", "faq", "contact", "cta"],
  );
  assert.ok(plan.pages[0].sections.filter((s) => s.reason.startsWith("completitud_")).every((s) => s.reason === "completitud_copy_generico"));
});

test("T-002.6: control — preset completo y copy completo respetan el orden y no duplican", () => {
  // T-003.3: usa BRIEF_LANDING.
  const brief = normalizeBrief(BRIEF_LANDING);
  const completo = {
    ...PRESET,
    sections: [
      { type: "hero" }, { type: "text" }, { type: "features" },
      { type: "faq" }, { type: "cta" }, { type: "contact" },
    ],
  };
  const doc = draftSite(brief, completo, guardCopy(validCopy(), brief).copy);
  // Nada duplicado.
  assert.deepEqual(ids(doc), ["s_hero", "s_text", "s_features", "s_process", "s_faq", "s_contact", "s_cta"]);
  assert.equal(doc.pages[0].sections.filter((s) => s.type === "features").length, 2, "features y proceso, no dos de ventajas");
  assert.equal(doc.pages[0].sections.filter((s) => s.type === "contact").length, 1);
  // El orden del preset se respeta: text antes que features, y el cierre al final
  // aunque el preset pusiera `cta` antes de `contact`.
  assert.ok(ids(doc).indexOf("s_text") < ids(doc).indexOf("s_features"));
  assert.deepEqual(ids(doc).slice(-2), ["s_contact", "s_cta"]);
  // Ninguna sección del preset se marca como añadida por completitud.
  const plan = planSections(brief, completo, guardCopy(validCopy(), brief).copy);
  assert.equal(plan.pages[0].sections.some((s) => s.reason.startsWith("completitud_")), false);
});

// --- T-002.7: Fix E (titular compuesto) y Fix F (origen por contenido) ------

test("Fix E: un tipo de 120 y una ciudad de 80 no abortan la ejecución", () => {
  const brief = normalizeBrief({ businessType: "t".repeat(119) + "a", city: "c".repeat(80) });
  const copy = genericCopy(brief);
  // El titular compuesto se recorta al máximo del esquema del copy (90).
  assert.ok(copy.heroHeadline.length <= 90, `titular: ${copy.heroHeadline.length}`);
  assert.ok(copy.heroHeadline.length >= 8, "y no baja del mínimo");
  // El copy genérico pasa su propio esquema, que antes no pasaba.
  assert.equal(siteCopySchema.safeParse(copy).success, true);
  // Y el borrador sale: antes lanzaba "borrador invalido".
  const doc = draftSite(brief, PRESET, copy);
  assert.equal(validateSiteDocument(doc).ok, true);
  assert.ok(doc.pages[0].sections[0].props.headline.length <= 120);
});

test("Fix E: el titular compuesto se recorta, pero el nombre corto del dueño no cambia", () => {
  // Control: recortar no puede tocar un titular que ya cabía.
  const brief = normalizeBrief({ businessType: "cafetería", name: "Café Aurora", city: "Valencia" });
  assert.equal(genericCopy(brief).heroHeadline, "Café Aurora");
});

test("Fix F: una sección de plantilla no se marca como del dueño", () => {
  // T-002.9: `origin` dice QUIÉN produjo el texto, no si el contenido coincide
  // con la plantilla. `completeCopy` registra en `substituted` exactamente qué
  // claves sustituyó; `originFromSet` consulta ese conjunto. Si el modelo
  // devuelve texto que cumple los mínimos, `completeCopy` no sustituye nada y
  // el origen es `copy_del_dueno`, sea cual sea el contenido.
  //
  // El caso que sí garantiza `copy_generico` es que `completeCopy` sustituya:
  // con 2 servicios (< 3) la sección entera se reemplaza por la plantilla, y
  // el origen refleja ese reemplazo sin comparar contenido.
  const brief = normalizeBrief(BRIEF);
  const copyPoco = guardCopy(validCopy({
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa." },
      { title: "Desayunos", body: "Servimos desayunos hasta mediodía." },
    ],
  }), brief).copy;
  const plan = planSections(brief, PRESET, copyPoco);
  // T-003.3: plan.pages[0] = portada; features está ahí.
  // La sección de servicios fue sustituida por la plantilla: origin correcto.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_generico");
  // El contenido es exactamente el genérico, sin fragmentos del modelo.
  assert.deepEqual(
    plan.pages[0].sections.find((s) => s.type === "features"),
    planSections(brief, PRESET).pages[0].sections.find((s) => s.type === "features"),
    "la sección sustituida es idéntica a la genérica"
  );
});

test("Fix F: el texto del modelo que sí es suyo se sigue marcando como tal", () => {
  // Control: el filtro no puede marcar todo como plantilla.
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy(), brief).copy;
  const plan = planSections(brief, PRESET, copy);
  // T-003.3: plan.pages[0] = portada con features y faq.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_del_dueno");
  assert.equal(plan.pages[0].sections.find((s) => s.type === "faq").origin, "copy_del_dueno");
});

// --- T-002.8: límites sistemáticos y origen separado del motivo -------------

test("T-002.8: con TODOS los campos del brief al máximo, el copy pasa su esquema", () => {
  const brief = normalizeBrief({
    businessType: "Á".repeat(120),
    name: "Á".repeat(80),
    city: "Á".repeat(80),
    service: "Á".repeat(200),
    contact: "a@b.co",
    description: "Á".repeat(500),
  });
  const copy = genericCopy(brief);
  const parsed = siteCopySchema.safeParse(copy);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? [] : parsed.error.issues));
  // Y cada campo respeta su límite declarado.
  assert.ok((copy.businessName ?? "").length <= 60);
  assert.ok(copy.businessType.length <= 60);
  assert.ok(copy.heroHeadline.length <= 90);
  assert.ok(copy.heroSubline.length <= 220);
  assert.ok(copy.aboutHeading.length <= 80);
  assert.ok(copy.aboutBody.length <= 700);
  assert.ok(copy.seoDescription.length <= 155);
});

test("T-002.9: un nombre que no cabe en businessName (máx 60) se omite, no se recorta", () => {
  // T-002.9, Fix 2: recortar un nombre propio puede dejar un número parcial
  // («Café 2019» → «Café 20»). La regla nueva es: si no cabe, se omite.
  // "a" + 39 emojis = 1 + 39*2 = 79 unidades UTF-16: más largo que el límite 60.
  const brief = normalizeBrief({ name: "a" + "😀".repeat(39) });
  assert.equal(brief.name, "a" + "😀".repeat(39));
  const copy = genericCopy(brief);
  // El campo se omite entero en vez de recortarse.
  assert.equal("businessName" in copy, false, "businessName se omite cuando no cabe en 60");
  // Ningún sustituto suelto en ningún campo del copy: no hay mitad de emoji.
  assert.doesNotMatch(
    JSON.stringify(copy),
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    "ningun campo del copy contiene un sustituto suelto",
  );
  assert.equal(siteCopySchema.safeParse(copy).success, true);
});

test("T-002.8: el mismo contenido da el mismo origen con cualquier preset", () => {
  const brief = normalizeBrief(BRIEF);
  const copy = guardCopy(validCopy(), brief).copy;
  // Un preset que trae contacto y cierre, y otro que no trae ninguno.
  const conCierre = { ...PRESET, sections: [{ type: "hero" }, { type: "text" }, { type: "features" }, { type: "faq" }, { type: "contact" }, { type: "cta" }] };
  const sinCierre = { ...PRESET, sections: [{ type: "hero" }, { type: "text" }, { type: "features" }, { type: "faq" }] };
  // T-003.3: plan.pages[0] = portada; contact y cta están siempre en ella.
  const pgUno = planSections(brief, conCierre, copy).pages.find((p) => p.slug === "/contacto");
  const pgOtro = planSections(brief, sinCierre, copy).pages.find((p) => p.slug === "/contacto");
  const buscar = (pg, type) => pg?.sections.find((s) => s.type === type)
    ?? planSections(brief, conCierre, copy).pages[0].sections.find((s) => s.type === type);

  // Para contact y cta, buscamos en la página que los contiene.
  const contactUno = planSections(brief, conCierre, copy).pages.flatMap((p) => p.sections).find((s) => s.type === "contact");
  const contactOtro = planSections(brief, sinCierre, copy).pages.flatMap((p) => p.sections).find((s) => s.type === "contact");
  const ctaUno = planSections(brief, conCierre, copy).pages[0].sections.find((s) => s.type === "cta");
  const ctaOtro = planSections(brief, sinCierre, copy).pages[0].sections.find((s) => s.type === "cta");

  // Mismo origen en los dos: el texto es el mismo.
  assert.equal(contactUno.origin, "contacto_del_dueno");
  assert.equal(contactOtro.origin, "contacto_del_dueno");
  assert.equal(ctaUno.origin, ctaOtro.origin);
  // El reason no depende del preset para contact/cta en shape=site:
  // siempre van en su página fija (/contacto y portada). Solo chequeamos el origin.
});

test("T-002.8: el origen del contacto depende solo de los datos del dueño", () => {
  // Con teléfono o correo: del dueño.
  for (const contact of ["hola@cafe.test", "600 111 222", "+34 600 333 444"]) {
    const brief = normalizeBrief({ ...BRIEF, contact });
    // T-003.3: contact está en /contacto para shape=site.
    const plan = planSections(brief, PRESET);
    const pgContacto = plan.pages.find((p) => p.slug === "/contacto");
    assert.ok(pgContacto, "la página /contacto existe");
    assert.equal(pgContacto.sections.find((s) => s.type === "contact").origin, "contacto_del_dueno", contact);
  }
  // Sin contacto utilizable: genérico, aunque el preset lo pida.
  for (const entrada of [{ businessType: "cafetería" }, { businessType: "cafetería", contact: "escríbeme cuando quieras" }]) {
    const brief = normalizeBrief(entrada);
    const plan = planSections(brief, PRESET);
    const pgContacto = plan.pages.find((p) => p.slug === "/contacto");
    assert.ok(pgContacto, "la página /contacto existe");
    assert.equal(pgContacto.sections.find((s) => s.type === "contact").origin, "contacto_generico", JSON.stringify(entrada));
  }
});

test("T-002.8: la galería no tiene origen de texto", () => {
  // T-003.3: la galería solo aparece en el plan cuando el brief clasifica como
  // landing. Con un brief de cafetería (site) el plan de 4 páginas no incluye
  // galería en la estructura fija. Se prueba con un brief de landing.
  const brief = normalizeBrief(BRIEF_LANDING);
  const conFotos = { ...PRESET, sections: [{ type: "hero" }, { type: "gallery" }] };
  const photos = { gallery: [{ assetId: "a1", alt: "" }, { assetId: "a2", alt: "" }, { assetId: "a3", alt: "" }] };
  const plan = planSections(brief, conFotos, undefined, photos);
  // landing: pages[0] contiene todas las secciones.
  assert.equal(plan.shape, "landing");
  const galeria = plan.pages[0].sections.find((s) => s.type === "gallery");
  assert.ok(galeria, "la galería existe en portada (landing)");
  assert.equal(galeria.action, "write");
  assert.equal(galeria.origin, undefined, "la galería lleva fotos, no texto");
  assert.equal(galeria.reason, "fotos_de_la_busqueda");
});
