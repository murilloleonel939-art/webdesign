import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { z } from "zod";
import { BudgetTracker, LlmClient, LlmError, budgetSchema, costOf, resolveModel, type Transport } from "@webdesign/llm";

// Servicio `llm-gateway` (spec 8.3 y linea 131): el UNICO que tiene las claves de
// proveedor. Emite y valida tokens temporales con presupuesto.
//
// Lo que este servicio NO hace: decidir que modelo usar por lo que diga el
// modelo, publicar sitios, leer contenido de sitios ni tocar drafts. Si se ve
// comprometido, escribe consumo y poco mas (ver 0015_llm_gateway_role.sql).

const PORT = Number(process.env["PORT"] ?? 3001);
// Se exporta para que las pruebas puedan sustituir `query` por un doble: sin
// base de datos no hay forma de reproducir un `42501` de RLS, y ese fallo es el
// que tumbaba el proceso. En producción nadie más toca este objeto.
export const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });

/** Base del proveedor compatible OpenAI. Sin barra final: las rutas la anaden. */
const PROVIDER_BASE_URL = (process.env["LLM_PROVIDER_BASE_URL"] ?? "https://api.pateway.ai/v1").replace(/\/+$/, "");

// Modelo real del agente de diseño por entorno.
//
// El catalogo (`packages/llm`) se queda como esta: el alias `design` sigue
// siendo "design" para todo el sistema y solo este servicio decide a que id real
// se traduce. Asi el dueno cambia de modelo con una variable en el contenedor,
// sin tocar codigo ni desplegar, y el coste de la tabla sigue siendo explicable.
const DESIGN_ALIAS = "design";

/** Letras, digitos y los separadores que usan los id de modelo. Nada mas. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

export type Env = Record<string, string | undefined>;

/** De donde salio el valor efectivo: la variable de entorno o el catalogo. */
export type ConfigSource = "variable" | "catalogo";

/**
 * Id real que se manda al proveedor para un alias.
 *
 * Funcion pura: recibe el entorno en vez de leerlo, para poder probarla sin
 * proceso. Un valor invalido nunca revienta nada: se ignora, se devuelve el del
 * catalogo y `invalid` trae el texto crudo para que el arranque pueda avisar una vez.
 */
export function providerModelId(alias: string, env: Env): { id: string; source: ConfigSource; invalid?: string } {
  // Un alias desconocido sigue siendo error de configuracion (lanza LlmError).
  const catalogId = resolveModel(alias).id;
  if (alias !== DESIGN_ALIAS) return { id: catalogId, source: "catalogo" };

  const raw = (env["LLM_DESIGN_MODEL"] ?? "").trim();
  if (!raw) return { id: catalogId, source: "catalogo" };
  if (!MODEL_ID_PATTERN.test(raw)) return { id: catalogId, source: "catalogo", invalid: raw };
  return { id: raw, source: "variable" };
}

