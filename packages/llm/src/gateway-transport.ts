import type { CompleteRequest, CompleteResult, ToolCall, FinishReason } from "./index.js";
import { LlmError, type Transport } from "./index.js";

// Transporte hacia `llm-gateway` (spec 8.3, punto A de este encargo).
//
// Este paquete NUNCA tiene una clave de proveedor: solo un token corto (`jti`
// de `agent_tokens`) que el propio gateway valida en cada llamada. Por eso el
// constructor recibe `token`, no `apiKey`, y nunca lee `process.env`.
//
// Mapeo de errores igual que `HttpTransport` en `apps/llm-gateway/src/server.ts:23-48`
// (mismo patron, pero contra el gateway interno en vez del proveedor):
// 401/403/409 e invalido -> invalid_request, 429 -> rate_limit,
// 5xx (502 incluido) y fallo de red -> provider_error. Nunca se deja escapar
// una excepcion sin envolver: quien llama solo ve `LlmError`.

export interface GatewayTransportOptions {
  /** Origen de `llm-gateway`, con o sin barra final. */
  baseUrl: string;
  /** Id de la ejecucion: el gateway lo usa para cargar y descontar presupuesto. */
  runId: string;
  /** Token corto con scope `llm:complete`. */
  token: string;
  /** Inyectable para pruebas sin red; por defecto el `fetch` global. */
  fetchImpl?: typeof fetch;
}

interface GatewaySuccessBody {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  model: string;
}

export class GatewayTransport implements Transport {
  readonly provider = "gateway";
  private readonly baseUrl: string;
  private readonly runId: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GatewayTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.runId = opts.runId;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          runId: this.runId,
          model: req.model,
          messages: req.messages,
          maxOutputTokens: req.maxOutputTokens,
        }),
        ...(req.signal ? { signal: req.signal } : {}),
      });
    } catch (e) {
      // Red caida, DNS, abort por timeout: ninguno debe salir como excepcion
      // cruda. Se cuenta como fallo del proveedor, no de la peticion.
      throw new LlmError("provider_error", e instanceof Error ? e.message : "network error");
    }

    if (res.status === 429) throw new LlmError("rate_limit", "429");
    // 401 (token invalido/revocado), 403 (scope denegado) y 409 (ejecucion
    // cerrada) son todos "esta peticion no vale", no un fallo del proveedor.
    if (res.status === 401 || res.status === 403 || res.status === 409) {
      throw new LlmError("invalid_request", `${res.status}`);
    }
    if (res.status >= 400 && res.status < 500) throw new LlmError("invalid_request", `${res.status}`);
    if (!res.ok) throw new LlmError("provider_error", `${res.status}`); // incluye 502

    let data: GatewaySuccessBody;
    try {
      data = (await res.json()) as GatewaySuccessBody;
    } catch {
      throw new LlmError("provider_error", "respuesta del gateway ilegible");
    }

    return {
      text: data.text,
      toolCalls: data.toolCalls,
      finishReason: data.finishReason,
      usage: data.usage,
      model: data.model,
      latencyMs: Date.now() - started,
    };
  }
}
