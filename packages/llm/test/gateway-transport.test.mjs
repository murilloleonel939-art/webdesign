import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayTransport, LlmError } from "../dist/index.js";

// Transporte hacia `llm-gateway` (punto A). Sin red: el `fetch` se inyecta como
// doble y cuenta las llamadas. Lo que se comprueba es que NINGUN camino de
// error sale como excepcion ajena a `LlmError`.

const OPTS = { baseUrl: "http://gw:3001/", runId: "run-1", token: "jti-1" };
const REQ = { model: "fast-small", messages: [{ role: "user", content: "hola" }], maxOutputTokens: 100 };

/** Doble de `fetch` que devuelve una respuesta preparada. */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { impl, calls };
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
});

test("exito: manda el token, el runId y devuelve lo que contesta el gateway", async () => {
  const { impl, calls } = fakeFetch(jsonResponse(200, {
    text: "hecho",
    toolCalls: [{ id: "1", name: "set_section", args: { a: 1 } }],
    finishReason: "tool_calls",
    usage: { tokensIn: 12, tokensOut: 3, costUsd: 0 },
    model: "gpt-4o-mini",
  }));
  const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
  const r = await t.complete(REQ);

  assert.equal(calls.length, 1);
  // La barra final sobra: no se duplica en la ruta.
  assert.equal(calls[0].url, "http://gw:3001/v1/complete");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer jti-1");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.runId, "run-1");
  assert.equal(sent.model, "fast-small");
  assert.equal(sent.maxOutputTokens, 100);

  assert.equal(r.text, "hecho");
  assert.deepEqual(r.toolCalls, [{ id: "1", name: "set_section", args: { a: 1 } }]);
  assert.equal(r.finishReason, "tool_calls");
  assert.deepEqual(r.usage, { tokensIn: 12, tokensOut: 3, costUsd: 0 });
  assert.equal(r.model, "gpt-4o-mini");
  assert.equal(typeof r.latencyMs, "number");
});

test("429 del gateway se convierte en rate_limit, no en excepcion", async () => {
  const { impl } = fakeFetch(jsonResponse(429, { error: "budget_exhausted" }));
  const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
  const e = await t.complete(REQ).then(() => null, (err) => err);
  assert.ok(e instanceof LlmError);
  assert.equal(e.code, "rate_limit");
});

test("401, 403 y 409 son invalid_request: la peticion no vale", async () => {
  for (const status of [401, 403, 409]) {
    const { impl } = fakeFetch(jsonResponse(status, { error: "x" }));
    const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
    const e = await t.complete(REQ).then(() => null, (err) => err);
    assert.ok(e instanceof LlmError, `status ${status}`);
    assert.equal(e.code, "invalid_request", `status ${status}`);
  }
});

test("502 del gateway es provider_error, como un proveedor caido", async () => {
  const { impl } = fakeFetch(jsonResponse(502, { error: "error" }));
  const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
  const e = await t.complete(REQ).then(() => null, (err) => err);
  assert.ok(e instanceof LlmError);
  assert.equal(e.code, "provider_error");
});

test("fallo de red no escapa como excepcion cruda", async () => {
  const { impl } = fakeFetch(new Error("ECONNREFUSED"));
  const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
  const e = await t.complete(REQ).then(() => null, (err) => err);
  assert.ok(e instanceof LlmError);
  assert.equal(e.code, "provider_error");
  assert.match(e.message, /ECONNREFUSED/);
});

test("una respuesta ilegible tambien es un error controlado", async () => {
  const { impl } = fakeFetch({ ok: true, status: 200, async json() { throw new SyntaxError("bad json"); } });
  const t = new GatewayTransport({ ...OPTS, fetchImpl: impl });
  const e = await t.complete(REQ).then(() => null, (err) => err);
  assert.ok(e instanceof LlmError);
  assert.equal(e.code, "provider_error");
});
