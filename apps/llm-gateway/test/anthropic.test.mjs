import { test } from "node:test";
import assert from "node:assert/strict";

// Camino de Anthropic (`/messages`) del transporte del proveedor.
//
// POR QUÉ EXISTE ESTE FICHERO: el proveedor sirve los Claude SOLO por
// `/messages`. Pidiéndolos en `/chat/completions` responde 400
// `protocol_mismatch`, así que la página del dueño no se generaba. El mismo
// modelo y la misma clave funcionaban por `/messages`; el dialecto lo dicta el
// proveedor, no nuestro cliente.
//
// Sin red: `fetch` es un doble y se mira exactamente lo que sale del proceso.

process.env["LLM_PROVIDER_BASE_URL"] = "https://proveedor.test/v1/";
process.env["LLM_PROVIDER_API_KEY"] = "clave-de-prueba";
const { HttpTransport, isAnthropicModel } = await import("../dist/server.js");
const { LlmError } = await import("@webdesign/llm");

const CLAUDE_REQ = {
  model: "design", // alias del catálogo -> claude-sonnet-5
  messages: [
    { role: "system", content: "Eres el agente de diseño." },
    { role: "user", content: "hola" },
    { role: "assistant", content: "¿en qué te ayudo?" },
    { role: "user", content: "hazme una web" },
  ],
  maxOutputTokens: 64,
  temperature: 0.4,
};

/** Respuesta real de `/messages`, resumida a lo que el transporte lee. */
const REPLY = {
  role: "assistant",
  content: [
    { type: "text", text: "Hola. " },
    { type: "text", text: "¿En qué te ayudo?" },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 16, output_tokens: 18 },
};

/** Doble de `fetch`: guarda la llamada y contesta lo que se le diga. */
function fakeFetch({ status = 200, body = REPLY, text = "" } = {}) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
      async text() {
        return text;
      },
    };
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

test("un modelo Claude se pide a /messages con x-api-key y anthropic-version", async () => {
  const f = fakeFetch();
  try {
    await new HttpTransport().complete(CLAUDE_REQ);
    assert.equal(f.calls[0].url, "https://proveedor.test/v1/messages");
    assert.equal(f.calls[0].init.method, "POST");
    assert.equal(f.calls[0].init.headers["x-api-key"], "clave-de-prueba");
    assert.equal(f.calls[0].init.headers["anthropic-version"], "2023-06-01");
    // En esta ruta NO se manda Bearer: dos formas de autenticar a la vez acaban
    // en un 401 sin explicación.
    assert.equal(f.calls[0].init.headers.authorization, undefined);
    // La clave no viaja en el cuerpo ni en la URL.
    assert.ok(!f.calls[0].init.body.includes("clave-de-prueba"));
    assert.ok(!f.calls[0].url.includes("clave-de-prueba"));
  } finally {
    f.restore();
  }
});

test("el system va aparte y messages solo lleva user/assistant", async () => {
  const f = fakeFetch();
  try {
    await new HttpTransport().complete(CLAUDE_REQ);
    const sent = JSON.parse(f.calls[0].init.body);
    // Si el system viaja como mensaje, el proveedor rechaza la petición.
    assert.equal(sent.system, "Eres el agente de diseño.");
    assert.deepEqual(sent.messages, [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿en qué te ayudo?" },
      { role: "user", content: "hazme una web" },
    ]);
    assert.equal(sent.messages.some((m) => m.role === "system"), false);
    assert.equal(sent.model, "claude-sonnet-5");
    assert.equal(sent.max_tokens, 64);
    assert.equal(sent.temperature, 0.4);
  } finally {
    f.restore();
  }
});

test("la respuesta de /messages se traduce a texto, fin y tokens", async () => {
  const f = fakeFetch();
  try {
    const r = await new HttpTransport().complete(CLAUDE_REQ);
    // Los bloques de texto se CONCATENAN: el proveedor puede partir la frase.
    assert.equal(r.text, "Hola. ¿En qué te ayudo?");
    assert.equal(r.finishReason, "stop"); // end_turn
    assert.equal(r.usage.tokensIn, 16);
    assert.equal(r.usage.tokensOut, 18);
    assert.deepEqual(r.toolCalls, []);
    assert.equal(r.model, "design", "el resultado sigue hablando en alias");
  } finally {
    f.restore();
  }
});

