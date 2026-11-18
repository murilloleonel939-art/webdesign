import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { processDesignJob, fastBudget, AGENT_DESIGN_QUEUE, AGENT_DESIGN_CONCURRENCY, designJobId } from "../dist/index.js";

// Job del agente de diseño (punto C). Sin Redis ni Postgres: todas las
// dependencias son dobles en memoria y cuentan lo que se les pide.
//
// Lo que fijan estas pruebas, en el orden en que importa:
//   1. un diseño bueno se guarda con la revision leida;
//   2. un fallo del modelo NO guarda nada y deja la ejecucion en `error`;
//   3. un borrador que cambió por debajo no se pisa nunca;
//   4. el token se revoca SIEMPRE, incluso por el camino del error.

const RUN = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "text" }, { type: "cta" }],
};

const BRIEF = {
  businessType: "cafetería de especialidad",
  name: "Café Aurora",
  city: "Valencia",
  service: "tueste propio",
  contact: "hola@cafeaurora.test",
};

/** Transporte falso que contesta una sola vez y cuenta sus llamadas. */
function fakeTransport(reply) {
  const t = {
    provider: "fake",
    calls: 0,
    async complete() {
      t.calls += 1;
      if (reply instanceof Error) throw reply;
      return { text: "listo", toolCalls: [], finishReason: "stop", usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 }, model: "fake", latencyMs: 1, ...reply };
    },
  };
  return t;
}

/**
 * Dependencias dobles.
 *
 * `runFastDesign` compone el borrador desde el brief y el preset, no desde el
 * documento actual: lo único que el job necesita del borrador es su `rev`.
 */
function fakeDeps(over = {}) {
  // `checked` guarda los checkpoints PREVIOS: el punto de vuelta atras (9.1).
  const calls = { saved: [], finished: [], revoked: [], checked: [] };
  const transport = over.transport ?? fakeTransport();
  const tracker = over.tracker ?? new BudgetTracker(fastBudget());
  const deps = {
    async loadDraft() {
      return { rev: 7, doc: {} };
    },
    async loadPresets() {
      return over.presets ?? [PRESET];
    },
    async saveCheckpoint(input) {
      if (over.checkpointFails) throw new Error("la tabla no acepta el checkpoint");
      calls.checked.push(input);
    },
    async saveDraft(input) {
      calls.saved.push(input);
      return over.saveResult ?? { ok: true, rev: 8 };
    },
    async finishRun(runId, userId, status, stopReason) {
      calls.finished.push({ runId, userId, status, stopReason });
    },
    async revokeToken(runId, userId) {
      calls.revoked.push({ runId, userId });
    },
    async makeClient() {
      if (over.noClient) return undefined;
      return {
        client: new LlmClient(transport, tracker, { sleep: async () => {} }),
        tracker,
        token: "jti",
        apiBaseUrl: "http://x",
      };
    },
  };
  return { deps, calls, transport, tracker };
}

const JOB = { runId: RUN, siteId: SITE, userId: USER, brief: BRIEF };

test("una cola propia y su concurrencia quedan fijadas", () => {
  assert.equal(AGENT_DESIGN_QUEUE, "agent-design");
  assert.equal(AGENT_DESIGN_CONCURRENCY, 4);
  // Idempotencia: el mismo run no entra dos veces.
  assert.equal(designJobId({ runId: RUN }), `design:${RUN}`);
});

test("el presupuesto del modo rapido trae todos los limites de 8.2", () => {
  const b = fastBudget();
  assert.equal(b.maxTokens > 0, true);
  // Lo que `FAST_BUDGET` no declaraba y el schema completa.
  assert.equal(b.maxContextTokens > 0, true);
});

test("exito: guarda con la revision leida, cierra en ok y revoca el token", async () => {
  const { deps, calls } = fakeDeps();
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "ok");
  assert.equal(r.rev, 8);
  assert.equal(calls.saved.length, 1);
  // La revision esperada es la que se leyo: sin ella, pisaria lo que no debe.
  assert.equal(calls.saved[0].expectedRev, 7);
  assert.equal(calls.saved[0].siteId, SITE);
  assert.equal(calls.saved[0].userId, USER);
  // 9.1: ANTES de escribir se guarda el borrador tal como estaba. Sin este
  // punto de vuelta atras el dueno no podria deshacer el diseno.
  assert.equal(calls.checked.length, 1);
  assert.equal(calls.checked[0].runId, RUN);
  assert.equal(calls.checked[0].rev, 7);
  assert.equal(calls.checked[0].siteId, SITE);
  assert.equal(calls.checked[0].userId, USER);
  assert.match(calls.checked[0].label, /antes del diseno con ia/i);
  assert.equal(calls.finished.length, 1);
  assert.equal(calls.finished[0].status, "ok");
  // El motivo es legible, no un codigo.
  assert.match(calls.finished[0].stopReason, /estilo|pendiente/i);
  assert.deepEqual(calls.revoked, [{ runId: RUN, userId: USER }]);
});

