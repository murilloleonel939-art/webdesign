import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Pool } from "pg";
import { withUser } from "@webdesign/db";
import { hashPassword, verifyPassword, newSessionToken } from "@webdesign/auth";
import { saveDraft, loadDraft } from "@webdesign/editor/save";
import { publish, rollbackTo } from "@webdesign/publish";

// Superficie HTTP del ciclo de Fase 1: crear, editar, previsualizar, publicar y
// revertir. Cada operacion se ejecuta con el usuario de la sesion, nunca con el rol
// administrador, y RLS decide que filas ve.

export interface ApiDeps {
  pool: Pool;
  sitesRoot: string;
}

interface Ctx {
  userId: string;
  sessionId: string;
}

const SESSION_COOKIE = "sid";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// La sesion se resuelve contra su hash: el token en claro no esta almacenado.
export async function resolveSession(pool: Pool, token: string | undefined): Promise<Ctx | undefined> {
  if (!token) return undefined;
  const { tokenHash } = hashToken(token);
  // Tambien por funcion acotada: quien presenta el token aun no se ha identificado.
  const r = await pool.query<{ id: string; user_id: string }>(
    "SELECT id, user_id FROM auth_lookup_session($1)",
    [tokenHash],
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id, sessionId: row.id } : undefined;
}

function hashToken(token: string): { tokenHash: string } {
  // Mismo algoritmo que newSessionToken: sha256 en hexadecimal.
  return { tokenHash: createHash("sha256").update(token).digest("hex") };
}

export async function createUser(pool: Pool, email: string, name: string, password: string): Promise<string> {
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash) VALUES ($1, lower($2), $3, $4)`,
    [id, email, name, passwordHash],
  );
  return id;
}

export async function startSession(pool: Pool, userId: string, ttlMinutes = 60 * 24): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [randomUUID(), userId, tokenHash, String(ttlMinutes)],
  );
  return token;
}

export async function login(pool: Pool, email: string, password: string): Promise<{ userId: string; token: string } | undefined> {
  // La busqueda por email va por `auth_lookup_login` (SECURITY DEFINER acotada):
  // RLS en `users` solo permite ver la fila propia.
  const r = await pool.query<{ id: string; password_hash: string | null }>(
    "SELECT id, password_hash FROM auth_lookup_login($1)",
    [email],
  );
  const row = r.rows[0];
  if (!row?.password_hash) return undefined;
  if (!(await verifyPassword(password, row.password_hash))) return undefined;
  return { userId: row.id, token: await startSession(pool, row.id) };
}

export async function createSite(pool: Pool, userId: string, name: string): Promise<string> {
  const id = randomUUID();
  // RLS comprueba que owner_id sea el usuario de la sesion.
  await withUser(pool, userId, async (tx) => {
    await tx.query("INSERT INTO sites (id, owner_id, name) VALUES ($1, $2, $3)", [id, userId, name]);
  });
  return id;
}

export async function listSites(pool: Pool, userId: string): Promise<{ id: string; name: string; status: string }[]> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string; name: string; status: string }>(
      "SELECT id, name, status FROM sites ORDER BY created_at",
    );
    return r.rows;
  });
}

// Assets activos de un sitio: id -> ruta publica y ruta fisica. Los retirados no entran.
export async function activeAssets(pool: Pool, userId: string, siteId: string, sitesRoot: string): Promise<{
  resolveAssetPath: (assetId: string) => string | undefined;
  assetFiles: Record<string, string>;
}> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query<{ id: string; path: string }>(
      "SELECT id, path FROM assets WHERE site_id = $1 AND takedown_status = 'active'",
      [siteId],
    )).rows,
  );
  // Ruta absoluta: una relativa rompe en paginas anidadas ("/precios/" buscaria /precios/assets).
  const byId = new Map(rows.map((r) => [r.id, `/assets/${r.path}`]));
  const assetFiles: Record<string, string> = {};
  for (const r of rows) assetFiles[`assets/${r.path}`] = join(sitesRoot, siteId, "assets", r.path);
  return { resolveAssetPath: (id) => byId.get(id), assetFiles };
}

export { saveDraft, loadDraft, publish, rollbackTo, SESSION_COOKIE };
