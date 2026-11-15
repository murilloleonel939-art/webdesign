// Formularios publicos `/_f/lead` (Fase 2).
// El sitio se resuelve SIEMPRE por el `Host` de la peticion, nunca por un
// parametro del cliente (spec linea 403): si se aceptara un `siteId` del
// formulario, cualquiera podria escribir en la bandeja de otro.

import type pg from "pg";
import { createHash } from "node:crypto";

export interface LeadInput {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  message?: string | undefined;
  consent: boolean;
}

export interface LeadContext {
  host: string;
  ip: string;
  userAgent: string;
  consentVersion: string;
}

export type LeadResult =
  | { ok: true }
  // Respuesta uniforme: el visitante no debe poder distinguir un host
  // inexistente de uno suspendido (spec linea 404).
  | { ok: false; reason: "unknown_host" | "invalid" | "rate_limited" };

const MAX = { name: 120, email: 254, phone: 40, message: 4000 };

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (t.length === 0) return undefined;
  return t.slice(0, max);
}

// Detras de Caddy y Traefik, `req.socket.remoteAddress` es siempre el proxy: sin
// esto, el limite por IP contaria a todos los visitantes como uno solo. Se toma
// la ultima entrada de X-Forwarded-For, que es la que anade nuestro proxy; las
// anteriores las puede inventar el cliente y no se usan.
export function clientIp(headers: Record<string, string | string[] | undefined>, remote: string | undefined): string {
  const raw = headers["x-forwarded-for"];
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (typeof value === "string" && value.length > 0) {
    const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    // Solo formas que parecen una IP; cualquier otra cosa cae al socket.
    if (last && /^[0-9a-fA-F:.]{3,45}$/.test(last)) return last;
  }
  return remote ?? "0.0.0.0";
}

// Se guarda el hash, no la IP: sirve para limitar el abuso sin conservar el dato.
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

// El formulario del sitio es HTML clasico (funciona sin JavaScript), pero un
// cliente puede mandar JSON. Se aceptan ambos sin depender de una libreria.
export async function parseLeadForm(req: AsyncIterable<Buffer | string> & { headers: Record<string, string | string[] | undefined> }): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    // Un formulario de contacto real no llega ni a 20 KB.
    if (size > 100_000) throw new Error("payload too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] ?? "");

  if (type.includes("application/json")) {
    const parsed: unknown = JSON.parse(text || "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  }
  // application/x-www-form-urlencoded
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

export function validateLead(raw: Record<string, unknown>): { ok: true; value: LeadInput } | { ok: false } {
  const name = clean(raw.name, MAX.name);
  const email = clean(raw.email, MAX.email);
  const phone = clean(raw.phone, MAX.phone);
  const message = clean(raw.message, MAX.message);
  const consent = raw.consent === true || raw.consent === "on" || raw.consent === "true";

  // Hace falta al menos una forma de responder, o el aviso no sirve de nada.
  if (!email && !phone) return { ok: false };
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return { ok: false };
  if (!message && !name) return { ok: false };
  return { ok: true, value: { name, email, phone, message, consent } };
}

// Limite sencillo por IP y sitio: descarta inundaciones sin tocar la tabla.
export async function recentCount(pool: pg.Pool, siteId: string, ipHash: string, minutes: number): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM leads
     WHERE site_id = $1 AND source_ip_hash = $2 AND created_at > now() - ($3 || ' minutes')::interval`,
    [siteId, ipHash, String(minutes)],
  );
  return Number(r.rows[0]?.n ?? 0);
}

// Resolver host -> sitio. La marca `app.public_resolve` vive solo en esta
// transaccion: es lo que abre las politicas acotadas de 0008.
export async function resolveSite(pool: pg.Pool, host: string): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.public_resolve = 'on'");
    const r = await client.query<{ site_id: string }>(
      `SELECT d.site_id FROM domains d
       JOIN sites s ON s.id = d.site_id
       WHERE lower(d.hostname) = lower($1) AND d.status = 'active' AND s.status = 'active'
       LIMIT 1`,
      [host],
    );
    await client.query("COMMIT");
    return r.rows[0]?.site_id;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function recordLead(
  pool: pg.Pool,
  siteId: string,
  input: LeadInput,
  ctx: LeadContext,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.public_form = 'on'");
    // Sin consentimiento no se guarda el dato: la politica de 0008 lo impide,
    // asi que se sale sin insertar en lugar de provocar un error de RLS.
    if (!input.consent) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(
      `INSERT INTO leads (id, site_id, name, email, phone, message, type, consent,
                          consent_text_version, source_host, source_ip_hash, user_agent, spam_score, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'contact', true, $6, $7, $8, $9, 0, 'new')`,
      [siteId, input.name ?? null, input.email ?? null, input.phone ?? null, input.message ?? null,
       ctx.consentVersion, ctx.host, hashIp(ctx.ip, siteId), ctx.userAgent.slice(0, 400)],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function handleLead(
  pool: pg.Pool,
  raw: Record<string, unknown>,
  ctx: LeadContext,
): Promise<LeadResult> {
  const parsed = validateLead(raw);
  if (!parsed.ok) return { ok: false, reason: "invalid" };

  const siteId = await resolveSite(pool, ctx.host);
  if (!siteId) return { ok: false, reason: "unknown_host" };

  const ipHash = hashIp(ctx.ip, siteId);
  if ((await recentCount(pool, siteId, ipHash, 10)) >= 5) {
    return { ok: false, reason: "rate_limited" };
  }

  await recordLead(pool, siteId, parsed.value, ctx);
  return { ok: true };
}
