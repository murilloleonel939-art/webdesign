import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { siteDocumentSchema, validateSiteDocument } from "@webdesign/site-schema";
import { lintSite } from "@webdesign/linter";
import { renderPage } from "@webdesign/renderer";
import {
  BRIEF_FIELDS,
  PENDING_MARKER,
  completeCopy,
  designAgent,
  draftSite,
  genericCopy,
  inventory,
  normalizeBrief,
  planSections,
  runFastDesign,
  themeForProduct,
  productForBrief,
} from "../dist/index.js";

// Preset de prueba con la forma exacta del catálogo (migración 0009). No se
// importa `platform`: el preset entra como DATO.
const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  keywords: ["cafeteria", "restaurante"],
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [
    { type: "hero" },
    { type: "text" },
    { type: "features" },
    { type: "testimonial" },
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

const BUDGET = {
  maxTokens: 100_000,
  maxToolCalls: 5,
  maxCostUsd: 1,
  timeoutMs: 60_000,
  maxContextTokens: 24_000,
};

const CTX = (runId) => ({ runId, userId: "u1", token: "t", locale: "es", apiBaseUrl: "http://x" });

/** Transporte falso: ninguna prueba toca la red. */
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
        model: "fake-small",
        latencyMs: 1,
      };
    },
  };
  return { client: new LlmClient(transport, tracker), tracker, transport };
}

test("brief: los campos que faltan quedan como marcador y se listan en pending", () => {
  const b = normalizeBrief({ name: "Café Aurora", contact: "600 111 222" });
  assert.equal(b.businessType, PENDING_MARKER);
  assert.equal(b.city, PENDING_MARKER);
  assert.deepEqual(b.pending, ["businessType", "city", "service"]);
  assert.deepEqual(normalizeBrief(BRIEF).pending, []);
});

test("brief: cubre los cinco campos mínimos de 9.1", () => {
  assert.deepEqual([...BRIEF_FIELDS], ["businessType", "name", "city", "service", "contact"]);
});

test("draft: el borrador valida contra site-schema y no inventa contenido", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET);
  assert.equal(validateSiteDocument(doc).ok, true);

  const sections = doc.pages[0].sections;
  assert.equal(sections[0].type, "hero");
  // Testimonio: nunca se escribe, se inventaría un cliente. (Cambiado en
  // T-002.3: antes las ventajas también se degradaban a texto con el marcador;
  // ahora se escriben con el copy genérico, que no afirma nada del negocio.)
  assert.ok(sections.every((s) => s.type !== "testimonial"));
  assert.ok(sections.some((s) => s.type === "features"), "las ventajas se escriben con el copy");
  // T-029: el tema ya no lo pone el preset sino el producto del catálogo
  // (cafetería → bakery-cafe). Se afirma el valor real, no el del preset.
  assert.deepEqual(doc.theme, themeForProduct(productForBrief(normalizeBrief(BRIEF))));
  assert.notEqual(doc.theme.colors.accent, PRESET.colors.accent);

  // Ningún precio del preset se hereda: la sección ni siquiera se escribe.
  // (Cambiado en T-002.3: antes salía con el marcador; ahora se omite.)
  const priced = draftSite(normalizeBrief(BRIEF), { ...PRESET, sections: [{ type: "pricing" }] });
  assert.equal(priced.pages[0].sections.some((s) => s.type === "pricing"), false);
});

// Cambiado en T-002.3 (era "…y el marcador llega al HTML"): el marcador ya no
// llega a ninguna parte. Lo que sigue igual de importante es que el camino sin
// datos del dueño produce HTML válido y un 6.4 limpio; lo nuevo que se afirma
// es que ese HTML cumple B1.
test("draft: 6.4 no devuelve ningún error y el HTML no lleva el marcador", () => {
  const doc = draftSite(normalizeBrief({ name: "Café Aurora" }), PRESET);
  assert.deepEqual(lintSite(doc).filter((f) => f.severity === "error"), []);
  const html = renderPage(doc, "p_home");
  assert.doesNotMatch(html, /pendiente de confirmar/i);
  // Y la página no sale vacía: hay titular y hay contenido.
  assert.match(html, /Café Aurora/);
});

