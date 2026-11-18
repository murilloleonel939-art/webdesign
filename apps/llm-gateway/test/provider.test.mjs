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

// --- Modelo real del agente de diseno por entorno (`LLM_DESIGN_MODEL`) ---------
//
// El dueno cambia de modelo con una variable del contenedor sin tocar codigo: el
// alias `design` se queda igual para el resto del sistema y solo el gateway lo
// traduce al id real. Se prueban los dos caminos y el valor invalido, que nunca
// debe tumbar el proceso.

const { providerModelId, designPricing, gatewayCostOf } = await import("../dist/server.js");

const MODEL_VAR = "LLM_DESIGN_MODEL";

/** Pone la variable durante la prueba y la deja como estaba al salir. */
async function withEnv(vars, fn) {
  const before = {};
  for (const k of Object.keys(vars)) {
    before[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("LLM_DESIGN_MODEL manda el id real del proveedor en body.model", async () => {
  await withEnv({ [MODEL_VAR]: "claude-opus-x" }, async () => {
    const f = fakeFetch();
    try {
      await new HttpTransport().complete(REQ);
      assert.equal(JSON.parse(f.calls[0].init.body).model, "claude-opus-x");
    } finally { f.restore(); }
  });
});

test("sin LLM_DESIGN_MODEL se envia el id del catalogo", async () => {
  await withEnv({ [MODEL_VAR]: undefined }, async () => {
    const f = fakeFetch();
    try {
      await new HttpTransport().complete(REQ);
      assert.equal(JSON.parse(f.calls[0].init.body).model, "claude-sonnet-5");
    } finally { f.restore(); }
  });
});

test("un LLM_DESIGN_MODEL invalido cae al catalogo y no revienta", async () => {
  for (const bad of ["modelo con espacio", "malo\ninyectado", "a".repeat(101), "id;rm -rf /"]) {
    await withEnv({ [MODEL_VAR]: bad }, async () => {
      const f = fakeFetch();
      try {
        await new HttpTransport().complete(REQ);
        assert.equal(JSON.parse(f.calls[0].init.body).model, "claude-sonnet-5", `valor invalido: ${JSON.stringify(bad)}`);
        // La funcion pura lo dice para que el arranque avise una sola vez.
        assert.equal(providerModelId("design", { [MODEL_VAR]: bad }).source, "catalogo");
      } finally { f.restore(); }
    });
  }
});

test("providerModelId es pura: otros alias y espacios sobrantes", () => {
  // Un alias que no es `design` ignora la variable: solo el agente de diseno se cambia.
  assert.equal(providerModelId("fast-small", { [MODEL_VAR]: "claude-opus-x" }).id, "gpt-4o-mini");
  // Recorte de espacios: `"  x  "` es valido una vez recortado.
  assert.equal(providerModelId("design", { [MODEL_VAR]: "  claude-opus-x  " }).id, "claude-opus-x");
  assert.equal(providerModelId("design", { [MODEL_VAR]: "   " }).source, "catalogo");
  // Un alias desconocido sigue siendo error de configuracion.
  assert.throws(() => providerModelId("inventado", {}), /unknown model alias/);
});

test("los precios por variable cambian el coste del gateway", () => {
  const env = { LLM_DESIGN_USD_IN_PER_M: "10", LLM_DESIGN_USD_OUT_PER_M: "40" };
  // 1M de tokens de entrada a 10 USD/M y 1M de salida a 40 USD/M.
  assert.equal(gatewayCostOf("design", 1_000_000, 0, env), 10);
  assert.equal(gatewayCostOf("design", 0, 1_000_000, env), 40);
  // Sin variables manda el catalogo: 3 USD/M de entrada, 15 USD/M de salida.
  assert.equal(gatewayCostOf("design", 1_000_000, 0, {}), 3);
  assert.equal(gatewayCostOf("design", 0, 1_000_000, {}), 15);
  // No `design` no se toca.
  assert.equal(gatewayCostOf("fast-small", 1_000_000, 0, env), gatewayCostOf("fast-small", 1_000_000, 0, {}));
});

test("un precio invalido usa el del catalogo y se avisa", () => {
  for (const [i, o] of [["0", "40"], ["-1", "40"], ["abc", "40"], ["10", "mucho"], ["10", undefined], [undefined, "40"]]) {
    const env = i === undefined ? {} : { LLM_DESIGN_USD_IN_PER_M: i };
    if (o !== undefined) env.LLM_DESIGN_USD_OUT_PER_M = o;
    const p = designPricing(env);
    assert.equal(p.source, "catalogo", `in=${i} out=${o}`);
    assert.ok(p.problems.length > 0, `in=${i} out=${o} debe avisar`);
  }
  assert.equal(designPricing({ LLM_DESIGN_USD_IN_PER_M: "10", LLM_DESIGN_USD_OUT_PER_M: "40" }).problems.length, 0);
});
