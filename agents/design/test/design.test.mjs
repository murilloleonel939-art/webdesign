import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { siteDocumentSchema, validateSiteDocument } from "@webdesign/site-schema";
import { lintSite } from "@webdesign/linter";
import { renderPage } from "@webdesign/renderer";
import {
  BRIEF_FIELDS,
  PENDING_MARKER,
  designAgent,
  draftSite,
  inventory,
  normalizeBrief,
  planSections,
  runFastDesign,
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
  // Testimonio y ventajas degradan a texto: inventarlos sería fabricar datos.
  assert.ok(sections.every((s) => s.type !== "testimonial"));
  assert.ok(sections.every((s) => s.type !== "features"));
  assert.equal(doc.theme.colors.accent, PRESET.colors.accent);

  // Ningún precio del preset se hereda.
  const priced = draftSite(normalizeBrief(BRIEF), { ...PRESET, sections: [{ type: "pricing" }] });
  const plans = priced.pages[0].sections.find((s) => s.type === "pricing").props.plans;
  assert.notEqual(plans[0].price, "19 €");
  assert.deepEqual(plans[0].features, []);
});

test("draft: 6.4 no devuelve ningún error y el marcador llega al HTML", () => {
  const doc = draftSite(normalizeBrief({ name: "Café Aurora" }), PRESET);
  assert.deepEqual(lintSite(doc).filter((f) => f.severity === "error"), []);
  assert.match(renderPage(doc, "p_home"), /pendiente de confirmar/i);
});

test("inventario: separa lo afirmado de lo que falta, sin interpretar", () => {
  const inv = inventory(normalizeBrief({ name: "Café Aurora", city: "Valencia" }));
  assert.deepEqual(inv.known.map((k) => k.field), ["name", "city"]);
  assert.deepEqual(inv.missing.map((m) => m.field), ["businessType", "service", "contact"]);
  // El inventario y el borrador no pueden discrepar: ambos leen del mismo brief.
  assert.deepEqual(inv.missing.map((m) => m.field), normalizeBrief({ name: "Café Aurora", city: "Valencia" }).pending);
});

test("plan: degrada testimonios y ventajas, omite imágenes sin assets", () => {
  const plan = planSections(normalizeBrief(BRIEF), PRESET);
  assert.equal(plan.presetId, PRESET.id);
  assert.deepEqual(plan.sections.map((s) => s.action), ["write", "write", "degrade", "degrade", "write"]);
  // Ningún plan puede dejar el documento sin h1.
  assert.equal(plan.sections[0].as, "hero");
  const noHero = planSections(normalizeBrief(BRIEF), { ...PRESET, sections: [{ type: "gallery" }, { type: "text" }] });
  assert.equal(noHero.sections[0].type, "hero");
  assert.equal(noHero.sections[0].reason, "h1_obligatorio");
  assert.ok(noHero.sections.some((s) => s.type === "gallery" && s.action === "omit"));
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
  // Ni el modelo ni el agente sustituyen el marcador.
  assert.match(JSON.stringify(out.doc), /pendiente de confirmar/);
  // El panel recibe el motivo de cada decisión, no una caja negra.
  assert.ok(out.plan.sections.every((s) => typeof s.reason === "string" && s.reason.length > 0));
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
  const { client, tracker } = fakeClient(copyWithPhotosJson());
  const pool = [1, 2, 3, 4, 5].map((n) => ({ assetId: `ph${n}`, alt: `foto ${n}` }));
  const fetchPhotos = async ({ count }) => pool.slice(0, count);
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("photos-ok"), fetchPhotos });

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

test("runFastDesign: copy con 2 servicios -> features con 2 items, sin marcador en doc.pages", async () => {
  const copy = JSON.parse(copyWithPhotosJson());
  copy.services = copy.services.slice(0, 2);
  const { client, tracker } = fakeClient(JSON.stringify(copy));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("copy-2") });

  const features = out.doc.pages[0].sections.find((s) => s.id === "s_features");
  assert.equal(features.props.items.length, 2);
  assert.doesNotMatch(JSON.stringify(out.doc.pages), /pendiente de confirmar/);
});

test("runFastDesign: plan y documento coinciden cuando el about se poda", async () => {
  const copy = JSON.parse(copyWithPhotosJson());
  copy.aboutBody = "Somos la empresa líder del sector y estamos certificados.";
  const { client, tracker } = fakeClient(JSON.stringify(copy));
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX("copy-about") });

  // Podado por la guardia: ni seccion `text` en el documento ni accion `write`.
  assert.equal(out.doc.pages[0].sections.some((s) => s.type === "text"), false);
  const textPlan = out.plan.sections.filter((s) => s.as === "text");
  assert.deepEqual(textPlan.map((s) => [s.action, s.reason]), [["omit", "sin_about_del_dueno"]]);
});

test("runFastDesign: un brief sin ningún dato se rechaza en vez de inventarlo", async () => {
  const { client, tracker } = fakeClient("x");
  await assert.rejects(runFastDesign({ brief: {}, presets: [PRESET], client, tracker, ctx: CTX("r3") }), /brief vacio/);
});

test("runFastDesign: sin presets no se inventa una familia nueva", async () => {
  const { client, tracker } = fakeClient("x");
  await assert.rejects(runFastDesign({ brief: BRIEF, presets: [], client, tracker, ctx: CTX("r4") }), /no hay presets/);
});