test("inventario: separa lo afirmado de lo que falta, sin interpretar", () => {
  const inv = inventory(normalizeBrief({ name: "Café Aurora", city: "Valencia" }));
  assert.deepEqual(inv.known.map((k) => k.field), ["name", "city"]);
  assert.deepEqual(inv.missing.map((m) => m.field), ["businessType", "service", "contact"]);
  // El inventario y el borrador no pueden discrepar: ambos leen del mismo brief.
  assert.deepEqual(inv.missing.map((m) => m.field), normalizeBrief({ name: "Café Aurora", city: "Valencia" }).pending);
});

test("plan: omite testimonios y precios, escribe ventajas con el copy genérico", () => {
  // T-003.3: BRIEF de cafetería clasifica como site (4 páginas). Las aserciones
  // de completitud y orden se verifican sobre portada (pages[0]) y sobre el plan.
  const plan = planSections(normalizeBrief(BRIEF), PRESET);
  assert.equal(plan.presetId, PRESET.id);
  assert.equal(plan.shape, "site");
  // Portada de site: hero, features, faq, cta (según la tabla del contrato).
  const portada = plan.pages[0];
  assert.ok(portada.sections.every((s) => s.action === "write" || s.action === "omit"));
  assert.equal(portada.sections[0].as, "hero", "hero primero en portada");
  // Testimonio nunca se escribe, en ninguna página.
  const allSections = plan.pages.flatMap((p) => p.sections);
  assert.ok(allSections.filter((s) => s.action === "write").every((s) => s.type !== "testimonial" && s.type !== "pricing"));
  // Todas las secciones escritas tienen origin.
  assert.ok(allSections.filter((s) => s.action === "write" && s.type !== "contact" && s.type !== "gallery").every((s) => s.origin === "copy_generico"));
  // El plan tiene 4 páginas en shape=site.
  assert.equal(plan.pages.length, 4);
  // Ningún plan puede dejar el documento sin h1: cada página arranca con hero.
  for (const pg of plan.pages) {
    assert.equal(pg.sections.filter((s) => s.action === "write")[0]?.type, "hero", `${pg.slug} empieza con hero`);
  }
});

test("agente: definición de modo rápido, sin herramienta de publicar", () => {
  assert.equal(designAgent.id, "design");
  // Alias nuevo del catalogo: el agente de diseño usa el modelo del proveedor
  // compatible OpenAI (`claude-sonnet-5`), no el `fast-small` de antes.
  assert.equal(designAgent.model, "design");
  assert.ok(designAgent.budget.maxTokens > 0);
  assert.ok(!designAgent.tools.some((t) => t.includes("publish")));
});

test("runFastDesign: una ronda, sin invenciones y con checkpoint", async () => {
  const { client, tracker, transport } = fakeClient("He aplicado el preset Editorial. Falta confirmar la ciudad.");
  const out = await runFastDesign({
    brief: { name: "Café Aurora", businessType: "cafetería de especialidad", city: "Valencia" },
    presets: [PRESET],
    client,
    tracker,
    ctx: CTX("r1"),
  });

  // Tres llamadas: el texto no es JSON, asi que el copy (9.1, generate_copy)
  // agota su reintento (2 llamadas) antes de caer a marcadores; la tercera es
  // el resumen. Sigue siendo UNA ronda del bucle del agente: el copy va antes
  // del borrador y fuera del bucle.
  assert.equal(transport.calls, 3, "el copy reintenta una vez y luego va el resumen de la ronda");
  // El texto devuelto no es JSON, asi que el copy cae a marcadores: es el camino
  // previsto y el motivo queda en `warnings` para el panel.
  assert.ok(out.warnings.some((w) => w.startsWith("copy_fallback")), `warnings: ${out.warnings}`);
  assert.equal(out.presetId, PRESET.id);
  assert.deepEqual(out.pending, ["service", "contact"]);
  assert.equal(siteDocumentSchema.safeParse(out.doc).success, true);
  assert.ok(out.checkpointId);
  assert.deepEqual(out.findings6_4.filter((f) => f.severity === "error"), []);
  // Ni el modelo ni el agente escriben el marcador en el sitio; el fallback del
  // copy deja constancia en `warnings`, que es donde el panel lo lee (B1).
  assert.doesNotMatch(JSON.stringify(out.doc), /pendiente de confirmar/);
  // El panel recibe el motivo de cada decisión, no una caja negra.
  // T-003.3: plan.pages contiene las páginas; verificamos todas las secciones.
  assert.ok(out.plan.pages.flatMap((p) => p.sections).every((s) => typeof s.reason === "string" && s.reason.length > 0));
  assert.deepEqual(out.inventory.missing.map((m) => m.field), ["service", "contact"]);
});

