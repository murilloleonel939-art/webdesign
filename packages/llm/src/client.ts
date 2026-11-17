import {
  LlmError, BudgetTracker, costOf, resolveModel,
  type CompleteRequest, type CompleteResult, type Transport, type StopReason,
} from "./index.js";

// Cliente de modelos (spec 8.3): envuelve un `Transport` y aplica lo que NO es
// responsabilidad del proveedor — presupuesto, reintentos, tiempo de espera y
// cortocircuito. Todo lo de aqui es determinista y se puede probar sin red.

export interface ClientOptions {
  /** Reintentos ante fallo transitorio. Un 4xx no se reintenta. */
  maxRetries?: number;
  /** Espera base del backoff exponencial. */
  backoffMs?: number;
  /** Fallos consecutivos antes de abrir el circuito. */
  breakerThreshold?: number;
  /** Tiempo que el circuito queda abierto antes de dejar pasar una prueba. */
  breakerCooldownMs?: number;
  /** Reloj inyectable: las pruebas no duermen de verdad. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Cortacircuitos simple por proveedor.
 *
 * Sin el, un proveedor caido recibe una peticion por cada herramienta del
 * agente y el coste en latencia se multiplica por el numero de pasos. Abierto,
 * falla rapido y la ejecucion termina con un motivo explicable.
 */
export class Breaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): "closed" | "open" | "half_open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }

  /** Deja pasar o no. `half_open` deja pasar una sola prueba. */
  allow(): boolean {
    return this.state !== "open";
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  /** Un `half_open` que vuelve a fallar reabre el circuito de inmediato. */
  onProbeFailure(): void {
    this.failures = this.threshold;
    this.openedAt = this.now();
  }
}

export type ClientResult =
  | { ok: true; result: CompleteResult }
  | { ok: false; stop: StopReason; error?: LlmError };

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente con presupuesto.
 *
 * El presupuesto se comprueba ANTES de llamar: gastar y luego descubrir que no
 * habia saldo dejaria `usage_events` con consumo de algo que no se debio pedir.
 */
export class LlmClient {
  private readonly breaker: Breaker;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly transport: Transport,
    private readonly tracker: BudgetTracker,
    opts: ClientOptions = {},
  ) {
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 250;
    this.sleep = opts.sleep ?? sleepReal;
    this.breaker = new Breaker(opts.breakerThreshold ?? 3, opts.breakerCooldownMs ?? 30_000, opts.now ?? Date.now);
  }

  get breakerState(): "closed" | "open" | "half_open" {
    return this.breaker.state;
  }

  /**
   * Una llamada al modelo con presupuesto, reintentos y cortacircuitos.
   *
   * Devuelve siempre un objeto: un fallo del proveedor es un resultado
   * controlado (`ok: false`) y nunca deja la ejecucion en un estado del que no
   * se pueda salir.
   */
  async complete(req: CompleteRequest): Promise<ClientResult> {
    const model = resolveModel(req.model);

    // Presupuesto: se estima la entrada y el tope de salida que se va a pedir.
    const estimated = estimateTokens(req.messages) + req.maxOutputTokens;
    const stop = this.tracker.check(estimated);
    if (stop) return { ok: false, stop };

    if (!this.breaker.allow()) {
      return { ok: false, stop: { kind: "budget", limit: "time" }, error: new LlmError("provider_error", `circuit open for ${this.transport.provider}`) };
    }

    let lastError: LlmError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.transport.complete(req);
        this.breaker.onSuccess();
        // El coste se calcula aqui, no se acepta el que diga el proveedor.
        const costUsd = costOf(req.model, result.usage.tokensIn, result.usage.tokensOut);
        this.tracker.record({ tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, costUsd });
        return { ok: true, result: { ...result, model: model.id, usage: { ...result.usage, costUsd } } };
      } catch (e) {
        lastError = e instanceof LlmError ? e : new LlmError("provider_error", String(e));
        // Un fallo del proveedor caido no se reintenta igual que un rate limit.
        if (lastError.code === "invalid_request" || lastError.code === "refused") {
          this.breaker.onSuccess();
          return { ok: false, stop: { kind: "done" }, error: lastError };
        }
        if (attempt === this.maxRetries) break;
        await this.sleep(this.backoffMs * 2 ** attempt);
      }
    }

    if (this.breaker.state === "half_open") this.breaker.onProbeFailure();
    else this.breaker.onFailure();
    // `exactOptionalPropertyTypes`: la clave se omite, no se pasa indefinida.
    return lastError
      ? { ok: false, stop: { kind: "done" }, error: lastError }
      : { ok: false, stop: { kind: "done" } };
  }
}

/**
 * Estimacion de tokens por caracteres.
 *
 * Deliberadamente tosca y algo pesimista: sirve para no pasarse, no para
 * facturar. El consumo real lo devuelve el proveedor y es el que se registra.
 */
export function estimateTokens(messages: { content: string }[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 3.2);
}
