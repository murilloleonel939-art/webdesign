// Banco de fotos y videos de Pexels (decision del dueno: sin creditos visibles).
//
// Sin dependencias nuevas: `fetch` global con `AbortSignal.timeout`. La clave
// vive SOLO en `process.env['PEXELS_API_KEY']` y no sale de aqui: ni a un log,
// ni a una respuesta, ni a un mensaje de error. Los mensajes de fallo llevan
// `error` como texto corto, nunca la cabecera que se envio.
//
// Nada de este modulo lanza: quien llama recibe una lista vacia o `undefined` y
// decide. Un fallo de un tercero no puede tumbar una subida de fotos.

import { sniffMime } from "@webdesign/assets";

const ENDPOINT_PHOTOS = "https://api.pexels.com/v1/search";
const ENDPOINT_VIDEOS = "https://api.pexels.com/videos/search";
const TIMEOUT_MS = 8000;

// Tope por descarga. El limite de assets para imagen es 5 MB (packages/assets
// LIMITS.imageBytes); aqui se deja un margen y `registerAsset` acaba de decidir.
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// Host EXACTO del que se aceptan ficheros. Se compara `hostname` entero contra
// el conjunto: nada de comodines ni de `endsWith`, que aceptarian
// `images.pexels.com.atacante.tld`. Los videos de Pexels viven bajo este mismo
// host en `/videos/...`, asi que la ruta no amplia el permiso.
const ALLOWED_FILE_HOSTS = new Set(["images.pexels.com"]);

// Lo unico que `registerAsset` admite como imagen publicable.
const ACCEPTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  tiny: string;
}

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographerUrl?: string | undefined;
  alt: string;
  src: PexelsPhotoSrc;
}

export interface PexelsVideoFile {
  id: number;
  quality: string;
  fileType: string;
  width: number;
  height: number;
  /** URL del fichero de video. Se valida como la de las fotos antes de bajarla. */
  link: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  durationS: number;
  photographer: string;
  photographerUrl?: string | undefined;
  /** `video_files` en la respuesta de Pexels, ya normalizado. */
  files: PexelsVideoFile[];
}

export type PexelsOrientation = "landscape" | "portrait" | "square";

export interface PexelsSearchOptions {
  orientation?: PexelsOrientation | undefined;
  perPage?: number | undefined;
}

/** La clave configurada, sin recortar el secreto a nadie mas. */
function apiKey(): string | undefined {
  const key = process.env["PEXELS_API_KEY"];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : undefined;
}

export function isPexelsConfigured(): boolean {
  return apiKey() !== undefined;
}

function clampPerPage(n: number | undefined): number {
  const value = Number.isFinite(n) ? Math.trunc(n as number) : 12;
  return Math.min(24, Math.max(1, value));
}

function message(error: unknown): string {
  return String((error && (error as Error).message) || error);
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function toPhoto(raw: unknown): PexelsPhoto | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const src = (r["src"] ?? {}) as Record<string, unknown>;
  const original = text(src["original"]);
  const id = num(r["id"]);
  if (id === 0 || original === "") return undefined;
  const photographerUrl = text(r["photographer_url"]);
  return {
    id,
    width: num(r["width"]),
    height: num(r["height"]),
    url: text(r["url"]),
    photographer: text(r["photographer"]),
    ...(photographerUrl ? { photographerUrl } : {}),
    alt: text(r["alt"]),
    src: {
      original,
      large2x: text(src["large2x"]),
      large: text(src["large"]),
      medium: text(src["medium"]),
      tiny: text(src["tiny"]),
    },
  };
}

function toVideo(raw: unknown): PexelsVideo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const id = num(r["id"]);
  if (id === 0) return undefined;
  const user = (r["user"] ?? {}) as Record<string, unknown>;
  const photographerUrl = text(user["url"]);
  const rawFiles = Array.isArray(r["video_files"]) ? r["video_files"] : [];
  const files: PexelsVideoFile[] = [];
  for (const f of rawFiles) {
    if (!f || typeof f !== "object") continue;
    const file = f as Record<string, unknown>;
    const link = text(file["link"]);
    if (link === "") continue;
    files.push({
      id: num(file["id"]),
      quality: text(file["quality"]),
      fileType: text(file["file_type"]),
      width: num(file["width"]),
      height: num(file["height"]),
      link,
    });
  }
  return {
    id,
    width: num(r["width"]),
    height: num(r["height"]),
    url: text(r["url"]),
    image: text(r["image"]),
    durationS: num(r["duration"]),
    photographer: text(user["name"]),
    ...(photographerUrl ? { photographerUrl } : {}),
    files,
  };
}