test("runFastDesign: un 6.5 pedido por el dueño se aplica y solo avisa", async () => {
  const { client, tracker } = fakeClient("Aplicado.");
  const out = await runFastDesign({
    brief: BRIEF,
    presets: [PRESET],
    client,
    tracker,
    ctx: CTX("r2"),
    ownerRequested: true,
  });
  // Sin reversión: el documento sigue completo y válido.
  assert.equal(validateSiteDocument(out.doc).ok, true);
  assert.ok(Array.isArray(out.warnings));
});

/** Copy JSON valido con `photoQueries`, para las pruebas de fotos (B1). */
function copyWithPhotosJson() {
  return JSON.stringify({
    businessType: "cafetería de especialidad",
    heroHeadline: "Café Aurora en Valencia",
    heroSubline: "Tueste propio y desayunos cada mañana.",
    heroCta: "Escríbenos",
    servicesHeading: "Qué hacemos",
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa." },
      { title: "Desayunos", body: "Servimos desayunos hasta mediodía." },
      { title: "Para llevar", body: "También para llevar." },
    ],
    processHeading: "Cómo trabajamos",
    process: [{ title: "Nos escribes", body: "Cuéntanos qué necesitas." }],
    aboutHeading: "Quiénes somos",
    aboutBody: "Cafetería de especialidad en Valencia.",
    faq: [],
    closingHeadline: "Hablemos",
    closingCta: "Escribir",
    seoDescription: "Cafetería de especialidad en Valencia con tueste propio.",
    photoQueries: { hero: "coffee shop interior", gallery: "coffee shop details" },
  });
}

test("runFastDesign: fetchPhotos con 5 fotos deja hero con imagen y galeria con 4 assetIds", async () => {
  // T-003.3: la galería solo aparece en landing. BRIEF de cafetería clasifica
  // como site y la estructura de 4 páginas no incluye galería. Se prueba con
  // un brief de landing (diseño web) que sí produce la sección gallery.
  const landingBrief = { businessType: "diseño web", name: "Studio Aurora", city: "Valencia", service: "webs y branding", contact: "hola@studio.test" };
  const { client, tracker } = fakeClient(copyWithPhotosJson());
  const pool = [1, 2, 3, 4, 5].map((n) => ({ assetId: `ph${n}`, alt: `foto ${n}` }));
  const fetchPhotos = async ({ count }) => pool.slice(0, count);
  const out = await runFastDesign({ brief: landingBrief, presets: [PRESET], client, tracker, ctx: CTX("photos-ok"), fetchPhotos });

  assert.equal(validateSiteDocument(out.doc).ok, true);
  const hero = out.doc.pages[0].sections.find((s) => s.type === "hero");
  assert.equal(hero.props.image, "ph1");
  const gallery = out.doc.pages[0].sections.find((s) => s.type === "gallery");
  assert.ok(gallery, "la galeria existe con fotos suficientes");
  assert.deepEqual(gallery.props.assetIds, ["ph1", "ph2", "ph3", "ph4"]);
  assert.equal(out.warnings.includes("photos_unavailable"), false);
});

test("runFastDesign: fetchPhotos que lanza deja el sitio sin fotos y avisa photos_unavailable", async () => {
  const { client, tracker } = fakeClient(copyWithPhotosJson());
  const fetchPhotos = async () => {
    throw new Error("502 del proveedor de fotos");
  };
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("photos-fail"), fetchPhotos });

  assert.ok(out.warnings.includes("photos_unavailable"));
  const hero = out.doc.pages[0].sections.find((s) => s.type === "hero");
  assert.equal(hero.props.image, undefined);
  assert.equal(out.doc.pages[0].sections.some((s) => s.type === "gallery"), false);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

test("runFastDesign: copy con 2 servicios -> features genérica completa, sin marcador", async () => {
  const copy = JSON.parse(copyWithPhotosJson());
  copy.services = copy.services.slice(0, 2);
  const { client, tracker } = fakeClient(JSON.stringify(copy));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("copy-2") });

  // Cambiado en T-002.3: con menos de 3 servicios la sección se sustituye entera
  // por la genérica (antes salía con 2). Ningún servicio del modelo se mezcla.
  const features = out.doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.deepEqual(features.props.items, genericCopy(normalizeBrief(BRIEF)).services);
  assert.doesNotMatch(JSON.stringify(out.doc), /pendiente de confirmar/);
  // El plan dice de dónde sale ese bloque: plantilla, no el modelo.
  // Cambiado en T-002.8: el origen vive en `origin`.
  assert.equal(out.plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_generico");
});

