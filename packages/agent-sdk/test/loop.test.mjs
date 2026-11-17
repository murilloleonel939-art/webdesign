import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { runAgent, ToolRegistry, callTool } from "../dist/index.js";
import { BudgetTracker, LlmClient } from "@webdesign/llm";

// Spec 8.2 y 9.1: el bucle para, no publica, y un modelo que inventa
// herramientas no rompe la ejecucion. Sin red: transporte falso.

const BUDGET = { maxTokens: 100000, maxToolCalls: 5, maxCostUsd: 1, timeoutMs: 60000, maxContextTokens: 24000 };
const ctx = { runId: "r", userId: "u", token: "t", locale: "es", apiBaseUrl: "http://x" };
const agent = { id: "design", description: "d", model: "fast-small", systemPrompt: "eres un agente", skills: [], tools: [], budget: BUDGET };

const addSection = {
  name: "add_section", description: "d",
  inputSchema: z.object({ type: z.string() }),
  scopes: ["site:write"], mutates: true,
  handler: async (_c, i) => ({ added: i.type }),
};

function scripted(replies) {
  let n = 0;
  return {
    provider: "fake",
    calls: 0,
    async complete() {
      const r = replies[n++] ?? { text: "fin", toolCalls: [], finishReason: "stop" };
      this.calls += 1;
      return { ...r, usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 }, model: "x", latencyMs: 1 };
    },
  };
}

function run(transport, opts = {}, tools = [addSection]) {
  const tracker = new BudgetTracker(BUDGET);
  return runAgent({
    agent, client: new LlmClient(transport, tracker), tracker, tools, ctx,
    messages: [{ role: "user", content: "haz un sitio" }],
    opts: { maxRounds: 3, ...opts },
  });
}

test("modo rapido: una sola ronda aunque el modelo quisiera seguir", async () => {
  const t = scripted([{ text: "borrador", toolCalls: [], finishReason: "stop" }]);
  const r = await run(t, { maxRounds: 1 });
  assert.equal(r.rounds, 1);
  assert.equal(t.calls, 1);
  assert.equal(r.finalText, "borrador");
  assert.equal(r.ok, true);
});

test("una herramienta se ejecuta y su resultado vuelve al modelo", async () => {
  const t = scripted([
    { text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name: "add_section", args: { type: "hero" } }] },
    { text: "hecho", toolCalls: [], finishReason: "stop" },
  ]);
  const r = await run(t);
  assert.equal(r.ok, true);
  assert.equal(r.finalText, "hecho");
  assert.equal(r.usage.calls, 1);
});

test("el checkpoint se toma ANTES de mutar", async () => {
  const order = [];
  const t = scripted([
    { text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name: "add_section", args: { type: "hero" } }] },
    { text: "fin", toolCalls: [], finishReason: "stop" },
  ]);
  await run(t, { beforeMutation: async () => { order.push("checkpoint"); } });
  const withSpy = { ...addSection, handler: async () => { order.push("mutation"); return {}; } };
  const t2 = scripted([
    { text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name: "add_section", args: { type: "hero" } }] },
    { text: "fin", toolCalls: [], finishReason: "stop" },
  ]);
  await run(t2, { beforeMutation: async () => { order.push("checkpoint"); } }, [withSpy]);
  assert.deepEqual(order, ["checkpoint", "checkpoint", "mutation"]);
});

test("una herramienta inventada no rompe: se le devuelve el error al modelo", async () => {
  const t = scripted([
    { text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name: "publish_site", args: {} }] },
    { text: "no puedo publicar", toolCalls: [], finishReason: "stop" },
  ]);
  const r = await run(t);
  assert.equal(r.ok, true);
  assert.equal(r.usage.calls, 0, "una herramienta inexistente no cuenta como llamada");
});

test("no existe herramienta de publicar: el agente no puede publicar", () => {
  const reg = new ToolRegistry([addSection]);
  assert.equal(reg.get("publish_site"), undefined);
  assert.equal(reg.get("publish"), undefined);
});

test("el tope de llamadas corta el bucle que no termina", async () => {
  const loop = { text: "", finishReason: "tool_calls", toolCalls: [{ id: "1", name: "add_section", args: { type: "hero" } }] };
  const t = scripted(Array(20).fill(loop));
  // Rondas de sobra: lo que debe cortar es el tope de llamadas, no las rondas.
  const r = await run(t, { maxRounds: 20 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.stop, { kind: "budget", limit: "tool_calls" });
  assert.equal(r.usage.calls, 5);
});

test("cancelar en mitad del bucle se respeta", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const t = scripted([{ text: "no deberia", toolCalls: [], finishReason: "stop" }]);
  const r = await run(t, { signal: ctrl.signal });
  assert.equal(t.calls, 0, "cancelado antes de empezar: no se llama al modelo");
  assert.equal(r.finalText, "");
});

test("un input invalido cuenta la llamada pero no ejecuta el handler", async () => {
  let executed = false;
  const spy = { ...addSection, handler: async () => { executed = true; return {}; } };
  const r = await callTool(spy, ctx, { wrong: true });
  assert.equal(r.ok, false);
  assert.equal(executed, false);
});
