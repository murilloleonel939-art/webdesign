// Ruta interna de fotos para los agentes: POST /api/internal/sites/:id/photos.
//
// AUTENTICACION: la MISMA que el resto de la API interna de agentes. El token de
// una ejecucion es el `jti` de `agent_tokens`, viaja como `Authorization: Bearer`
// y se valida comprobando que no este revocado, que no haya vencido y que sus
// `scopes` cubran lo que se pide. Es exactamente lo que hace el gateway en
// apps/llm-gateway/src/server.ts:214-224 (`authorize`), y lo que el SDK declara
// en packages/agent-sdk/src/index.ts:18-22 ("token temporal con scopes").
//
// La diferencia es de donde se lee: el gateway tiene su propio rol y una
// politica de lectura (0015), y la plataforma no, porque `agent_tokens` lleva
// FORCE RLS y su politica exige `app.user_id` (0014), que es justo lo que el
// token sirve para averiguar. Por eso se lee con la funcion SECURITY DEFINER
// `app_agent_token_check` (0022), que devuelve como mucho una fila con tres UUID.
//
// QUE NO SALE DE AQUI: ni la clave de Pexels, ni una URL de Pexels, ni el autor.
// El cliente final recibe solo `assetId`, alto, ancho y el texto alternativo.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { withUser } from "@webdesign/db";
import { registerAsset } from "@webdesign/assets";
import { downloadPhoto, isPexelsConfigured, searchPhotos, type PexelsOrientation } from "./pexels.js";
import { appendFuente } from "./fuentes.js";
import { readFromLibrary, saveToLibrary } from "./library.js";

// El agente de diseno escribe en el sitio, y esta ruta escribe en el sitio: el
// scope tiene que ser el mismo que usan sus herramientas (`site:write`).
const REQUIRED_SCOPE = "site:write";

const MAX_COUNT = 6;
const MAX_QUERY = 80;

export interface AgentAuth {
  runId: string;
  userId: string;
  siteId: string | null;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Un cuerpo de esta ruta son tres campos cortos: el limite es holgado.
    if (size > 10_000) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Valida el token de agente con el mismo criterio que el gateway.
 *
 * Un token con formato invalido no llega a la base: 401 sin consulta. Sin fila
 * vigente es 401; con fila pero sin scope es 403; un scope correcto sobre otro
 * sitio es 404, que es lo que ya hace el resto de rutas del panel para no
 * distinguir "no existe" de "no es tuyo".
 */
export async function authorizeAgent(pool: Pool, req: IncomingMessage, siteId: string): Promise<{ ok: true; auth: AgentAuth } | { ok: false; code: number; error: string }> {
  const header = req.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token === "") return { ok: false, code: 401, error: "missing_token" };
  // El `jti` es un UUID: cualquier otra cosa es un token inventado.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return { ok: false, code: 401, error: "invalid_token" };
  }
  const rows = await pool.query<AgentAuth>(
    "SELECT run_id, user_id, site_id FROM app_agent_token_check($1::uuid, $2)",
    [token, REQUIRED_SCOPE],
  );
  const row = rows.rows[0];
  if (!row) return { ok: false, code: 401, error: "invalid_token" };
  // El token esta acotado a un sitio (0014): si no es este, no es de este sitio.
  if (row.siteId !== siteId) return { ok: false, code: 404, error: "not_found" };
  return { ok: true, auth: row };
}

interface PhotoRequest {
  query: string;
  orientation?: PexelsOrientation | undefined;
  count: number;
}

function parseBody(raw: unknown): PhotoRequest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const q = typeof b["query"] === "string" ? b["query"].trim() : "";
  if (q === "" || q.length > MAX_QUERY) return undefined;
  // `count` es opcional: sin el, tres fotos. Nunca mas de seis.
  const rawCount = b["count"];
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.trunc(rawCount) : 3;
  if (count < 1 || count > MAX_COUNT) return undefined;
  const rawOrientation = b["orientation"];
  const orientation = rawOrientation === "landscape" || rawOrientation === "portrait" || rawOrientation === "square"
    ? rawOrientation
    : undefined;
  if (rawOrientation !== undefined && orientation === undefined) return undefined;
  return { query: q, orientation, count };
}

/** Fechas en ISO corto: el archivo de fuentes lo lee una persona, no un parser. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Maneja POST /api/internal/sites/:id/photos. Devuelve `true` si la ruta era suya.
 *
 * El orden importa: autenticacion, validacion, y solo despues red y disco. Un
 * token invalido no puede provocar ni una llamada a Pexels.
 */