test("runFastDesign: plan y documento coinciden cuando el about se poda", async () => {
  const copy = JSON.parse(copyWithPhotosJson());
  copy.aboutBody = "Somos la empresa líder del sector y estamos certificados.";
  const { client, tracker } = fakeClient(JSON.stringify(copy));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("copy-about") });

  // T-003.3: con shape=site el about vive en /sobre-nosotros.
  const generic = genericCopy(normalizeBrief(BRIEF));
  const pgSobre = out.doc.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobre, "la página /sobre-nosotros existe");
  const about = pgSobre.sections.find((s) => s.type === "text");
  assert.deepEqual(about.props, { heading: generic.aboutHeading, body: generic.aboutBody });
  // T-003.3: el plan de /sobre-nosotros contiene la sección text con origin genérico.
  const pgSobrePlan = out.plan.pages.find((p) => p.slug === "/sobre-nosotros");
  assert.ok(pgSobrePlan, "el plan tiene /sobre-nosotros");
  const textPlan = pgSobrePlan.sections.filter((s) => s.as === "text");
  assert.deepEqual(textPlan.map((s) => [s.action, s.origin]), [["write", "copy_generico"]]);
});

test("runFastDesign: un brief sin ningún dato se rechaza en vez de inventarlo", async () => {
  const { client, tracker } = fakeClient("x");
  await assert.rejects(runFastDesign({ brief: {}, presets: [PRESET], client, tracker, ctx: CTX("r3") }), /brief vacio/);
});

test("runFastDesign: sin presets no se inventa una familia nueva", async () => {
  const { client, tracker } = fakeClient("x");
  await assert.rejects(runFastDesign({ brief: BRIEF, presets: [], client, tracker, ctx: CTX("r4") }), /no hay presets/);
});

// --- T-002.9: origin por registro, no por comparación ----------------------------

test("T-002.9: hero con CTA del modelo -> copy_del_dueno aunque titular sea genérico", () => {
  // `origin` dice quién produjo el texto. Si el modelo devolvió un CTA propio
  // («Escríbenos»), el hero es suyo aunque el titular coincida con la plantilla.
  // Con `substituted` sabemos exactamente qué sustituyó `completeCopy`: si
  // `heroCta` no está en el conjunto, el hero no puede marcarse como plantilla.
  const brief = normalizeBrief(BRIEF);
  const generic = genericCopy(brief);
  // Copiamos el copy genérico pero sustituimos el CTA por uno del modelo.
  const copiaConCTA = { ...generic, heroCta: "Escríbenos" };
  const { substituted } = completeCopy(copiaConCTA, brief);
  // heroCta viene del modelo: NO debe estar en substituted.
  assert.equal(substituted.has("heroCta"), false);
  // Por tanto el hero NO puede ser copy_generico.
  const plan = planSections(brief, PRESET, copiaConCTA);
  // T-003.3: hero está en portada (pages[0]) para shape=site.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "hero").origin, "copy_del_dueno");
});

test("T-002.9: servicios con encabezado del modelo pero tarjetas genéricas -> copy_del_dueno en features", () => {
  // La regla: `origin` de features depende de si `services` está en `substituted`,
  // no de `servicesHeading`. Si el modelo dio suficientes servicios (>=3),
  // `completeCopy` no sustituye `services`, aunque el encabezado sea diferente.
  const brief = normalizeBrief(BRIEF);
  const generic = genericCopy(brief);
  // Copy con 3 servicios del modelo (suficientes) pero encabezado idéntico al genérico.
  const copiaConServicios = {
    ...generic,
    servicesHeading: generic.servicesHeading, // igual al genérico
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa." },
      { title: "Desayunos", body: "Servimos desayunos hasta mediodía." },
      { title: "Café para llevar", body: "También para llevar." },
    ],
  };
  const { substituted } = completeCopy(copiaConServicios, brief);
  assert.equal(substituted.has("services"), false, "3 servicios no disparan sustitución");
  const plan = planSections(brief, PRESET, copiaConServicios);
  // T-003.3: features está en portada (pages[0]) para shape=site.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_del_dueno");
});

