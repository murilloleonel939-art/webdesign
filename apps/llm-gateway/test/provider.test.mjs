import { test } from "node:test";
import assert from "node:assert/strict";

// Transporte del proveedor compatible OpenAI (`HttpTransport`). Sin red: `fetch`
// se sustituye por un doble y se mira exactamente lo que sale del proceso.
//
// Lo que se comprueba aqui es lo que no puede fallar en produccion: la URL del
// endpoint, la cabecera `Bearer` con la clave del entorno, que al proveedor le
// llega el id real del modelo (nunca el alias del catalogo) y que sin clave hay
// un `LlmError` controlado en vez de una peticion sin autenticar.

process.env["LLM_PROVIDER_BASE_URL"] = "https://proveedor.test/v1/";
process.env["LLM_PROVIDER_API_KEY"] = "clave-de-prueba";
const { HttpTransport } = await import("../dist/server.js");
const { LlmError } = await import("@webdesign/llm");

const REQ = { model: "design", messages: [{ role: "user", content: "hola" }], maxOutputTokens: 64 };

/** Doble de `fetch`: guarda la llamada y contesta lo mínimo que el transporte lee. */
function fakeFetch(status = 200, body = {
  choices: [{ message: { content: "hecho" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 7, completion_tokens: 3 },
}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

test("la URL es ${base}/chat/completions, sin barra doble", async () => {
  const f = fakeFetch();
  try {
    await new HttpTransport().complete(REQ);
    // La barra final de LLM_PROVIDER_BASE_URL no se duplica.
    assert.equal(f.calls[0].url, "https://proveedor.test/v1/chat/completions");
    assert.equal(f.calls[0].init.method, "POST");
  } finally { f.restore(); }
});

test("la clave viaja como Authorization: Bearer de LLM_PROVIDER_API_KEY", async () => {
  const f = fakeFetch();
  try {
    await new HttpTransport("https://otro.test/v1").complete(REQ);
    assert.equal(f.calls[0].url, "https://otro.test/v1/chat/completions");
    assert.equal(f.calls[0].init.headers.authorization, "Bearer clave-de-prueba");
    // La clave no se cuela en el cuerpo ni en la URL.
    assert.ok(!f.calls[0].init.body.includes("clave-de-prueba"));
    assert.ok(!f.calls[0].url.includes("clave-de-prueba"));
  } finally { f.restore(); }
});

test("al proveedor le llega el id real del modelo, no el alias", async () => {
  const f = fakeFetch();
  try {
    const r = await new HttpTransport().complete(REQ);
    const sent = JSON.parse(f.calls[0].init.body);
    assert.equal(sent.model, "claude-sonnet-5");
    assert.notEqual(sent.model, "design");
    assert.equal(sent.max_tokens, 64);
    assert.equal(r.text, "hecho");
    assert.equal(r.usage.tokensIn, 7);
  } finally { f.restore(); }
});

test("sin clave es un provider_error controlado y no se llama al proveedor", async () => {
  const key = process.env["LLM_PROVIDER_API_KEY"];
  delete process.env["LLM_PROVIDER_API_KEY"];
  const f = fakeFetch();
  try {
    const e = await new HttpTransport().complete(REQ).then(() => null, (err) => err);
    assert.ok(e instanceof LlmError);
    assert.equal(e.code, "provider_error");
    assert.equal(e.message, "missing provider key");
    assert.equal(f.calls.length, 0, "sin clave no se hace la peticion");
  } finally {
    process.env["LLM_PROVIDER_API_KEY"] = key;
    f.restore();
  }
});

test("un alias desconocido no se envia al proveedor", async () => {
  const f = fakeFetch();
  try {
    const e = await new HttpTransport().complete({ ...REQ, model: "inventado" }).then(() => null, (err) => err);
    assert.ok(e instanceof LlmError);
    assert.equal(e.code, "invalid_request");
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});