// Peticion comun a los dos buscadores. Devuelve el JSON o `undefined`; el
// registro de fallos es aqui y solo aqui, para no repetirlo con la clave cerca.
async function getJson(endpoint: string, params: URLSearchParams, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const key = apiKey();
  if (!key) {
    // Sin clave no hay banco: se dice y se sigue. Nunca se registra el valor.
    console.warn("pexels_not_configured", { endpoint: label });
    return undefined;
  }
  try {
    const res = await fetchImpl(`${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: { authorization: key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("pexels_search_failed", { endpoint: label, error: `http_${res.status}` });
      return undefined;
    }
    return await res.json();
  } catch (error) {
    // Timeout, DNS, red caida: mismo trato, lista vacia.
    console.warn("pexels_search_failed", { endpoint: label, error: message(error) });
    return undefined;
  }
}

export async function searchPhotos(
  query: string,
  opts: PexelsSearchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<PexelsPhoto[]> {
  const q = query.trim().slice(0, 80);
  if (q === "") return [];
  const params = new URLSearchParams({ query: q, per_page: String(clampPerPage(opts.perPage)) });
  if (opts.orientation) params.set("orientation", opts.orientation);
  const body = await getJson(ENDPOINT_PHOTOS, params, fetchImpl, "photos");
  const list = (body as { photos?: unknown } | undefined)?.photos;
  if (!Array.isArray(list)) return [];
  const out: PexelsPhoto[] = [];
  for (const raw of list) {
    const photo = toPhoto(raw);
    if (photo) out.push(photo);
  }
  return out;
}

export async function searchVideos(
  query: string,
  opts: PexelsSearchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<PexelsVideo[]> {
  const q = query.trim().slice(0, 80);
  if (q === "") return [];
  const params = new URLSearchParams({ query: q, per_page: String(clampPerPage(opts.perPage)) });
  if (opts.orientation) params.set("orientation", opts.orientation);
  const body = await getJson(ENDPOINT_VIDEOS, params, fetchImpl, "videos");
  const list = (body as { videos?: unknown } | undefined)?.videos;
  if (!Array.isArray(list)) return [];
  const out: PexelsVideo[] = [];
  for (const raw of list) {
    const video = toVideo(raw);
    if (video) out.push(video);
  }
  return out;
}

/**
 * URL de fichero aceptable, o `undefined`.
 *
 * Solo https y solo los hosts exactos de Pexels: la URL viene de un tercero, asi
 * que se valida aqui y no se confia en ella para nada mas.
 */
function safeFileUrl(raw: string): URL | undefined {
  if (raw === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (!ALLOWED_FILE_HOSTS.has(parsed.hostname)) return undefined;
  return parsed;
}

// Lee el cuerpo cortando en `maxBytes`. Acumular primero y comprobar despues
// dejaria que un servidor hostil llenara la memoria antes del limite.
//
// Se exporta porque `unsplash.ts` (otro proveedor, mismo problema) la reutiliza:
// el tope de bytes y el corte del stream no se duplican. `logEvent` permite que
// cada modulo registre sus fallos con su propio nombre, sin perder trazas.
export async function readCapped(
  res: Response,
  maxBytes: number,
  logEvent: string = "pexels_download_failed",
): Promise<Buffer | undefined> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    // Respuesta sin stream (o doble de pruebas): se comprueba el tamano entero.
    let buf: Buffer;
    try {
      buf = Buffer.from(await res.arrayBuffer());
    } catch {
      return undefined;
    }
    return buf.byteLength === 0 || buf.byteLength > maxBytes ? undefined : buf;
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        // Cortar y soltar: se deja de leer en cuanto se pasa del tope.
        try {
          await reader.cancel();
        } catch {
          // El cuerpo ya no interesa; un fallo al cancelar no cambia el resultado.
        }
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    console.warn(logEvent, { error: message(error) });
    return undefined;
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

export async function downloadPhoto(
  photo: PexelsPhoto,
  maxBytes: number = MAX_PHOTO_BYTES,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: Buffer; mime: string } | undefined> {
  const src = photo && photo.src ? photo.src : undefined;
  if (!src) return undefined;
  const target = safeFileUrl(src.large2x || src.original || src.large);
  if (!target) return undefined;

  let res: Response;
  try {
    res = await fetchImpl(target, {
      method: "GET",
      // Un redirect podria llevar a cualquier host: se trata como fallo.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.warn("pexels_download_failed", { error: message(error) });
    return undefined;
  }
  if (!res.ok) {
    console.warn("pexels_download_failed", { error: `http_${res.status}` });
    return undefined;
  }

  // La cabecera se mira antes de leer: si ya se declara mas grande, no se baja.
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;

  const content = await readCapped(res, maxBytes);
  if (!content) return undefined;

  // El tipo real manda: cabecera y extension se falsifican.
  const mime = sniffMime(content.subarray(0, 16));
  if (!mime || !ACCEPTED_IMAGE_MIME.has(mime)) return undefined;
  return { content, mime };
}