/** Precio por millon de tokens: numero finito y mayor que cero, o nada. */
function positivePrice(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const isSet = (raw: string | undefined) => (raw ?? "").trim() !== "";

/** Variables sin las que el servicio no puede atender una peticion real. */
const REQUIRED_ENV = ["LLM_PROVIDER_API_KEY", "DATABASE_URL"] as const;

/**
 * Precio del alias `design` para el calculo de coste de este servicio.
 *
 * Se pide por millon de tokens (la cifra que da el proveedor) y se devuelve por
 * token, que es la unidad de `costOf`. Si falta una de las dos variables o
 * alguna no es valida, manda el catalogo entero: mezclar una cifra del dueno con
 * una del catalogo daria un coste que no corresponde a ningun modelo.
 */
export function designPricing(env: Env): { usdIn: number; usdOut: number; source: ConfigSource; problems: string[] } {
  const catalog = resolveModel(DESIGN_ALIAS);
  const inRaw = env["LLM_DESIGN_USD_IN_PER_M"];
  const outRaw = env["LLM_DESIGN_USD_OUT_PER_M"];
  const usdIn = positivePrice(inRaw);
  const usdOut = positivePrice(outRaw);

  const problems: string[] = [];
  if (isSet(inRaw) && usdIn === null) problems.push("LLM_DESIGN_USD_IN_PER_M no es un numero > 0; el coste usa el del catalogo");
  if (isSet(outRaw) && usdOut === null) problems.push("LLM_DESIGN_USD_OUT_PER_M no es un numero > 0; el coste usa el del catalogo");
  // Media pareja de precios es un error de configuracion, no una intencion.
  if (!problems.length && isSet(inRaw) !== isSet(outRaw)) {
    problems.push("el precio del design necesita LLM_DESIGN_USD_IN_PER_M y LLM_DESIGN_USD_OUT_PER_M; el coste usa el del catalogo");
  }

  if (usdIn === null || usdOut === null || problems.length) {
    return { usdIn: catalog.usdIn, usdOut: catalog.usdOut, source: "catalogo", problems };
  }
  // Por millon -> por token: `costOf` multiplica por tokens, no por millones.
  return { usdIn: usdIn / 1_000_000, usdOut: usdOut / 1_000_000, source: "variable", problems };
}

/** Coste de una llamada como lo cuenta este servicio, con la variable aplicada. */
export function gatewayCostOf(alias: string, tokensIn: number, tokensOut: number, env: Env): number {
  if (alias !== DESIGN_ALIAS) return costOf(alias, tokensIn, tokensOut);
  const p = designPricing(env);
  return tokensIn * p.usdIn + tokensOut * p.usdOut;
}

/**
 * Avisos de configuracion del modelo de diseño, una vez al arrancar.
 *
 * Nunca se registra la clave del proveedor: aqui solo se leen las variables del
 * modelo y del precio, y de ellas se registra el nombre, no el valor.
 */
function logModelConfig(): void {
  const design = providerModelId(DESIGN_ALIAS, process.env);
  const pricing = designPricing(process.env);
  const warn = (msg: string) => process.stderr.write(`llm-gateway: aviso: ${msg}\n`);

  if (design.invalid !== undefined) warn("LLM_DESIGN_MODEL no es un id valido; el modelo design usa el del catalogo");
  for (const msg of pricing.problems) warn(msg);

  process.stdout.write(`llm-gateway: modelo design = ${design.id} (${design.source})\n`);
}

// Transporte del proveedor (compatible OpenAI, detras de un solo endpoint).
//
// Al proveedor se le manda SIEMPRE el id real del modelo (`providerModelId`, que
// por defecto es el del catalogo) y nunca el alias: el alias es vocabulario
// nuestro, y un proveedor
// que no lo conozca devolveria un 400 que se leeria como fallo del sistema. La
// traduccion vive aqui y no en `LlmClient` porque es dialecto del proveedor: el
// cliente sigue razonando en alias, que es lo que tiene coste en la tabla.
/**
 * ¿El id real es de la familia Claude?
 *
 * POR QUÉ IMPORTA: el proveedor sirve cada familia por su propio protocolo. Los
 * Claude NO se atienden en `/chat/completions` (devuelve 400
 * `protocol_mismatch`): se atienden en `/messages`, con cabeceras y cuerpo
 * propios. El resto del catálogo sigue por el camino compatible OpenAI. Quien
 * manda es el proveedor, no nuestro cliente: por eso la decisión vive aquí y el
 * resto del sistema sigue hablando alias y `CompleteRequest`.
 */
export function isAnthropicModel(id: string): boolean {
  return /claude/i.test(id);
}

/** Versión del protocolo de Anthropic. Sin ella, `/messages` responde 400. */
const ANTHROPIC_VERSION = "2023-06-01";

export class HttpTransport implements Transport {
  readonly provider = "pateway";

  constructor(private readonly baseUrl: string = PROVIDER_BASE_URL) {}

  async complete(req: Parameters<Transport["complete"]>[0]) {
    const started = Date.now();
    // La clave se lee aqui, en el ultimo momento y solo aqui: no se guarda en
    // un campo, no viaja como argumento y nunca se registra.
    const key = process.env["LLM_PROVIDER_API_KEY"];
    if (!key) throw new LlmError("provider_error", "missing provider key");

    // El id real puede venir de `LLM_DESIGN_MODEL`; lo decide `providerModelId`.
    const { id: modelId } = providerModelId(req.model, process.env);
    const anthropic = isAnthropicModel(modelId);

    // Ruta y cabeceras segun la familia. En `/messages` la clave va en
    // `x-api-key` y NO como `Authorization: Bearer`: mandar las dos cosas a la
    // vez es como se acaba con un 401 sin explicacion.
    const res = anthropic
      ? await fetch(`${this.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(anthropicBody(modelId, req)),
          ...(req.signal ? { signal: req.signal } : {}),
        })
      : await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            messages: req.messages.map(toProviderMessage),
            max_tokens: req.maxOutputTokens,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: t })) } : {}),
          }),
          ...(req.signal ? { signal: req.signal } : {}),
        });

    if (!res.ok) throw await providerError(res, key);

    const data = (await res.json()) as Record<string, unknown>;
    if (anthropic) {
      return {
        text: anthropicText(data),
        toolCalls: anthropicToolCalls(data),
        finishReason: mapAnthropicStop(text(data["stop_reason"])),
        usage: {
          tokensIn: number((data["usage"] as Record<string, unknown> | undefined)?.["input_tokens"]),
          tokensOut: number((data["usage"] as Record<string, unknown> | undefined)?.["output_tokens"]),
          costUsd: 0,
        },
        model: req.model,
        latencyMs: Date.now() - started,
      };
    }

    const openai = data as {
      choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = openai.choices?.[0];
    const rawCalls = choice?.message?.tool_calls ?? [];

    return {
      text: choice?.message?.content ?? "",
      toolCalls: rawCalls.map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })),
      finishReason: mapFinish(choice?.finish_reason),
      usage: {
        tokensIn: openai.usage?.prompt_tokens ?? 0,
        tokensOut: openai.usage?.completion_tokens ?? 0,
        costUsd: 0,
      },
      model: req.model,
      latencyMs: Date.now() - started,
    };
  }
}

// --- Protocolo de Anthropic (`/messages`) ------------------------------------

/**
 * Cuerpo con la forma que pide `/messages`.
 *
 * Dos diferencias con el formato OpenAI que nos costaban un 400:
 *   - el `system` NO es un mensaje: va aparte, en un campo de primer nivel. Si
 *     viaja como `{role:"system"}` dentro de `messages`, el proveedor lo rechaza;
 *   - `messages` solo admite `user` y `assistant`. Un `tool` se manda como
 *     `user`, igual que hace el camino compatible.
 *
 * Las herramientas van con `name`, `description` e `input_schema` (JSON Schema),
 * no con el envoltorio `{type:"function", function}`. Hoy el agente de diseño no
 * las usa (`LlmClient` no las reenvía y sus llamadas van sin `tools`), así que
 * este camino se traduce por contrato y se prueba con un `ToolSpec` sintético; si
 * algún día se usan de verdad, ya está listo.
 */
function anthropicBody(modelId: string, req: Parameters<Transport["complete"]>[0]) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")
    .trim();
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  return {
    model: modelId,
    max_tokens: req.maxOutputTokens,
    ...(system !== "" ? { system } : {}),
    messages,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.tools?.length
      ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
      : {}),
  };
}

interface AnthropicBlock {
  type?: unknown;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

function anthropicBlocks(data: Record<string, unknown>): AnthropicBlock[] {
  const blocks = data["content"];
  return Array.isArray(blocks) ? (blocks as AnthropicBlock[]) : [];
}

/** Texto de la respuesta: se CONCATENAN los bloques `type: "text"`. */
function anthropicText(data: Record<string, unknown>): string {
  return anthropicBlocks(data)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/** Llamadas a herramienta, desde los bloques `tool_use`. */
function anthropicToolCalls(data: Record<string, unknown>) {
  return anthropicBlocks(data)
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: String(b.id ?? ""), name: String(b.name ?? ""), args: b.input ?? null }));
}

/**
 * `stop_reason` del proveedor al vocabulario del sistema.
 *
 * `end_turn` → `stop`, `max_tokens` → `length`, `tool_use` → `tool_calls`,
 * `refusal` → `refused`. Lo desconocido (`stop_sequence`, campos nuevos) es un
 * final controlado, nunca una excepción.
 */
function mapAnthropicStop(r: string): ReturnType<typeof mapFinish> {
  if (r === "max_tokens") return "length";
  if (r === "tool_use") return "tool_calls";
  if (r === "refusal") return "refused";
  return "stop";
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function number(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Error del proveedor, con el POR QUÉ dentro.
 *
 * ANTES: un 400 del proveedor llegaba como `message=400` y no decía nada; se
 * perdieron horas buscando qué campo sobraba. Ahora el mensaje lleva el cuerpo
 * del proveedor, recortado y saneado: sin la clave y sin URLs (una URL puede
 * llevar credenciales), en una sola línea de 200 caracteres como mucho. El
 * mismo texto va al registro, junto al estado.
 */
async function providerError(res: { status: number; text?: () => Promise<string> }, key: string): Promise<LlmError> {
  const code = res.status === 429
    ? "rate_limit"
    : res.status >= 400 && res.status < 500
      ? "invalid_request"
      : "provider_error";
  const detail = await errorDetail(res, key);
  if (detail !== "") console.warn("provider_error_body", { status: res.status, detail });
  return new LlmError(code, detail === "" ? `${res.status}` : `${res.status}: ${detail}`);
}

/** Cuerpo del error, en una línea y sin secretos. Nunca lanza. */
async function errorDetail(res: { text?: () => Promise<string> }, key: string): Promise<string> {
  let raw = "";
  try {
    raw = typeof res.text === "function" ? await res.text() : "";
  } catch {
    // Un cuerpo que no se puede leer deja el estado como único dato.
    return "";
  }
  // El orden importa: se COLAPSA primero y se redacta después. Al revés, una
  // clave partida por un salto de línea («sk-ant-\nabc») no coincide con la
  // cadena entera y acaba en el log troceada. Además de la forma tal cual se
  // cubre la URL-encoded y la partida: una clave puede llegar de cualquiera de
  // las tres maneras, y el log es el último sitio donde puede aparecer.
  const colapsado = raw.replace(/\s+/g, " ").trim();
  const limpio = redactKey(colapsado, key);
  const sinUrls = limpio.replace(/https?:\/\/\S+/g, "[url]");
  return sinUrls.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Carácter literal para una expresión regular. */
function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sustituye la clave por `[clave]` en todas sus formas.
 *
 * POR QUÉ NO BASTA CON `split(key)`: el texto ya viene colapsado, así que una
 * clave partida por un salto de línea queda con un espacio en medio
 * (`sk-ant- abc`) y la cadena entera no aparece. Se busca carácter a carácter
 * permitiendo espacios entre ellos, y se hace también con la forma
 * URL-encoded, que es la otra manera de que el proveedor la repita.
 */
function redactKey(text: string, key: string): string {
  if (key === "") return text;
  let out = text;
  // La clave también se normaliza: la del contenedor puede traer el salto de
  // línea o el espacio de haberla pegado, y `Headers` los recorta al enviar, así
  // que el eco del proveedor viene SIN ellos y el patrón con ellos no casaría.
  const formas = [key, encodeURIComponent(key)]
    .map((f) => f.replace(/\s+/g, " ").trim())
    .filter((f) => f !== "");
  for (const forma of new Set(formas)) {
    const pattern = forma.split("").map(escapeRegex).join("\\s*");
    out = out.replace(new RegExp(pattern, "g"), "[clave]");
  }
  return out;
}

// El proveedor habla su dialecto; el resto del sistema no debe saber cual es.
function toProviderMessage(m: { role: string; content: string }) {
  return { role: m.role === "tool" ? "user" : m.role, content: m.content };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Un `finish_reason` desconocido es un error controlado, nunca una excepcion. */
function mapFinish(r: string | undefined) {
  if (r === "tool_calls" || r === "function_call") return "tool_calls" as const;
  if (r === "length") return "length" as const;
  if (r === "content_filter") return "refused" as const;
  return "stop" as const;
}

const completeSchema = z.object({
  runId: z.string().uuid(),
  model: z.string(),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string() })),
  maxOutputTokens: z.number().int().positive().max(8000),
});

/**
 * Autorizacion: el token se valida contra `agent_tokens`.
 *
 * Se comprueba que no este revocado, que no haya vencido y que los scopes
 * cubran lo que se pide. Todo en una consulta: si se hiciera en dos, una
 * revocacion concurrente podria colarse entre medias.
 */
async function authorize(runId: string, token: string, need: string): Promise<{ ok: true; scopes: string[] } | { ok: false; code: number; error: string }> {
  const r = await pool.query<{ scopes: string[]; site_id: string | null }>(
    `SELECT scopes, site_id FROM agent_tokens
      WHERE jti = $1::uuid AND run_id = $2::uuid AND revoked_at IS NULL AND expires_at > now()`,
    [token, runId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, code: 401, error: "invalid_token" };
  if (!row.scopes.includes(need) && !row.scopes.includes("*")) return { ok: false, code: 403, error: "scope_denied" };
  return { ok: true, scopes: row.scopes };
}

/** Presupuesto persistido de la ejecucion: es la fuente de verdad, no la memoria. */
async function loadBudget(runId: string) {
  const r = await pool.query<{ prompt_tokens_max: number; tokens_in: number; tokens_out: number; status: string }>(
    `SELECT prompt_tokens_max, tokens_in, tokens_out, status FROM agent_runs WHERE id = $1::uuid`,
    [runId],
  );
  return r.rows[0];
}

/**
 * Consumo observado. El `provider` es el real del transporte (`pateway`), no un
 * literal fijo: si algun dia cambia el proveedor, `usage_events` lo dira sin
 * tener que adivinar de donde vino el gasto.
 */
async function recordUsage(runId: string, provider: string, used: { tokens: number; costUsd: number }, outcome: string, model: string) {
  await pool.query(
    `INSERT INTO usage_events (id, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, run_id, outcome)
     VALUES ($1, $2, $3, 0, 0, $4, 0, $5::uuid, $6)`,
    [randomUUID(), provider, model, used.costUsd, runId, outcome],
  );
}

/**
 * Una linea en stderr cuando `LlmClient.complete` devuelve error, para poder
 * diagnosticar un 502 sin tener que reproducirlo.
 *
 * Nunca escribe la clave del proveedor, la URL con credenciales ni el cuerpo
 * de la peticion: solo el motivo ya clasificado (`reason`), el codigo y
 * mensaje de `LlmError` (que es texto fijo nuestro, nunca el secreto), el
 * `runId` y el `modelId`. El mensaje se recorta a 200 caracteres y se limpia
 * de saltos de linea por si alguna vez trajera algo inesperado.
 */
function logProviderFailure(reason: string, error: { code: string; message: string } | undefined, runId: string, modelId: string): void {
  const code = error?.code ?? "none";
  const message = error === undefined ? "none" : error.message.replace(/[\r\n]+/g, " ").slice(0, 200);
  process.stderr.write(`llm-gateway: fallo de proveedor reason=${reason} code=${code} message=${message} run=${runId} model=${modelId}\n`);
}

/**
 * Código de error de Postgres, si lo hay.
 *
 * Se registra el CÓDIGO (`42501`, `23505`...) y nunca el texto de la consulta ni
 * datos del dueño: el código dice qué pasó y no lleva nada sensible.
 */
function pgCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
}

/**
 * Red de último recurso.
 *
 * POR QUÉ: el contador de tokens se actualizaba dentro del camino de éxito y un
 * `42501` de RLS (política que no admitía `status = 'running'`) escapaba sin
 * capturar y TUMBABA el proceso del gateway. El worker veía la conexión cortada
 * y caía al respaldo. Una respuesta que ya se puede dar no se pierde porque la
 * contabilidad falle; y lo que falle de verdad se contesta con un 500 y el
 * proceso sigue atendiendo.
 */
export const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    process.stderr.write(`llm-gateway: error no capturado code=${pgCode(error)}\n`);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error" }));
  });
});

async function handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // El healthcheck no debe mentir: si falta una variable imprescindible, el
  // servicio no esta sano aunque el proceso responda. Reportarlo aqui hace que
  // el fallo se vea en el despliegue (Coolify marca el contenedor `unhealthy`,
  // ver `Dockerfile`), no en el primer cliente que llega y recibe un 502 sin
  // explicacion. No se llama al proveedor: eso gastaria dinero y colgaria el
  // chequeo con cada sondeo.
  if (req.url === "/healthz") {
    const missing = REQUIRED_ENV.filter((name) => !isSet(process.env[name]));
    if (missing.length) return send(503, { ok: false, missing });
    return send(200, { ok: true });
  }

  if (req.method !== "POST" || req.url !== "/v1/complete") return send(404, { error: "not_found" });

  const auth = req.headers.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return send(401, { error: "missing_token" });

  const raw = await readBody(req);
  const parsed = completeSchema.safeParse(raw);
  if (!parsed.success) return send(400, { error: "invalid_request", detail: parsed.error.issues[0]?.message });
  const body = parsed.data;

  let authz: Awaited<ReturnType<typeof authorize>>;
  try {
    authz = await authorize(body.runId, token, "llm:complete");
  } catch (error) {
    // Sin base de datos no se puede autorizar nada: se contesta 503 y el proceso
    // sigue vivo. Un fallo de Postgres no puede tumbar el gateway.
    process.stderr.write(`llm-gateway: authorize fallo code=${pgCode(error)} run=${body.runId}\n`);
    return send(503, { error: "authorization_unavailable" });
  }
  if (!authz.ok) return send(authz.code, { error: authz.error });

  let run: Awaited<ReturnType<typeof loadBudget>>;
  try {
    run = await loadBudget(body.runId);
  } catch (error) {
    process.stderr.write(`llm-gateway: loadBudget fallo code=${pgCode(error)} run=${body.runId}\n`);
    return send(503, { error: "budget_unavailable" });
  }
  if (!run) return send(404, { error: "unknown_run" });
  // Una ejecucion cerrada no admite mas gasto: reabrirla romperia el presupuesto.
  if (run.status !== "running") return send(409, { error: "run_closed", status: run.status });

  const spent = run.tokens_in + run.tokens_out;
  if (spent >= run.prompt_tokens_max) {
    try {
      await pool.query(`UPDATE agent_runs SET status = 'budget_exhausted', stop_reason = 'tokens', ended_at = now() WHERE id = $1::uuid`, [body.runId]);
    } catch (error) {
      // Se cierra la ejecución para que no siga gastando; si el cierre falla, el
      // saldo sigue agotado y quien llama recibe igual 429. Se anota y se sigue.
      process.stderr.write(`llm-gateway: cierre por presupuesto fallo code=${pgCode(error)} run=${body.runId}\n`);
    }
    return send(429, { error: "budget_exhausted" });
  }

  const budget = budgetSchema.parse({
    // El tope persistido manda sobre cualquier configuracion en vuelo.
    maxTokens: Math.max(1, run.prompt_tokens_max - spent),
    maxToolCalls: 0, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 24000,
  });
  // Un alias desconocido es un error de configuracion: se contesta y no se gasta.
  // Se resuelve aqui para poder registrar el id real tambien cuando la llamada falla:
  // `modelId` es lo que de verdad se manda al proveedor, no el alias del catalogo.
  let modelId: string;
  try {
    modelId = providerModelId(body.model, process.env).id;
  } catch {
    return send(400, { error: "invalid_request", detail: `unknown model alias: ${body.model}` });
  }

  const transport = new HttpTransport();
  const client = new LlmClient(transport, new BudgetTracker(budget));
  const out = await client.complete({
    model: body.model,
    messages: body.messages as Parameters<LlmClient["complete"]>[0]["messages"],
    maxOutputTokens: body.maxOutputTokens,
  });

  if (!out.ok) {
    const reason = out.error?.code === "timeout" ? "timeout" : out.error?.code === "refused" ? "refused" : "error";
    // Una sola linea en stderr con el motivo real: sin esto, un 502 en
    // produccion no deja rastro y un problema tan simple como una clave que
    // falta tarda dias en diagnosticarse. Nunca se escribe la clave, la URL
    // con credenciales ni el cuerpo de la peticion; `message` viene de
    // `LlmError` (p.ej. "missing provider key") pero se recorta y se limpia
    // por si algun dia trajera algo inesperado.
    logProviderFailure(reason, out.error, body.runId, modelId);
    try {
      await recordUsage(body.runId, transport.provider, { tokens: 0, costUsd: 0 }, reason, modelId);
    } catch (error) {
      process.stderr.write(`llm-gateway: usage_events fallo code=${pgCode(error)} run=${body.runId}\n`);
    }
    return send(out.stop.kind === "budget" ? 429 : 502, { error: reason, stop: out.stop });
  }

  // CONTABILIDAD APARTE DE LA RESPUESTA, PERO NUNCA UN 200 SIN ELLA.
  //
  // La llamada ya se hizo y el texto ya está pagado: un fallo de contabilidad no
  // puede tumbar el proceso (eso era el bug de RLS). Pero tampoco puede dar un
  // 200 silencioso: sin persistir `tokens_in`/`tokens_out`, `loadBudget` (más
  // arriba) sigue leyendo el contador viejo en la siguiente llamada, y la
  // ejecución gastaría sin tope repitiendo peticiones (solo quedarían los topes
  // por llamada, no el del presupuesto). REGLA: NINGÚN 200 SIN CONTABILIDAD
  // PERSISTIDA. Si el UPDATE de tokens falla, se cierra la ejecución en error
  // (best-effort: si ni eso se puede escribir, se registra y se sigue) y se
  // responde 503, no 200.
  try {
    const contado = await pool.query(
      `UPDATE agent_runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3 WHERE id = $1::uuid`,
      [body.runId, out.result.usage.tokensIn, out.result.usage.tokensOut],
    );
    // Un UPDATE que no toca la fila TAMBIÉN es contabilidad no persistida: si un
    // cierre concurrente dejó la ejecución fuera del `USING (status='running')`,
    // esto afecta 0 filas sin lanzar y el gasto se perdería con un 200. No se
    // intenta cerrarla (ya lo está o no existe): solo se anota y se responde 503.
    if (contado.rowCount !== 1) {
      process.stderr.write(`llm-gateway: tokens no persistidos rows=${contado.rowCount} run=${body.runId}\n`);
      return send(503, { error: "accounting_unavailable" });
    }
  } catch (error) {
    process.stderr.write(`llm-gateway: tokens no persistidos code=${pgCode(error)} run=${body.runId}\n`);
    try {
      await pool.query(
        `UPDATE agent_runs SET status = 'error', stop_reason = 'accounting_unavailable', ended_at = now() WHERE id = $1::uuid`,
        [body.runId],
      );
    } catch (closeError) {
      process.stderr.write(`llm-gateway: cierre por fallo de contabilidad fallo code=${pgCode(closeError)} run=${body.runId}\n`);
    }
    return send(503, { error: "accounting_unavailable" });
  }
  // El coste se recalcula aqui con las variables del gateway: este servicio es el
  // unico que escribe el coste persistido, y `LlmClient` no conoce el entorno.
  //
  // `recordUsage` NO es puerta del presupuesto (`usage_events` es historial, no
  // lo que lee `loadBudget`): si falla, basta con registrar y seguir, el texto
  // ya salió y el gasto real ya quedó contado arriba.
  const costUsd = gatewayCostOf(body.model, out.result.usage.tokensIn, out.result.usage.tokensOut, process.env);
  try {
    await recordUsage(body.runId, transport.provider, { tokens: 0, costUsd }, "ok", modelId);
  } catch (error) {
    process.stderr.write(`llm-gateway: usage_events no persistido code=${pgCode(error)} run=${body.runId}\n`);
  }

  return send(200, {
    text: out.result.text,
    toolCalls: out.result.toolCalls,
    finishReason: out.result.finishReason,
    usage: { ...out.result.usage, costUsd },
    model: modelId,
  });
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

// Solo escucha cuando se ejecuta como programa. Importarlo desde una prueba
// (transporte y mapeo de errores) no debe abrir un puerto ni tocar la base.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Una sola linea al arrancar con el modelo real que se va a usar y de donde
  // salio: es lo que el dueno mira para saber si su variable tomo efecto.
  logModelConfig();
  server.listen(PORT, () => {
    process.stdout.write(`llm-gateway escuchando en ${PORT}\n`);
  });
}