test("fallo del modelo durante la ronda: el diseño sale de datos y se guarda igual", async () => {
  // El transporte revienta; `LlmClient` lo envuelve, agota sus reintentos y
  // `runAgent` nunca deja la ejecucion a medias (9.1): devuelve `stop: done`
  // sin texto. El documento ya estaba construido por `draftSite` ANTES de
  // llamar al modelo, asi que se guarda: lo unico que se pierde es el resumen.
  const { deps, calls } = fakeDeps({ transport: fakeTransport(new Error("502 del gateway")) });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "ok");
  assert.equal(calls.saved.length, 1, "el borrador sale de datos, no del modelo");
  assert.equal(calls.finished[0].status, "ok");
  assert.equal(calls.revoked.length, 1, "el token se revoca tambien cuando el modelo fallo");
});

test("el modelo no se pudo preparar (gateway roto al construir el cliente): error y sin guardar", async () => {
  const { deps, calls } = fakeDeps();
  const roto = {
    ...deps,
    async makeClient() {
      throw new Error("LLM_GATEWAY_URL mal formada");
    },
  };
  const r = await processDesignJob(roto, JOB);

  assert.equal(r.status, "error");
  assert.match(r.stopReason, /no se pudo preparar el modelo/i);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.finished[0].status, "error");
  assert.equal(calls.revoked.length, 1, "el token se revoca aunque el cliente no se pudiera construir");
});

test("sin cliente (gateway caido o token ya revocado) cierra en error", async () => {
  const { deps, calls } = fakeDeps({ noClient: true });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "error");
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.finished[0].status, "error");
  assert.match(calls.finished[0].stopReason, /no esta disponible|diseno/i);
  assert.equal(calls.revoked.length, 1);
});

test("el brief invalido no guarda nada: es error, no un medio diseño", async () => {
  const { deps, calls } = fakeDeps();
  // Sin ningun dato del negocio, `runFastDesign` lanza y no se aplica nada.
  const r = await processDesignJob(deps, { ...JOB, brief: {} });

  assert.equal(r.status, "error");
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.finished[0].status, "error");
  assert.equal(calls.revoked.length, 1);
});

test("conflicto de revision: no sobrescribe y se cierra en error sin reintentar", async () => {
  const { deps, calls } = fakeDeps({ saveResult: { ok: false, reason: "conflict", currentRev: 9 } });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "error");
  // Un solo intento: reintentar pisaria el trabajo del dueno.
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.finished.length, 1);
  assert.equal(calls.finished[0].status, "error");
  assert.match(calls.finished[0].stopReason, /cambio el borrador|no se ha sobrescrito/i);
  assert.equal(calls.revoked.length, 1);
});

test("presupuesto agotado se distingue de un error, y guarda lo que hay", async () => {
  // Tope de tokens a cero: el cliente corta ANTES de llamar al modelo, que es
  // justo lo que 14.1 exige (no se gasta para luego descubrir que no habia).
  const tracker = new BudgetTracker({ ...fastBudget(), maxTokens: 0 });
  const { deps, calls, transport } = fakeDeps({ tracker });
  const r = await processDesignJob(deps, JOB);

  assert.equal(transport.calls, 0);
  assert.equal(r.status, "budget_exhausted");
  assert.equal(calls.finished[0].status, "budget_exhausted");
  assert.match(calls.finished[0].stopReason, /presupuesto/i);
  // El borrador ya estaba hecho: se guarda igual.
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.revoked.length, 1);
});

test("sin catalogo de presets tampoco se escribe: el diseño sale de datos", async () => {
  const { deps, calls } = fakeDeps({ presets: [] });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "error");
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.revoked.length, 1);
});

test("si guardar revienta, el token se revoca igual (finally)", async () => {
  const { deps } = fakeDeps();
  const revoked = [];
  const roto = {
    ...deps,
    async saveDraft() {
      throw new Error("la base no contesta");
    },
    async revokeToken(runId, userId) {
      revoked.push({ runId, userId });
    },
  };
  await assert.rejects(() => processDesignJob(roto, JOB), /la base no contesta/);
  assert.deepEqual(revoked, [{ runId: RUN, userId: USER }]);
});

test("sin punto de vuelta atras no se escribe nada en el borrador", async () => {
  // Guardar el checkpoint es requisito, no un extra: un cambio sin retorno es
  // peor que no cambiar. Se cierra en `error` y no se toca el sitio.
  const { deps, calls } = fakeDeps({ checkpointFails: true });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "error");
  assert.match(r.stopReason, /vuelta atras/i);
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.revoked.length, 1);
});

test("presupuesto agotado con conflicto: no dice que guardo lo que no guardo", async () => {
  // El caso que faltaba: en el camino del presupuesto `saveDraft` tambien puede
  // fallar. Antes se cerraba `budget_exhausted` y se daba por aplicado un
  // trabajo que no llego al borrador; el dueno leia "listo" y veia lo de antes.
  const tracker = new BudgetTracker({ ...fastBudget(), maxTokens: 0 });
  const { deps, calls } = fakeDeps({ tracker, saveResult: { ok: false, reason: "conflict", currentRev: 9 } });
  const r = await processDesignJob(deps, JOB);

  assert.equal(r.status, "budget_exhausted");
  assert.equal(calls.finished[0].status, "budget_exhausted");
  // El motivo dice las dos cosas: se acabo el presupuesto Y no se guardo.
  assert.match(calls.finished[0].stopReason, /presupuesto/i);
  assert.match(calls.finished[0].stopReason, /no se ha sobrescrito nada/i);
  assert.equal(r.rev, undefined);
  assert.equal(calls.revoked.length, 1);
});