test("max_tokens del proveedor se mapea a length y refusal a refused", async () => {
  for (const [stop, esperado] of [["max_tokens", "length"], ["refusal", "refused"], ["stop_sequence", "stop"]]) {
    const f = fakeFetch({ body: { ...REPLY, stop_reason: stop } });
    try {
      const r = await new HttpTransport().complete(CLAUDE_REQ);
      assert.equal(r.finishReason, esperado, `stop_reason ${stop}`);
    } finally {
      f.restore();
    }
  }
});

test("un modelo que no es Claude sigue yendo por /chat/completions", async () => {
  const f = fakeFetch({ body: { choices: [{ message: { content: "hecho" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } } });
  try {
    const r = await new HttpTransport().complete({ ...CLAUDE_REQ, model: "fast-large" });
    assert.equal(f.calls[0].url, "https://proveedor.test/v1/chat/completions");
    assert.equal(f.calls[0].init.headers.authorization, "Bearer clave-de-prueba");
    assert.equal(f.calls[0].init.headers["x-api-key"], undefined);
    assert.equal(r.text, "hecho");
    assert.equal(r.usage.tokensIn, 7);
  } finally {
    f.restore();
  }
});

test("las herramientas se traducen a name/description/input_schema y tool_use a toolCalls", async () => {
  const tools = [
    { name: "get_site", description: "Devuelve el sitio", parameters: { type: "object", properties: { id: { type: "string" } } } },
  ];
  const body = {
    ...REPLY,
    content: [
      { type: "text", text: "Voy a mirar." },
      { type: "tool_use", id: "toolu_1", name: "get_site", input: { id: "p_home" } },
    ],
    stop_reason: "tool_use",
  };
  const f = fakeFetch({ body });
  try {
    const r = await new HttpTransport().complete({ ...CLAUDE_REQ, tools });
    const sent = JSON.parse(f.calls[0].init.body);
    // El dialecto de Anthropic no usa el envoltorio `{type:"function"}`.
    assert.deepEqual(sent.tools, [
      { name: "get_site", description: "Devuelve el sitio", input_schema: tools[0].parameters },
    ]);
    assert.deepEqual(r.toolCalls, [{ id: "toolu_1", name: "get_site", args: { id: "p_home" } }]);
    assert.equal(r.finishReason, "tool_calls");
    assert.equal(r.text, "Voy a mirar.");
  } finally {
    f.restore();
  }
});

test("un 400 del proveedor dice POR QUÉ y queda en el registro", async () => {
  // El mensaje del proveedor es lo que faltaba: un 400 pelado no explica nada.
  const proveedor = '{"error":"protocol_mismatch","message":"No compatible provider available for this request format"}';
  const f = fakeFetch({ status: 400, text: proveedor });
  const antes = console.warn;
  const avisos = [];
  console.warn = (...args) => avisos.push(args);
  try {
    const e = await new HttpTransport().complete(CLAUDE_REQ).then(() => null, (err) => err);
    assert.ok(e instanceof LlmError);
    assert.equal(e.code, "invalid_request");
    assert.match(e.message, /^400: /);
    assert.match(e.message, /protocol_mismatch/);
    assert.match(e.message, /No compatible provider/);
    assert.equal(avisos.length, 1, "el cuerpo del proveedor queda en el registro");
    assert.equal(avisos[0][0], "provider_error_body");
    assert.equal(avisos[0][1].status, 400);
  } finally {
    console.warn = antes;
    f.restore();
  }
});

test("el error del proveedor se sanea: ni la clave ni URLs", async () => {
  const f = fakeFetch({
    status: 401,
    text: 'invalid key clave-de-prueba for https://api.test/v1/messages?key=clave-de-prueba\nlinea dos',
  });
  try {
    const e = await new HttpTransport().complete(CLAUDE_REQ).then(() => null, (err) => err);
    assert.equal(e.code, "invalid_request");
    assert.equal(e.message.includes("clave-de-prueba"), false, "la clave no puede salir en el mensaje");
    assert.equal(e.message.includes("https://"), false, "la URL con credenciales tampoco");
    assert.match(e.message, /\[clave\]/);
    assert.match(e.message, /\[url\]/);
    assert.equal(e.message.includes("\n"), false, "una sola línea");
  } finally {
    f.restore();
  }
});

test("429 es rate_limit y 5xx es provider_error", async () => {
  for (const [status, code] of [[429, "rate_limit"], [500, "provider_error"], [502, "provider_error"], [403, "invalid_request"]]) {
    const f = fakeFetch({ status, text: "boom" });
    const antes = console.warn;
    console.warn = () => {};
    try {
      const e = await new HttpTransport().complete(CLAUDE_REQ).then(() => null, (err) => err);
      assert.equal(e.code, code, `status ${status}`);
    } finally {
      console.warn = antes;
      f.restore();
    }
  }
});

test("isAnthropicModel reconoce la familia y no confunde al resto", async () => {
  assert.equal(isAnthropicModel("claude-sonnet-5"), true);
  assert.equal(isAnthropicModel("claude-opus-x"), true);
  assert.equal(isAnthropicModel("gpt-4o"), false);
  assert.equal(isAnthropicModel("gpt-6.1-sol"), false);
});

test("el detalle del error no filtra la clave partida ni URL-encoded", async () => {
  // La clave puede volver partida por un salto de línea o codificada en la URL:
  // el log es el último sitio donde puede aparecer. Tres formas, tres casos.
  const CLAVE = "sk-ant/partida+clave=";
  const previa = process.env["LLM_PROVIDER_API_KEY"];
  process.env["LLM_PROVIDER_API_KEY"] = CLAVE;
  const antes = console.warn;
  let registrado = "";
  console.warn = (_evento, datos) => { registrado = String(datos.detail); };
  try {
    const cuerpos = [
      // 1. Partida por un salto de línea y por espacios.
      `token invalido sk-ant/\npartida+clave= fin`,
      // 2. URL-encoded (la forma en que viaja en una URL con credenciales).
      `token invalido ${encodeURIComponent(CLAVE)} fin`,
      // 3. Tal cual.
      `token invalido ${CLAVE} fin`,
    ];
    for (const cuerpo of cuerpos) {
      registrado = "";
      const f = fakeFetch({ status: 400, text: cuerpo });
      try {
        await new HttpTransport().complete(CLAUDE_REQ);
        assert.fail("debería haber lanzado");
      } catch (error) {
        assert.equal(error.code, "invalid_request");
      } finally {
        f.restore();
      }
      assert.ok(registrado.length > 0, "el detalle se registra");
      assert.equal(registrado.includes("sk-ant"), false, `fuga en: ${registrado}`);
      assert.equal(registrado.includes("partida+clave"), false);
      assert.equal(registrado.includes(encodeURIComponent(CLAVE)), false);
      assert.equal(registrado.includes("\n"), false, "una sola línea");
      assert.ok(registrado.length <= 200, "recortado a 200");
    }
  } finally {
    console.warn = antes;
    if (previa === undefined) delete process.env["LLM_PROVIDER_API_KEY"];
    else process.env["LLM_PROVIDER_API_KEY"] = previa;
  }
});

test("la clave con espacios alrededor o tabuladores dentro también se redacta", async () => {
  // La clave del contenedor suele llevar el salto de línea o el espacio de
  // haberla pegado, pero `Headers` los recorta al enviar: el eco del proveedor
  // viene SIN ellos. Si el patrón exige el carácter literal, la redacción falla
  // en silencio y la clave acaba entera en el log.
  const previa = process.env["LLM_PROVIDER_API_KEY"];
  const antes = console.warn;
  let registrado = "";
  console.warn = (_evento, datos) => { registrado = String(datos.detail); };
  try {
    const casos = [
      // [clave configurada, lo que devuelve el proveedor (ya recortado por Headers)]
      ["sk-abc123\n", "invalid_api_key: sk-abc123"],
      ["sk-abc123 ", "invalid_api_key: sk-abc123"],
      ["sk-\tabc123", "invalid_api_key: sk- abc123"],
    ];
    for (const [clave, eco] of casos) {
      process.env["LLM_PROVIDER_API_KEY"] = clave;
      registrado = "";
      const f = fakeFetch({ status: 400, text: eco });
      try {
        await new HttpTransport().complete(CLAUDE_REQ);
        assert.fail("debería haber lanzado");
      } catch (error) {
        assert.equal(error.code, "invalid_request");
      } finally {
        f.restore();
      }
      assert.equal(registrado.includes("sk-abc123"), false, `fuga con la clave ${JSON.stringify(clave)}: ${registrado}`);
      assert.equal(registrado.includes("sk- abc123"), false, `fuga partida: ${registrado}`);
      assert.match(registrado, /\[clave\]/, `no se redactó: ${registrado}`);
    }
  } finally {
    console.warn = antes;
    if (previa === undefined) delete process.env["LLM_PROVIDER_API_KEY"];
    else process.env["LLM_PROVIDER_API_KEY"] = previa;
  }
});
