import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { callTool } from "@webdesign/agent-sdk";
import { validateSiteDocument } from "@webdesign/site-schema";
import {
  PENDING_MARKER,
  applyMutation,
  createStore,
  designAgent,
  draftSite,
  makeDesignTools,
  normalizeBrief,
  runFastDesign,
} from "../dist/index.js";
import { runAgent } from "@webdesign/agent-sdk";

// Pruebas de FUNCIONAMIENTO del agente de diseño (aceptación del equipo de
// pruebas). Sin red: el modelo es un transporte falso, como en loop.test.mjs.

const BUDGET = { maxTokens: 100_000, maxToolCalls: 5, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 24_000 };
const CTX = { runId: "acc", userId: "u1", token: "t", locale: "es", apiBaseUrl: "http://x" };

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "text" }, { type: "testimonial" }, { type: "cta" }],
};
// Preset con precio: tras un hero, un `pricing` produce SLOP_HEADING_SKIP (error 6.5).
const PRICED = { ...PRESET, sections: [{ type: "hero" }, { type: "pricing" }] };

const BRIEFS = {
  cafeteria: { businessType: "cafetería de especialidad", name: "Café Aurora", city: "Valencia", service: "tueste propio", contact: "hola@cafeaurora.test" },
  dental: { businessType: "clínica dental", name: "Clínica Sonrisa", city: "Sevilla", service: "implantes", contact: "600 111 222" },
  abogado: { businessType: "abogado", name: "Despacho Romero", city: "Madrid", service: "derecho laboral", contact: "+34 600 333 444" },
  vacio: { name: "Café Aurora" },
};

/** Transporte falso: devuelve respuestas guionizadas y cuenta las llamadas. */
function scripted(replies) {
  let n = 0;
  const transport = {
    provider: "fake",
    calls: 0,
    async complete() {
      transport.calls += 1;
      const r = replies[n++] ?? { text: "fin", toolCalls: [], finishReason: "stop" };
      return { ...r, usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 }, model: "fake", latencyMs: 1 };
    },
  };
  return transport;
}

const toolCall = (name, args) => ({ text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name, args }] });
const STOP = { text: "listo", toolCalls: [], finishReason: "stop" };
const byName = (tools, name) => tools.find((t) => t.name === name);

// a) Cuatro briefs distintos producen un SiteDocument válido.
for (const [label, brief] of Object.entries(BRIEFS)) {
  test(`a) brief ${label} produce un SiteDocument valido`, () => {
    const doc = draftSite(normalizeBrief(brief), PRESET);
    const check = validateSiteDocument(doc);
    assert.equal(check.ok, true, check.ok ? "" : check.errors.join("; "));
  });
}

// b) Ninguna herramienta publica; un modelo que pide publicar no publica nada.
test("b) ninguna herramienta exportada tiene 'publish' en el nombre", () => {
  const names = makeDesignTools(createStore(draftSite(normalizeBrief(BRIEFS.cafeteria), PRESET))).map((t) => t.name);
  assert.ok(names.length > 0);
  assert.deepEqual(names.filter((n) => /publish/i.test(n)), []);
});

test("b) si el modelo pide publish_site, el documento no cambia y no hay llamadas", async () => {
  const doc = draftSite(normalizeBrief(BRIEFS.cafeteria), PRESET);
  const store = createStore(doc);
  const before = structuredClone(store.doc);
  const transport = scripted([toolCall("publish_site", {}), STOP]);
  const tracker = new BudgetTracker(BUDGET);
  const r = await runAgent({
    agent: designAgent,
    client: new LlmClient(transport, tracker),
    tracker,
    tools: makeDesignTools(store),
    ctx: CTX,
    messages: [{ role: "user", content: "publica el sitio" }],
    opts: { maxRounds: 2 },
  });
  assert.equal(r.usage.calls, 0, "una herramienta inexistente no cuenta como llamada");
  assert.deepEqual(store.doc, before);
});

// c) Lo que falta sale como marcador y en pending; sin cifras ni nombres inventados.
test("c) campos faltantes salen como 'pendiente de confirmar' y en pending", () => {
  const brief = normalizeBrief(BRIEFS.vacio);
  assert.deepEqual(brief.pending, ["businessType", "city", "service", "contact"]);
  const doc = draftSite(brief, PRESET);
  assert.match(JSON.stringify(doc), new RegExp(PENDING_MARKER));
  assert.equal(doc.meta.name, "Café Aurora");
});

test("c) testimonial y pricing no inventan cifras ni nombres", () => {
  const doc = draftSite(normalizeBrief(BRIEFS.vacio), { ...PRESET, sections: [{ type: "testimonial" }, { type: "pricing" }] });
  const json = JSON.stringify(doc);
  assert.equal(doc.pages[0].sections.some((s) => s.type === "testimonial"), false, "testimonio degradado a texto");
  assert.doesNotMatch(json, /\d+\s?€|€\s?\d+|\$\s?\d+/, "ninguna cifra de precio");
  const plans = doc.pages[0].sections.find((s) => s.type === "pricing")?.props.plans ?? [];
  assert.equal(plans[0]?.name, PENDING_MARKER);
  assert.deepEqual(plans[0]?.features, []);
});

