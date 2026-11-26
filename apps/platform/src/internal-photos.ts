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
import { isSector, listBankPhotos, readBankPhoto, type BankPhoto, type Sector } from "./photo-bank.js";

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
    // `pg` devuelve los nombres de columna tal cual: sin alias, la fila trae
    // `site_id` y `row.siteId` es `undefined`, asi que TODA peticion caia en 404.
    `SELECT run_id AS "runId", user_id AS "userId", site_id AS "siteId"
       FROM app_agent_token_check($1::uuid, $2)`,
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
  /**
   * Sector del negocio, tal como lo calcula `sectorForBrief` en el agente.
   *
   * NO se valida aquí contra la lista cerrada: un sector desconocido no es un
   * cuerpo inválido, es un banco que caerá en `neutro`. La lista vive en
   * photo-bank.ts, que es quien conoce las carpetas.
   */
  sector?: string | undefined;
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
  const rawSector = b["sector"];
  const sector = typeof rawSector === "string" ? rawSector.trim() : undefined;
  return { query: q, orientation, count, sector };
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
    console.warn("internal_photos_denied", { siteId, status: authz.code, error: authz.error });
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

  const { userId } = authz.auth;

  // Fotos ya usadas en ESTE sitio: por `source_url` y por `credit_text`.
  // Cualquiera de las dos basta para no repetir dentro del mismo sitio.
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

  // ---- FUENTE DE CANDIDATOS -----------------------------------------------
  // El orden importa y es el que fija T-020:
  // 1. Banco local, con el sector del brief: fotos ya verificadas del sector.
  // 2. Pexels, solo si está configurado y el banco no llegó a `count`.
  // 3. Unsplash, si algún día hay clave (hoy no hay cliente: no se llama).
  // -------------------------------------------------------------------------

  // Orientación del banco: landscape para "landscape", square para "square",
  // landscape para "portrait" y sin orientación (el banco no tiene portrait).
  const bankOrientation: "landscape" | "square" =
    body.orientation === "square" ? "square" : "landscape";

  // Sector cerrado: lo que no esté en la lista vale `neutro`, nunca un 400.
  const sector: Sector = isSector(body.sector) ? body.sector : "neutro";

  type Candidate = {
    id: string | number;
    url: string;           // source_url del activo: página de la foto o de Pexels
    photographer: string;
    alt: string;
    width: number;
    height: number;
    src: { original: string; large2x: string; large: string; medium: string; tiny: string };
    _bankPhoto?: BankPhoto; // presente solo para candidatos del banco
  };

  // 1. Banco local. Construimos candidatos en el mismo formato que Pexels para
  // que el bucle de abajo sea idéntico para ambas fuentes.
  const bankPhotos = await listBankPhotos(bankOrientation, sector);
  let candidates: Candidate[] = bankPhotos.map((bp) => ({
    id: bp.id,
    url: bp.sourceUrl,
    photographer: bp.author,
    alt: bp.alt,
    width: bp.width,
    height: bp.height,
    src: { original: "", large2x: "", large: "", medium: "", tiny: "" },
    _bankPhoto: bp,
  }));

  // 2. Pexels, solo si el banco no llegó a lo pedido. Un banco completo NO paga
  // una llamada externa; uno incompleto (p. ej. `despacho` tiene 2 landscape) sí
  // puede rellenarse, y el bucle de abajo los mezcla sin problema porque el
  // dedupe y la descarga se deciden por candidato, no por fuente.
  if (candidates.length < body.count && isPexelsConfigured()) {
    const pexelsCandidates = await searchPhotos(body.query, {
      orientation: body.orientation,
      perPage: Math.min(24, body.count * 4),
    });
    candidates = candidates.concat(pexelsCandidates.map((p) => ({
      id: p.id,
      url: p.url,
      photographer: p.photographer,
      alt: p.alt,
      width: p.width,
      height: p.height,
      src: p.src,
    })));
  }

  // 3. Unsplash: previsto, pero hoy no hay cliente ni clave, así que no hay
  // rama que ejecutar. Cuando exista, va aquí, después del banco.

  if (candidates.length === 0) {
    json(res, 200, { photos: [] });
    return true;
  }

  // ---- BUCLE UNIFICADO (Pexels o banco) ------------------------------------

  const photos: Array<{ assetId: string; alt: string; width: number; height: number }> = [];
  for (const photo of candidates) {
    if (photos.length >= body.count) break;

    // Dedupe por sitio, decidido POR CANDIDATO (el banco y Pexels pueden
    // convivir en la misma lista).
    // Para banco: la URL canónica es la página de la foto, exacta.
    // Para Pexels: además del source_url, el sufijo "-<id>/" que sobrevive a un
    //   enlace reescrito.
    if (photo.url !== "" && used.has(photo.url)) continue;

    let yaEnSitio = false;
    if (photo._bankPhoto === undefined) {
      // Comprobación original de Pexels: sufijo "-<id>/" en source_url o credit_text.
      const idMark = `-${photo.id}/`;
      for (const value of used) {
        if (value === photo.url || value.endsWith(idMark) || value.includes(`${idMark} `)) {
          yaEnSitio = true;
          break;
        }
      }
    } else {
      // Para el banco la URL canónica es exacta; ya la comprobamos arriba con
      // used.has(photo.url). Nada más que hacer aquí.
    }
    if (yaEnSitio) continue;

    let content: Buffer;
    let metaFile: { author: string; sourceUrl: string; license: string; mime: string };

    if (photo._bankPhoto) {
      // ---- BANCO LOCAL ----------------------------------------------------
      const file = await readBankPhoto(photo._bankPhoto);
      if (!file) {
        console.warn("bank_read_failed", { id: photo.id, file: photo._bankPhoto.file });
        continue;
      }
      content = file.content;
      metaFile = {
        author: photo._bankPhoto.author,
        sourceUrl: photo._bankPhoto.sourceUrl,
        license: photo._bankPhoto.license,
        mime: file.mime,
      };
    } else {
      // ---- PEXELS ----------------------------------------------------------
      // BIBLIOTECA ANTES QUE RED: si la foto ya se bajo para cualquier sitio,
      // no se vuelve a pedir a Pexels.
      // Solo los candidatos de Pexels llegan aquí, y su id es numérico.
      const pexelsId = typeof photo.id === "number" ? photo.id : undefined;
      if (pexelsId === undefined) continue;
      const cached = await readFromLibrary(pexelsId);
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
        // photo.src está completo porque viene de searchPhotos (Pexels).
        const pexelsPhoto = {
          id: pexelsId,
          width: photo.width,
          height: photo.height,
          url: photo.url,
          photographer: photo.photographer,
          alt: photo.alt,
          src: photo.src,
        };
        const downloaded = await downloadPhoto(pexelsPhoto);
        if (!downloaded) continue;
        const saved = await saveToLibrary({
          photo: pexelsPhoto,
          content: downloaded.content,
          mime: downloaded.mime,
          query: body.query,
          siteId,
        });
        content = downloaded.content;
        metaFile = { author: saved.photographer, sourceUrl: saved.sourceUrl, license: saved.license, mime: saved.mime };
      }
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
      console.warn("photo_register_failed", { siteId, reason: registered.reason });
      continue;
    }
    used.add(photo.url);

    // Trazabilidad fuera de la página. Si falla, la foto ya está registrada y
    // la ruta no se cae: `appendFuente` no lanza.
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
