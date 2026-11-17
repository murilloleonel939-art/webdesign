import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { BudgetTracker, LlmClient, LlmError, budgetSchema, type Transport } from "@webdesign/llm";

// Servicio `llm-gateway` (spec 8.3 y linea 131): el UNICO que tiene las claves de
// proveedor. Emite y valida tokens temporales con presupuesto.
//
// Lo que este servicio NO hace: decidir que modelo usar por lo que diga el
// modelo, publicar sitios, leer contenido de sitios ni tocar drafts. Si se ve
// comprometido, escribe consumo y poco mas (ver 0015_llm_gateway_role.sql).

const PORT = Number(process.env["PORT"] ?? 3001);
const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });

/**
 * Transporte real. Traduce el formato neutro al del proveedor y de vuelta.
 *
 * La clave se lee aqui y no sale de este proceso: ni siquiera se pasa por
 * argumento a otra funcion, para que no acabe en un log de traza.
 */
class HttpTransport implements Transport {
  readonly provider = "openai";

  async complete(req: Parameters<Transport["complete"]>[0]) {
    const started = Date.now();
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new LlmError("provider_error", "missing provider key");

    const body = {
      model: req.model,
      messages: req.messages.map(toProviderMessage),
      max_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: t })) } : {}),
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(req.signal ? { signal: req.signal } : {}),
    });

    if (res.status === 429) throw new LlmError("rate_limit", "429");
    if (res.status >= 400 && res.status < 500) throw new LlmError("invalid_request", `${res.status}`);
    if (!res.ok) throw new LlmError("provider_error", `${res.status}`);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    const rawCalls = choice?.message?.tool_calls ?? [];

    return {
      text: choice?.message?.content ?? "",
      toolCalls: rawCalls.map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) })),
      finishReason: mapFinish(choice?.finish_reason),
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        costUsd: 0,
      },
      model: req.model,
      latencyMs: Date.now() - started,
    };
  }
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

async function recordUsage(runId: string, used: { tokens: number; costUsd: number }, outcome: string, model: string) {
  await pool.query(
    `INSERT INTO usage_events (id, provider, model, tokens_in, tokens_out, cost_usd, latency_ms, run_id, outcome)
     VALUES ($1, 'openai', $2, 0, 0, $3, 0, $4::uuid, $5)`,
    [randomUUID(), model, used.costUsd, runId, outcome],
  );
}

const server = createServer(async (req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.url === "/healthz") return send(200, { ok: true });

  if (req.method !== "POST" || req.url !== "/v1/complete") return send(404, { error: "not_found" });

  const auth = req.headers.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return send(401, { error: "missing_token" });

  const raw = await readBody(req);
  const parsed = completeSchema.safeParse(raw);
  if (!parsed.success) return send(400, { error: "invalid_request", detail: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const authz = await authorize(body.runId, token, "llm:complete");
  if (!authz.ok) return send(authz.code, { error: authz.error });

  const run = await loadBudget(body.runId);
  if (!run) return send(404, { error: "unknown_run" });
  // Una ejecucion cerrada no admite mas gasto: reabrirla romperia el presupuesto.
  if (run.status !== "running") return send(409, { error: "run_closed", status: run.status });

  const spent = run.tokens_in + run.tokens_out;
  if (spent >= run.prompt_tokens_max) {
    await pool.query(`UPDATE agent_runs SET status = 'budget_exhausted', stop_reason = 'tokens', ended_at = now() WHERE id = $1::uuid`, [body.runId]);
    return send(429, { error: "budget_exhausted" });
  }

  const budget = budgetSchema.parse({
    // El tope persistido manda sobre cualquier configuracion en vuelo.
    maxTokens: Math.max(1, run.prompt_tokens_max - spent),
    maxToolCalls: 0, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 24000,
  });
  const client = new LlmClient(new HttpTransport(), new BudgetTracker(budget));
  const out = await client.complete({
    model: body.model,
    messages: body.messages as Parameters<LlmClient["complete"]>[0]["messages"],
    maxOutputTokens: body.maxOutputTokens,
  });

  if (!out.ok) {
    const reason = out.error?.code === "timeout" ? "timeout" : out.error?.code === "refused" ? "refused" : "error";
    await recordUsage(body.runId, { tokens: 0, costUsd: 0 }, reason, body.model);
    return send(out.stop.kind === "budget" ? 429 : 502, { error: reason, stop: out.stop });
  }

  await pool.query(
    `UPDATE agent_runs SET tokens_in = tokens_in + $2, tokens_out = tokens_out + $3 WHERE id = $1::uuid`,
    [body.runId, out.result.usage.tokensIn, out.result.usage.tokensOut],
  );
  await recordUsage(body.runId, { tokens: 0, costUsd: out.result.usage.costUsd }, "ok", out.result.model);

  return send(200, {
    text: out.result.text,
    toolCalls: out.result.toolCalls,
    finishReason: out.result.finishReason,
    usage: out.result.usage,
    model: out.result.model,
  });
});

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

server.listen(PORT, () => {
  process.stdout.write(`llm-gateway escuchando en ${PORT}\n`);
});
