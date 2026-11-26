import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient, LlmError } from "@webdesign/llm";
import { validateSiteDocument } from "@webdesign/site-schema";
import { copyPrompt, genericCopy, normalizeBrief, runFastDesign } from "../dist/index.js";

// P0-transporte-y-fotos: dos fallos de produccion con el mismo origen, el motivo
// del fallo de transporte se perdia.
//
//   1. `read` devolvia `transport_${stop.kind}` ("done" | "budget"), asi que un
//      502 del proveedor llegaba como `transport_done` y el reintento del copy se
//      cortaba con `reason.startsWith("transport_")`. Con `maxRetries: 0` en el
//      worker, un solo 502 perdia el copy del modelo.
//   2. `loadPhotos` salia por `copy === undefined` sin pedir fotos, asi que el
//      fallo del modelo se cobraba dos veces: textos y fotos.
//
// Sin red: el transporte es falso, como en el resto del paquete.

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

// Clasifica como landing: la seccion `gallery` solo existe en esa forma, y sin
// ella no hay `assets` de galeria que comprobar.
const LANDING_BRIEF = {
  businessType: "diseño web",
  name: "Studio Aurora",
  city: "Valencia",
  service: "webs y branding",
  contact: "hola@studioaurora.test",
};

const BUDGET = { maxTokens: 100_000, maxToolCalls: 5, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 24_000 };
const CTX = { runId: "transport", userId: "u1", token: "t", locale: "es", apiBaseUrl: "http://x" };

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

const COPY_PROMPT = copyPrompt(normalizeBrief(BRIEF));

/** Llamadas de copy: el reintento es el mismo prompt mas `retryLine`. */
const copyCalls = (transport) => transport.calls.filter((c) => c.startsWith(COPY_PROMPT)).length;

/**
 * Transporte falso con guion: cada llamada consume un paso y el ultimo se
 * repite. `{ fail: code }` lanza un `LlmError` como el transporte real ante un
 * 502, un timeout o un limite; `{ text }` devuelve una respuesta valida.
 */
function scriptedTransport(script) {
  const transport = {
    provider: "fake",
    calls: [],
    async complete(req) {
      this.calls.push(req.messages.at(-1).content);
      const step = script[Math.min(this.calls.length - 1, script.length - 1)] ?? {};
      if (step.fail !== undefined) throw new LlmError(step.fail, "fallo simulado");
      return {
        text: step.text ?? "Resumen final.",
        toolCalls: [],
        finishReason: step.finishReason ?? "stop",
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
        model: "fake",
        latencyMs: 1,
      };
    },
  };
  return transport;
}

/**
 * Cliente falso con guion de `ClientResult`.
 *
 * Solo para el caso `budget`: el presupuesto se comprueba antes de llamar y no
 * se recupera, asi que un `LlmClient` real no puede fallar por presupuesto en el
 * primer intento y responder en el segundo. El doble reproduce el contrato
 * (`{ ok: false, stop }`), que es lo unico que mira el agente.
 */
function scriptedClient(script) {
  const client = {
    calls: [],
    async complete(req) {
      this.calls.push(req.messages.at(-1).content);
      const step = script[Math.min(this.calls.length - 1, script.length - 1)] ?? {};
      if ("stop" in step) return { ok: false, stop: step.stop, ...(step.error ? { error: step.error } : {}) };
      return {
        ok: true,
        result: {
          text: step.text ?? "Resumen final.",
          toolCalls: [],
          finishReason: step.finishReason ?? "stop",
          usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
          model: "fake",
          latencyMs: 1,
        },
      };
    },
  };
  return client;
}

const genericHeadline = genericCopy(normalizeBrief(BRIEF)).heroHeadline;

const heroHeadline = (doc) => doc.pages[0].sections.find((s) => s.type === "hero")?.props.headline;

// --- Bug 1: el transporte reintenta lo que puede salir bien a la segunda ------

test("transporte: un provider_error reintenta y el sitio sale con el copy del modelo", async () => {
  // Produccion: `maxRetries: 0` en el worker, un 502 del proveedor y el copy se
  // perdia entero. Ahora el primer intento falla, el reintento del agente trae
  // copy valido y no hay aviso.
  const transport = scriptedTransport([{ fail: "provider_error" }, { text: JSON.stringify(validCopy()) }]);
  const tracker = new BudgetTracker(BUDGET);
  const client = new LlmClient(transport, tracker, { maxRetries: 0 });

  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });

  assert.equal(copyCalls(transport), 2, "un reintento del copy tras el provider_error");
  assert.equal(
    out.warnings.some((w) => w.startsWith("copy_fallback")),
    false,
    `warnings: ${out.warnings}`,
  );
  assert.equal(heroHeadline(out.doc), validCopy().heroHeadline);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

test("transporte: un budget no reintenta y el sitio sale con genericCopy", async () => {
  // `transport_budget`: no queda saldo, otra llamada no se puede pagar.
  const client = scriptedClient([
    { stop: { kind: "budget", limit: "tokens" } },
    { text: JSON.stringify(validCopy()) },
  ]);
  const tracker = new BudgetTracker(BUDGET);

  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });

  assert.equal(copyCalls(client), 1, "el presupuesto agotado no se reintenta");
  assert.ok(
    out.warnings.includes("copy_fallback: transport_budget"),
    `warnings: ${out.warnings}`,
  );
  assert.equal(heroHeadline(out.doc), genericHeadline);
  assert.equal(validateSiteDocument(out.doc).ok, true);
});

