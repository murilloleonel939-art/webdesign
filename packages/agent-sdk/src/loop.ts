import { LlmClient, BudgetTracker, type Message, type ToolCall } from "@webdesign/llm";
import { callTool, toToolSpec, type RunContext } from "./index.js";
import type { StopReason } from "@webdesign/llm";
import type { AgentDefinition, ToolDef } from "./index.js";

// Bucle del agente (spec 8.2, 9.1).
//
// El agente NUNCA publica (8.2). No hay herramienta de publicar en este bucle y
// no la habra: publicar es una accion del dueno desde el panel, con su propia
// confirmacion si 6.5 levanto un aviso. Si el modelo pidiera "publicar", no
// existe herramienta que lo haga y recibe un error de herramienta desconocida.
//
// Modo rapido (14.1): una sola ronda. `maxRounds` lo hace explicito y no depende
// de que el modelo decida parar.

export interface LoopOptions {
  /** Tope de rondas de razonamiento. El modo rapido usa 1. */
  maxRounds: number;
  /** Se invoca ANTES de cada herramienta que muta: es donde se toma el checkpoint. */
  beforeMutation?: (call: ToolCall) => Promise<void>;
  /** Se invoca despues de cada herramienta, mutante o no: alimenta la auditoria. */
  afterTool?: (call: ToolCall, result: { ok: boolean; errorCode?: string; ms: number }) => Promise<void>;
  /** Cancelacion externa (el dueno pulsa detener). */
  signal?: AbortSignal;
}

export type LoopResult = {
  ok: boolean;
  finalText: string;
  stop: StopReason;
  usage: { tokens: number; calls: number; costUsd: number };
  /** Rondas realmente ejecutadas: el panel lo ensena para explicar el coste. */
  rounds: number;
};

/**
 * Ejecuta el agente hasta que termina, se agota el presupuesto o se cancela.
 *
 * Devuelve siempre un resultado: un proveedor caido no deja la ejecucion a
 * medias sin explicacion, que es lo que la spec 9.1 exige para poder reintentar.
 */
export async function runAgent(args: {
  agent: AgentDefinition;
  client: LlmClient;
  tracker: BudgetTracker;
  tools: ToolDef<unknown, unknown>[];
  ctx: RunContext;
  messages: Message[];
  opts: LoopOptions;
}): Promise<LoopResult> {
  const { agent, client, tracker, tools, ctx, opts } = args;
  const messages: Message[] = [{ role: "system", content: agent.systemPrompt }, ...args.messages];
  const specs = tools.map((t) => toToolSpec(t));
  const byName = new Map(tools.map((t) => [t.name, t]));

  let rounds = 0;
  let finalText = "";

  while (rounds < opts.maxRounds) {
    if (opts.signal?.aborted) return finish({ kind: "done" }, finalText, rounds);
    rounds += 1;

    const out = await client.complete({
      model: agent.model,
      messages,
      ...(specs.length ? { tools: specs } : {}),
      maxOutputTokens: 2048,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    if (!out.ok) {
      // Un presupuesto agotado se distingue de un fallo del proveedor: el dueno
      // necesita saber si le queda saldo o si el servicio fallo.
      return finish(out.stop, finalText, rounds);
    }

    const { text, toolCalls, finishReason } = out.result;
    if (text) finalText = text;
    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      return finish({ kind: "done" }, finalText, rounds);
    }

    messages.push({ role: "assistant", content: text, toolCalls });

    for (const call of toolCalls) {
      const stop = tracker.checkToolCall();
      if (stop) return finish(stop, finalText, rounds);

      const def = byName.get(call.name);
      if (!def) {
        // El modelo invento una herramienta. No es un fallo del sistema y no
        // se registra como tal: se le devuelve el error y sigue.
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: "UNKNOWN_TOOL", name: call.name }) });
        continue;
      }

      const started = Date.now();
      if (def.mutates && opts.beforeMutation) await opts.beforeMutation(call);
      tracker.countToolCall();

      const result = await callTool(def, ctx, call.args);
      const ms = Date.now() - started;

      if (opts.afterTool) {
        await opts.afterTool(call, result.ok ? { ok: true, ms } : { ok: false, errorCode: result.errorCode, ms });
      }

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.errorCode, message: result.message }),
      });
    }
  }

  // Se agotaron las rondas del modo rapido: hay borrador, pero no es definitivo.
  return finish({ kind: "done" }, finalText, rounds);

  function finish(stop: StopReason, text: string, r: number): LoopResult {
    return { ok: stop.kind === "done", finalText: text, stop, usage: tracker.snapshot, rounds: r };
  }
}