test("T-002.9: servicios íntegramente genéricos (< 3 del modelo) -> copy_generico en features", () => {
  // Con solo 2 servicios, `completeCopy` sustituye `services` y `servicesHeading`
  // con la plantilla. El conjunto `substituted` lo recoge y `origin` es correcto.
  const brief = normalizeBrief(BRIEF);
  const copiaPocos = {
    ...genericCopy(brief),
    services: [
      { title: "Tueste propio", body: "Tostamos el grano en casa." },
      { title: "Desayunos", body: "Servimos desayunos hasta mediodía." },
    ],
  };
  const { substituted } = completeCopy(copiaPocos, brief);
  assert.equal(substituted.has("services"), true, "2 servicios disparan sustitución");
  const plan = planSections(brief, PRESET, copiaPocos);
  // T-003.3: features está en portada (pages[0]) para shape=site.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "features").origin, "copy_generico");
});

test("T-002.9: contacto con email del brief -> contacto_del_dueno; sin contacto -> contacto_generico", () => {
  // `origin` del contacto depende solo de los datos del dueño, no del preset.
  const conEmail = normalizeBrief({ ...BRIEF, contact: "hola@cafeaurora.test" });
  const sinContacto = normalizeBrief({ businessType: "cafetería" });
  const presetConContact = { ...PRESET, sections: [...PRESET.sections, { type: "contact" }] };
  const presetSinContact = { ...PRESET, sections: PRESET.sections.filter((s) => s.type !== "contact") };

  for (const preset of [presetConContact, presetSinContact]) {
    const planCon = planSections(conEmail, preset);
    // T-003.3: contact está en /contacto para shape=site.
    const contactCon = planCon.pages.find((p) => p.slug === "/contacto")?.sections.find((s) => s.type === "contact")
      ?? planCon.pages[0].sections.find((s) => s.type === "contact");
    assert.equal(contactCon.origin, "contacto_del_dueno",
      `con email, preset ${preset === presetConContact ? "con" : "sin"} contact`);
    const planSin = planSections(sinContacto, preset);
    const contactSin = planSin.pages.find((p) => p.slug === "/contacto")?.sections.find((s) => s.type === "contact")
      ?? planSin.pages[0].sections.find((s) => s.type === "contact");
    assert.equal(contactSin.origin, "contacto_generico",
      `sin contacto, preset ${preset === presetConContact ? "con" : "sin"} contact`);
  }
});

test("T-002.9: CTA con closingHeadline del modelo -> copy_del_dueno en cta", () => {
  // Si el modelo devolvió un closingHeadline propio, `substituted` no lo contiene
  // y el CTA es del dueño, aunque closingCta sea el genérico «Escribir».
  const brief = normalizeBrief(BRIEF);
  const generic = genericCopy(brief);
  const copiaConCierre = { ...generic, closingHeadline: "Pedir orientación" };
  const { substituted } = completeCopy(copiaConCierre, brief);
  assert.equal(substituted.has("closingHeadline"), false);
  const plan = planSections(brief, PRESET, copiaConCierre);
  // T-003.3: cta está en portada (pages[0]) para shape=site.
  assert.equal(plan.pages[0].sections.find((s) => s.type === "cta").origin, "copy_del_dueno");
});

// La frase literal del dueño: `brief` es el compuesto y `idea` el resumen del
// preset, asi que ninguno la conservaba y su burbuja del chat mostraba
// "buffet de abogados en barranquilla" en vez de lo que escribio.
test("draft: ownerPrompt conserva la frase literal del dueño", () => {
  const frase = "quiero una pagina web para un buffet de abogados en barranquilla";
  const doc = draftSite(normalizeBrief({ description: frase }), PRESET);
  assert.equal(doc.design.ownerPrompt, frase);
  // T-029: `idea` resume el tema real (estilo + paleta + pareja del catálogo),
  // no el preset fijo, que ya no decide el aspecto. `brief` sigue igual.
  assert.match(doc.design.idea, /^Estilo .+ para .+; paleta: .+; tipografía: .+/);
  assert.notEqual(doc.design.idea, PRESET.summary);
  assert.notEqual(doc.design.brief, frase);
  assert.equal(validateSiteDocument(doc).ok, true);
});

test("draft: ownerPrompt no repite el marcador de pendiente", () => {
  const doc = draftSite(normalizeBrief({ name: "Café Aurora", description: "horario pendiente de confirmar" }), PRESET);
  assert.equal(doc.design.ownerPrompt, "");
  assert.doesNotMatch(JSON.stringify(doc), /horario pendiente de confirmar/i);
});

test("draft: sin frase libre ownerPrompt queda vacio y el documento valida", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET);
  assert.equal(doc.design.ownerPrompt, "");
  assert.equal(validateSiteDocument(doc).ok, true);
});