for (const code of ["refused", "invalid_request"]) {
  test(`transporte: un ${code} no reintenta (una sola llamada del copy)`, async () => {
    // Reintentar no puede cambiar el resultado: el modelo ya dijo que no.
    const transport = scriptedTransport([{ fail: code }, { text: JSON.stringify(validCopy()) }]);
    const tracker = new BudgetTracker(BUDGET);
    const client = new LlmClient(transport, tracker, { maxRetries: 0 });

    const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker, ctx: CTX });

    assert.equal(copyCalls(transport), 1, `${code} no se reintenta`);
    assert.ok(
      out.warnings.includes(`copy_fallback: transport_${code}`),
      `warnings: ${out.warnings}`,
    );
    assert.equal(heroHeadline(out.doc), genericHeadline);
  });
}

test("transporte: el motivo lleva la causa real, no `stop.kind`", async () => {
  // Los siete valores del contrato. Reintentables (timeout, rate_limit,
  // provider_error, unknown) se quedan con el motivo del ULTIMO intento, que es
  // el que se publica; los demas salen del primero.
  const cases = [
    { code: "timeout", reason: "transport_timeout" },
    { code: "rate_limit", reason: "transport_rate_limit" },
    { code: "provider_error", reason: "transport_provider_error" },
    { code: "invalid_request", reason: "transport_invalid_request" },
    { code: "refused", reason: "transport_refused" },
  ];
  for (const { code, reason } of cases) {
    const client = scriptedClient([{ stop: { kind: "done" }, error: new LlmError(code, "fallo") }]);
    const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client, tracker: new BudgetTracker(BUDGET), ctx: CTX });
    assert.ok(out.warnings.includes(`copy_fallback: ${reason}`), `${code} -> ${reason}; warnings: ${out.warnings}`);
  }

  // Sin `error` no hay causa: `unknown` (y reintenta, por si fue un corte raro).
  const unknown = scriptedClient([{ stop: { kind: "done" } }]);
  const out = await runFastDesign({ brief: BRIEF, presets: [PRESET], client: unknown, tracker: new BudgetTracker(BUDGET), ctx: CTX });
  assert.ok(out.warnings.includes("copy_fallback: transport_unknown"), `warnings: ${out.warnings}`);
  assert.equal(copyCalls(unknown), 2, "unknown se reintenta: no se sabe que paso");
});

// --- Bug 2: sin copy del modelo tambien se piden fotos ----------------------

function photoPool() {
  return [1, 2, 3, 4, 5].map((n) => ({ assetId: `ph${n}`, alt: `foto ${n}` }));
}

test("fotos: sin copy del modelo se buscan con las consultas del copy generico", async () => {
  // Antes: `copy === undefined` devolvia undefined y Pexels no se llamaba nunca.
  const transport = scriptedTransport([{ text: "esto no es json en absoluto" }]);
  const tracker = new BudgetTracker(BUDGET);
  const client = new LlmClient(transport, tracker, { maxRetries: 0 });
  const queries = [];
  const pool = photoPool();
  const fetchPhotos = async ({ query, count }) => {
    queries.push(query);
    return pool.slice(0, count);
  };

  const out = await runFastDesign({ brief: LANDING_BRIEF, presets: [PRESET], client, tracker, ctx: CTX, fetchPhotos });

  assert.ok(out.warnings.some((w) => w.startsWith("copy_fallback")), `warnings: ${out.warnings}`);
  assert.equal(out.warnings.includes("photos_unavailable"), false, `warnings: ${out.warnings}`);
  const generic = genericCopy(normalizeBrief(LANDING_BRIEF)).photoQueries;
  assert.deepEqual([...queries].sort(), [generic.hero, generic.gallery].sort());
  assert.ok(out.doc.assets.length > 0, "el documento lleva activos con el modelo caido");
  const hero = out.doc.pages[0].sections.find((s) => s.type === "hero");
  assert.equal(hero.props.image, "ph1");
});

test("fotos: con copy del modelo se siguen usando SUS consultas", async () => {
  const modelQueries = { hero: "design studio desk", gallery: "portfolio details" };
  const transport = scriptedTransport([{ text: JSON.stringify(validCopy({ photoQueries: modelQueries })) }]);
  const tracker = new BudgetTracker(BUDGET);
  const client = new LlmClient(transport, tracker, { maxRetries: 0 });
  const queries = [];
  const pool = photoPool();
  const fetchPhotos = async ({ query, count }) => {
    queries.push(query);
    return pool.slice(0, count);
  };

  const out = await runFastDesign({ brief: LANDING_BRIEF, presets: [PRESET], client, tracker, ctx: CTX, fetchPhotos });

  assert.equal(out.warnings.some((w) => w.startsWith("copy_fallback")), false, `warnings: ${out.warnings}`);
  assert.deepEqual([...queries].sort(), [modelQueries.hero, modelQueries.gallery].sort());
  assert.ok(out.doc.assets.length > 0);
});
