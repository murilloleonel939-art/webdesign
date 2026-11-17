import { z } from "zod";

// Capa de modelos (spec 8.3): varios proveedores detras de una sola interfaz.
//
// Lo que NO vive aqui: claves de proveedor. Solo `llm-gateway` las tiene, y este
// paquete es codigo compartido; por eso recibe un `Transport` ya autenticado en
// vez de leer el entorno. Asi, un error de importacion no puede filtrar una
// clave a `core`, a un sandbox o a un canal.

/** Mensaje del historial. `tool` solo lo emite el modelo; `tool_result`, nosotros. */
export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** Peticion de herramienta tal como la devuelve el modelo, sin interpretar. */
export interface ToolCall {
  id: string;
  name: string;
  /** Argumentos sin validar: Zod los comprueba antes de ejecutar nada. */
  args: unknown;
}

/** Descripcion de herramienta que se envia al modelo (formato neutro). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema derivado del Zod del `ToolDef`; nunca escrito a mano. */
  parameters: Record<string, unknown>;
}

export interface CompleteRequest {
  model: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxOutputTokens: number;
  temperature?: number;
  /** Se aborta al vencer: una ejecucion no puede quedarse colgada. */
  signal?: AbortSignal;
}

/** Como termino la llamada. Es un resultado controlado, no una excepcion. */
export type FinishReason = "stop" | "tool_calls" | "length" | "refused" | "error";

export interface CompleteResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  model: string;
  latencyMs: number;
}

/**
 * Transporte real hacia un proveedor.
 *
 * Lo implementa `llm-gateway` con la clave en mano. Todo lo demas del sistema
 * usa `LlmClient`, que valida antes de llegar aqui: el transporte no comprueba
 * presupuesto ni scopes porque no es su responsabilidad.
 */
export interface Transport {
  readonly provider: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** Error de transporte con la forma que la spec pide: controlado y clasificable. */
export class LlmError extends Error {
  constructor(
    readonly code: "timeout" | "rate_limit" | "invalid_request" | "provider_error" | "refused",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Catalogo de modelos.
 *
 * La spec 8.3 exige elegir modelo por configuracion versionada y evaluacion
 * registrada, nunca por lo que diga el modelo. Por eso la lista es cerrada y
 * lleva el coste por token: sin coste no hay presupuesto explicable.
 */
export const MODELS = {
  "fast-small": { provider: "openai", id: "gpt-4o-mini", usdIn: 0.00000015, usdOut: 0.0000006, contextWindow: 128000 },
  "fast-large": { provider: "openai", id: "gpt-4o", usdIn: 0.0000025, usdOut: 0.00001, contextWindow: 128000 },
} as const satisfies Record<string, { provider: string; id: string; usdIn: number; usdOut: number; contextWindow: number }>;

export type ModelAlias = keyof typeof MODELS;

/** Resuelve un alias. Un id desconocido es un error de configuracion, no del modelo. */
export function resolveModel(alias: string): (typeof MODELS)[ModelAlias] {
  const m = MODELS[alias as ModelAlias];
  if (!m) throw new LlmError("invalid_request", `unknown model alias: ${alias}`);
  return m;
}

/** Coste real de una llamada, con los tokens que el proveedor devolvio. */
export function costOf(alias: string, tokensIn: number, tokensOut: number): number {
  const m = resolveModel(alias);
  return tokensIn * m.usdIn + tokensOut * m.usdOut;
}

/**
 * Presupuesto de una ejecucion.
 *
 * Los cinco limites de 8.2 en un solo objeto, porque se comprueban juntos: si se
 * separaran, una ejecucion podria pasarse de coste mientras respeta tokens.
 */
export const budgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxCostUsd: z.number().nonnegative(),
  timeoutMs: z.number().int().positive(),
  maxContextTokens: z.number().int().positive().default(24000),
});

export type Budget = z.infer<typeof budgetSchema>;

/** Por que se paro. Se guarda en `agent_runs.stop_reason` y se ensena al dueno. */
export type StopReason =
  | { kind: "done" }
  | { kind: "budget"; limit: "tokens" | "tool_calls" | "cost" | "time" | "context" };

/**
 * Estado mutable de una ejecucion. Vive en memoria del proceso que orquesta y se
 * persiste al final; no se comparte entre procesos porque el contador tiene que
 * ser exacto para que el presupuesto sea real.
 */
export class BudgetTracker {
  private tokens = 0;
  private calls = 0;
  private cost = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: Budget) {}

  /** Comprueba antes de gastar; devuelve el motivo si ya no se puede seguir. */
  check(estimatedTokens: number): StopReason | null {
    if (Date.now() - this.startedAt > this.budget.timeoutMs) return { kind: "budget", limit: "time" };
    if (this.tokens + estimatedTokens > this.budget.maxTokens) return { kind: "budget", limit: "tokens" };
    if (estimatedTokens > this.budget.maxContextTokens) return { kind: "budget", limit: "context" };
    if (this.cost >= this.budget.maxCostUsd) return { kind: "budget", limit: "cost" };
    return null;
  }

  /** Antes de ejecutar una herramienta: el tope de llamadas protege de un bucle. */
  checkToolCall(): StopReason | null {
    if (this.calls >= this.budget.maxToolCalls) return { kind: "budget", limit: "tool_calls" };
    return this.check(0);
  }

  record(usage: { tokensIn: number; tokensOut: number; costUsd: number }): void {
    this.tokens += usage.tokensIn + usage.tokensOut;
    this.cost += usage.costUsd;
  }

  countToolCall(): void {
    this.calls += 1;
  }

  get snapshot(): { tokens: number; calls: number; costUsd: number; elapsedMs: number } {
    return { tokens: this.tokens, calls: this.calls, costUsd: this.cost, elapsedMs: Date.now() - this.startedAt };
  }
}

export { LlmClient, Breaker, estimateTokens } from "./client.js";
export type { ClientOptions, ClientResult } from "./client.js";
