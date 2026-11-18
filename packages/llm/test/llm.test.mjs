import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient, costOf, resolveModel, LlmError } from "../dist/index.js";

// Spec 8.3: el presupuesto tiene que ser explicable y el proveedor caido no
// puede dejar una ejecucion colgada. Se prueba con un transporte falso: sin red
// y sin dormir de verdad.

const BUDGET = { maxTokens: 1000, maxToolCalls: 3, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 500 };
const tracker = () => new BudgetTracker(BUDGET);
const noSleep = () => Promise.resolve();

const okTransport = (tokensIn = 10, tokensOut = 5) => ({
  provider: "fake",
  calls: 0,
  async complete() {
    this.calls += 1;
    return {
      text: "hola", toolCalls: [], finishReason: "stop",
      usage: { tokensIn, tokensOut, costUsd: 0 }, model: "x", latencyMs: 1,
    };
  },
});

test("el coste se calcula con la tabla, no con lo que diga el proveedor", () => {
  const m = resolveModel("fast-small");
  assert.equal(costOf("fast-small", 1000, 1000), 1000 * m.usdIn + 1000 * m.usdOut);
  // Un proveedor que mienta sobre el coste no altera la contabilidad.
  assert.throws(() => resolveModel("no-existe"), /unknown model alias/);
});

test("el tope de tokens corta antes de llamar", async () => {
  const t = tracker();
  const client = new LlmClient(okTransport(), t, { sleep: noSleep });
  const r = await client.complete({
    model: "fast-small", maxOutputTokens: 2000,
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.stop, { kind: "budget", limit: "tokens" });
});

test("el contexto excesivo se para aunque quepa en tokens", async () => {
  const t = tracker();
  const client = new LlmClient(okTransport(), t, { sleep: noSleep });
  const r = await client.complete({
    model: "fast-small", maxOutputTokens: 900,
    messages: [{ role: "user", content: "x" }],
  });
  // 900 > maxContextTokens (500): se detecta antes que el tope global.
  assert.equal(r.ok, false);
  assert.deepEqual(r.stop, { kind: "budget", limit: "context" });
});

test("el tope de llamadas a herramienta evita el bucle infinito", () => {
  const t = tracker();
  t.countToolCall(); t.countToolCall(); t.countToolCall();
  assert.deepEqual(t.checkToolCall(), { kind: "budget", limit: "tool_calls" });
});

test("el tiempo agotado se detecta sin llamar al proveedor", async () => {
  const t = new BudgetTracker({ ...BUDGET, timeoutMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const client = new LlmClient(okTransport(), t, { sleep: noSleep });
  const r = await client.complete({
    model: "fast-small", maxOutputTokens: 1, messages: [{ role: "user", content: "x" }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.stop, { kind: "budget", limit: "time" });
});

test("el consumo real se acumula con los tokens del proveedor", async () => {
  const t = tracker();
  const client = new LlmClient(okTransport(100, 50), t, { sleep: noSleep });
  const r = await client.complete({
    model: "fast-small", maxOutputTokens: 10, messages: [{ role: "user", content: "x" }],
  });
  assert.equal(r.ok, true);
  assert.equal(t.snapshot.tokens, 150);
  assert.ok(t.snapshot.costUsd > 0);
});

test("un rate limit se reintenta y acaba bien", async () => {
  let n = 0;
  const flaky = {
    provider: "fake",
    async complete() {
      n += 1;
      if (n < 3) throw new LlmError("rate_limit", "429");
      return { text: "ya", toolCalls: [], finishReason: "stop", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 }, model: "x", latencyMs: 1 };
    },
  };
  const client = new LlmClient(flaky, tracker(), { sleep: noSleep, maxRetries: 3 });
  const r = await client.complete({ model: "fast-small", maxOutputTokens: 5, messages: [{ role: "user", content: "x" }] });
  assert.equal(r.ok, true);
  assert.equal(n, 3);
});

test("un 4xx no se reintenta: reintentarlo solo gasta cuota", async () => {
  let n = 0;
  const bad = {
    provider: "fake",
    async complete() { n += 1; throw new LlmError("invalid_request", "400"); },
  };
  const client = new LlmClient(bad, tracker(), { sleep: noSleep, maxRetries: 3 });
  const r = await client.complete({ model: "fast-small", maxOutputTokens: 5, messages: [{ role: "user", content: "x" }] });
  assert.equal(r.ok, false);
  assert.equal(n, 1, "un error de peticion no debe repetirse");
});

test("el circuit breaker abre tras varios fallos y falla rapido", async () => {
  const down = {
    provider: "fake",
    async complete() { throw new LlmError("provider_error", "caido"); },
  };
  let now = 0;
  const client = new LlmClient(down, tracker(), { sleep: noSleep, maxRetries: 0, breakerThreshold: 2, breakerCooldownMs: 1000, now: () => now });
  const req = { model: "fast-small", maxOutputTokens: 5, messages: [{ role: "user", content: "x" }] };
  await client.complete(req);
  await client.complete(req);
  assert.equal(client.breakerState, "open");
  // Abierto: la tercera ni siquiera llama al proveedor.
  const r = await client.complete(req);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /circuit open/);
});

test("el circuito se cierra solo al pasar el enfriamiento", async () => {
  let fail = true;
  let now = 0;
  const t = {
    provider: "fake",
    async complete() {
      if (fail) throw new LlmError("provider_error", "caido");
      return { text: "ok", toolCalls: [], finishReason: "stop", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 }, model: "x", latencyMs: 1 };
    },
  };
  const client = new LlmClient(t, tracker(), { sleep: noSleep, maxRetries: 0, breakerThreshold: 1, breakerCooldownMs: 100, now: () => now });
  const req = { model: "fast-small", maxOutputTokens: 5, messages: [{ role: "user", content: "x" }] };
  await client.complete(req);
  assert.equal(client.breakerState, "open");
  now = 200;
  fail = false;
  assert.equal(client.breakerState, "half_open");
  const r = await client.complete(req);
  assert.equal(r.ok, true);
  assert.equal(client.breakerState, "closed");
});

test("el alias no cruza al proveedor: el cliente lo pasa y el gateway traduce", async () => {
  // `LlmClient` razona en alias (es lo que tiene coste en la tabla); el id real
  // del modelo solo lo conoce el transporte. Aqui se fija la frontera: lo que
  // se devuelve al llamante es el id, no el alias.
  const seen = {};
  const spy = {
    provider: "fake",
    async complete(req) {
      seen.model = req.model;
      return { text: "", toolCalls: [], finishReason: "stop", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 }, model: "x", latencyMs: 0 };
    },
  };
  const r = await new LlmClient(spy, tracker(), { sleep: noSleep }).complete({
    model: "design", maxOutputTokens: 10, messages: [{ role: "user", content: "x" }],
  });
  assert.equal(r.ok, true);
  assert.equal(seen.model, "design", "el transporte recibe el alias");
  assert.equal(r.result.model, resolveModel("design").id, "al llamante se le devuelve el id real");
  assert.equal(r.result.model, "claude-sonnet-5");
});