// d) Checkpoint previo y revert restaura el documento exacto.
test("d) tras una mutacion existe checkpoint previo y revert restaura el documento exacto", async () => {
  const doc = draftSite(normalizeBrief(BRIEFS.cafeteria), PRESET);
  const store = createStore(doc);
  const original = structuredClone(store.doc);
  const tools = makeDesignTools(store);
  const ctx = CTX;

  const cp = await callTool(byName(tools, "create_checkpoint"), ctx, {});
  assert.equal(cp.ok, true);
  const checkpointId = cp.data.checkpointId;

  const mut = await callTool(byName(tools, "add_section"), ctx, {
    pageId: "p_home",
    section: { id: "s_extra", type: "text", props: { body: PENDING_MARKER } },
  });
  assert.equal(mut.ok, true);
  assert.equal(mut.data.ok, true, "la mutacion se aplica");
  assert.notDeepEqual(store.doc, original, "la mutacion cambia el documento");

  assert.ok(store.checkpoints.some((c) => c.id === checkpointId), "el checkpoint existe");
  const rev = await callTool(byName(tools, "revert_to_checkpoint"), ctx, { checkpointId });
  assert.equal(rev.ok, true);
  assert.deepEqual(store.doc, original);
});

// e) Una mutación que invalida el documento se rechaza y el store no cambia.
test("e) mutacion que invalida el documento se rechaza y el store no cambia", async () => {
  const store = createStore(draftSite(normalizeBrief(BRIEFS.cafeteria), PRESET));
  const before = structuredClone(store.doc);
  const ref = store.doc;

  const res = applyMutation(store, (d) => {
    d.pages[0].sections.push({ id: "s_roto", type: "no_existe", props: {} });
  });
  assert.equal(res.ok, false);
  assert.equal(store.doc, ref, "misma referencia: el store no se tocó");
  assert.deepEqual(store.doc, before);

  // A través de la herramienta: dato MUTATION_REJECTED, no excepción.
  const tools = makeDesignTools(store);
  const out = await callTool(byName(tools, "add_section"), CTX, {
    pageId: "p_home",
    section: { id: "s_roto", type: "no_existe", props: {} },
  });
  assert.equal(out.ok, true);
  assert.equal(out.data.ok, false);
  assert.equal(out.data.errorCode, "MUTATION_REJECTED");
  assert.deepEqual(store.doc, before);
});

// f) Un error de 6.5 pedido por el dueño aparece en warnings y no revierte.
test("f) error 6.5 con ownerRequested=true aparece en warnings sin revertir", async () => {
  const tracker = new BudgetTracker(BUDGET);
  const out = await runFastDesign({
    brief: BRIEFS.cafeteria,
    presets: [PRICED],
    client: new LlmClient(scripted([STOP]), tracker),
    tracker,
    ctx: CTX,
    ownerRequested: true,
  });
  assert.ok(out.findings6_5.some((f) => f.severity === "error" && f.code === "SLOP_HEADING_SKIP"), "el 6.5 de error existe");
  assert.ok(out.warnings.some((w) => /6\.5/.test(w) && /SLOP_HEADING_SKIP/.test(w)), `warnings: ${out.warnings}`);
  assert.ok(out.doc.pages[0].sections.some((s) => s.type === "pricing"), "el documento no se revierte");
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

// Spec 9.1: "el agente nunca se bloquea a si mismo ni bloquea al dueno por una
// regla de estilo". Un `error` de 6.5 sin peticion del dueno tambien se entrega,
// con aviso; lanzar dejaria al dueno sin borrador por un defecto de estilo.
test("f) sin ownerRequested, el error 6.5 tampoco bloquea: entrega con aviso", async () => {
  const tracker = new BudgetTracker(BUDGET);
  const out = await runFastDesign({ brief: BRIEFS.cafeteria, presets: [PRICED], client: new LlmClient(scripted([STOP]), tracker), tracker, ctx: CTX });
  assert.ok(out.warnings.some((w) => /6\.5/.test(w) && /SLOP_HEADING_SKIP/.test(w)), `warnings: ${out.warnings}`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

// g) Modo rápido: el BUCLE del agente se llama como mucho una vez.
//
// El transporte recibe dos llamadas: la primera es el copy (9.1, generate_copy),
// que va ANTES del borrador y fuera del bucle; la segunda es la única ronda del
// agente. El copy tiene que leerse a la primera (JSON válido) para no gastar su
// reintento y así dejar las dos peticiones de herramienta solo para el bucle.
// Lo que este test protege es lo de dentro del bucle, no el total.
const COPY_JSON = JSON.stringify({
  businessType: "cafetería de especialidad",
  heroHeadline: "Café Aurora en Valencia",
  heroSubline: "",
  heroCta: "Escribir",
  servicesHeading: "Servicios",
  services: [{ title: "Tueste propio", body: "Tostamos el grano en casa." }],
  processHeading: "Cómo trabajamos",
  process: [{ title: "Nos escribes", body: "Cuéntanos qué necesitas." }],
  aboutHeading: "Quiénes somos",
  aboutBody: "Cafetería de especialidad en Valencia.",
  faq: [],
  closingHeadline: "Hablemos",
  closingCta: "Escribir",
  seoDescription: "Cafetería de especialidad en Valencia.",
});
test("g) modo rapido: el modelo se llama como mucho 1 vez en el bucle, aunque pida mas herramientas", async () => {
  const transport = scripted([
    { text: COPY_JSON, toolCalls: [], finishReason: "stop" },
    toolCall("add_section", { pageId: "p_home", section: { id: "s_x", type: "text", props: { body: PENDING_MARKER } } }),
    toolCall("add_section", { pageId: "p_home", section: { id: "s_y", type: "text", props: { body: PENDING_MARKER } } }),
    STOP,
  ]);
  const tracker = new BudgetTracker(BUDGET);
  const out = await runFastDesign({
    brief: BRIEFS.cafeteria,
    presets: [PRESET],
    client: new LlmClient(transport, tracker),
    tracker,
    ctx: CTX,
  });
  // Dos como mucho: el copy (JSON válido a la primera) y la ronda. Nunca una
  // tercera peticion de herramienta.
  assert.ok(transport.calls <= 2, `el modelo se llamo ${transport.calls} veces`);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});