export async function handleInternalPhotos(
  pool: Pool,
  sitesRoot: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const match = /^\/api\/internal\/sites\/([0-9a-f-]{36})\/photos$/.exec(url.pathname);
  if (!match) return false;
  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed" });
    return true;
  }
  const siteId = match[1] as string;

  const authz = await authorizeAgent(pool, req, siteId);
  if (!authz.ok) {
    json(res, authz.code, { error: authz.error });
    return true;
  }

  let body: PhotoRequest | undefined;
  try {
    body = parseBody(await readJson(req));
  } catch {
    json(res, 400, { error: "invalid_body" });
    return true;
  }
  if (!body) {
    json(res, 400, { error: "invalid_body" });
    return true;
  }

  // Sin clave no hay banco: se dice sin fingir que no habia fotos.
  if (!isPexelsConfigured()) {
    json(res, 503, { error: "pexels_not_configured" });
    return true;
  }

  const { userId } = authz.auth;

  // Se piden de mas para poder descartar las ya usadas sin quedarse corto.
  const candidates = await searchPhotos(body.query, {
    orientation: body.orientation,
    perPage: Math.min(24, body.count * 4),
  });
  if (candidates.length === 0) {
    json(res, 200, { photos: [] });
    return true;
  }

  // Fotos ya usadas en ESTE sitio: por `source_url` (la ficha de Pexels) y por
  // `credit_text`, que es donde queda la atribucion. Cualquiera de las dos basta
  // para no repetir, y asi una fila antigua sin `source_url` tambien cuenta.
  const used = await withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ source_url: string | null; credit_text: string | null }>(
      "SELECT source_url, credit_text FROM assets WHERE site_id = $1",
      [siteId],
    );
    const urls = new Set<string>();
    for (const row of r.rows) {
      if (row.source_url) urls.add(row.source_url);
      if (row.credit_text) urls.add(row.credit_text);
    }
    return urls;
  });

  const photos: Array<{ assetId: string; alt: string; width: number; height: number }> = [];
  for (const photo of candidates) {
    if (photos.length >= body.count) break;
    // Misma foto, mismo sitio: no se repite. Se compara por `source_url` (la
    // ficha de Pexels), por `credit_text` (autor + licencia + enlace) y por el
    // id de Pexels al final de cualquiera de los dos, que sobrevive a un enlace
    // reescrito.
    if (photo.url !== "" && used.has(photo.url)) continue;
    const idMark = `-${photo.id}/`;
    let yaEnSitio = false;
    for (const value of used) {
      if (value === photo.url || value.endsWith(idMark) || value.includes(`${idMark} `)) {
        yaEnSitio = true;
        break;
      }
    }
    if (yaEnSitio) continue;

    // BIBLIOTECA ANTES QUE RED: si la foto ya se bajo para cualquier sitio, no
    // se vuelve a pedir a Pexels. Solo se registra el id: nunca la clave ni URLs.
    const cached = await readFromLibrary(photo.id);
    let content: Buffer;
    let metaFile: { author: string; sourceUrl: string; license: string; mime: string };
    if (cached) {
      console.info("pexels_library_hit", { id: photo.id });
      content = cached.content;
      metaFile = {
        author: cached.meta.photographer,
        sourceUrl: cached.meta.sourceUrl,
        license: cached.meta.license,
        mime: cached.meta.mime,
      };
    } else {
      console.info("pexels_library_miss", { id: photo.id });
      const file = await downloadPhoto(photo);
      if (!file) continue;
      // Se guarda una vez y se usa ese mismo contenido; la copia del sitio va
      // aparte, asi que borrar la biblioteca no rompe sitios publicados.
      const saved = await saveToLibrary({
        photo,
        content: file.content,
        mime: file.mime,
        query: body.query,
        siteId,
      });
      content = file.content;
      metaFile = { author: saved.photographer, sourceUrl: saved.sourceUrl, license: saved.license, mime: saved.mime };
    }

    const registered = await registerAsset(pool, {
      userId,
      siteId,
      kind: "image",
      content,
      declaredMime: metaFile.mime,
      source: "open-collection",
      rights: { license: metaFile.license, author: metaFile.author, sourceUrl: metaFile.sourceUrl },
      sitesRoot,
    });
    if (!registered.ok) {
      // Cuota, cuenta o tipo: la foto se descarta y se prueba la siguiente. El
      // motivo no se devuelve al agente, que no puede hacer nada distinto con el.
      console.warn("pexels_register_failed", { siteId, reason: registered.reason });
      continue;
    }
    used.add(photo.url);

    // Trazabilidad fuera de la pagina, con los datos del META de la biblioteca y
    // no con la respuesta de red: una foto cacheada tambien deja su fuente. Si
    // falla, la foto ya esta registrada y la ruta no se cae: `appendFuente` no
    // lanza.
    await appendFuente(sitesRoot, siteId, {
      assetId: registered.id,
      author: metaFile.author,
      sourceUrl: metaFile.sourceUrl,
      license: metaFile.license,
      date: today(),
    });

    photos.push({ assetId: registered.id, alt: photo.alt, width: photo.width, height: photo.height });
  }

  json(res, 200, { photos });
  return true;
}
