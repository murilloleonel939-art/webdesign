// Busqueda y descarga de fotos de Unsplash.
//
// Todavia NO esta conectado a nada: es solo el cliente y su contrato. Cuando se
// enganche (internal-photos.ts), la forma de llamarlo es la de pexels.ts.
//
// Sin dependencias nuevas: `fetch` global con `AbortSignal.timeout`. La clave
// vive SOLO en `process.env['UNSPLASH_API_KEY']` y no sale de aqui: ni a un log,
// ni a una respuesta, ni a un mensaje de error. Los mensajes de fallo llevan
// `error` como texto corto, nunca la cabecera que se envio.
//
// Nada de este modulo lanza: quien llama recibe una lista vacia o `undefined` y
// decide. Un fallo de un tercero no puede tumbar una subida de fotos.

import { sniffMime } from "@webdesign/assets";

import { readCapped } from "./pexels.js";

const ENDPOINT_SEARCH = "https://api.unsplash.com/search/photos";
const TIMEOUT_MS = 15_000;

// Tope por descarga, pedido explicito: por encima de 6 MB no se baja la foto.
// Las fotos de Unsplash a 1600x900 rondan los 300-600 KB, asi que el margen es
// de sobra; el tope existe para que un servidor hostil no llene la memoria.
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

// Host EXACTO del que se aceptan ficheros. Se compara `hostname` entero contra
// el conjunto: nada de comodines ni de `endsWith`, que aceptarian
// `images.unsplash.com.atacante.tld`.
const ALLOWED_FILE_HOSTS = new Set(["images.unsplash.com"]);

// El aviso de descarga no vive en el host de las imagenes sino en la API
// (`https://api.unsplash.com/photos/<id>/download?...`), asi que su lista va
// aparte: mezclarlas dejaria pedir imagenes a la API o avisos al CDN.
const ALLOWED_NOTIFY_HOSTS = new Set(["api.unsplash.com"]);

// Lo unico que `registerAsset` admite como imagen publicable.
const ACCEPTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Foto ya normalizada.
 *
 * `url` es la pagina de la foto (`links.html`) y `downloadLocation` el endpoint
 * de aviso de descarga que Unsplash exige marcar (`links.download_location`).
 * `regularUrl` es la URL del binario (`urls.regular`) tal como llega; la
 * descarga le anade aparte el recorte de 1600x900.
 */
export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  alt: string;
  url: string;
  downloadLocation: string;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
  regularUrl: string;
}

export interface UnsplashSearchOptions {
  orientation: "landscape" | "squarish";
  perPage: number;
}

/**
 * Los DOS recortes que este modulo acepta. No son parametros libres a proposito:
 * el recorte lo decide el codigo (el constructor del banco elige `hero` o
 * `gallery`), nunca quien llama por HTTP. Si la query llegara desde un body,
 * cualquiera podria pedirle a Unsplash una imagen sin recorte o de 8000 px y
 * llenar la memoria del proceso y la cuota de la cuenta.
 *
 * `hero` es el 16:9 de portada; `gallery` el cuadrado de la galeria.
 */
const CROP_QUERIES = {
  hero: "w=1600&h=900&fit=crop&q=80&fm=jpg",
  gallery: "w=1200&h=1200&fit=crop&q=80&fm=jpg",
} as const;

/** Recorte pedido a Unsplash: portada o galeria. */
export type UnsplashCrop = keyof typeof CROP_QUERIES;

const DEFAULT_CROP: UnsplashCrop = "hero";

/** Parametros del binario por defecto: 16:9 a 1600x900, JPEG de calidad 80. */
const DOWNLOAD_QUERY = CROP_QUERIES[DEFAULT_CROP];

/**
 * La query del recorte, o `undefined` si el valor no es uno de los dos.
 *
 * Se valida con `unknown` aunque el tipo ya limite los valores: este modulo lo
 * puede llamar JavaScript compilado sin tipos, y un recorte inventado no debe
 * llegar nunca a la URL.
 */
function cropQuery(value: unknown): string | undefined {
  if (value === "hero" || value === "gallery") return CROP_QUERIES[value];
  return undefined;
}

/** La clave configurada, sin recortar el secreto a nadie mas. */
function apiKey(): string | undefined {
  const key = process.env["UNSPLASH_API_KEY"];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : undefined;
}

export function isUnsplashConfigured(): boolean {
  return apiKey() !== undefined;
}

function clampPerPage(n: number): number {
  const value = Number.isFinite(n) ? Math.trunc(n) : 10;
  return Math.min(30, Math.max(1, value));
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

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// La URL del binario, ya con el recorte. `urls.regular` llega con su propio
// `?ixid=...`, asi que se anade con `&` si ya trae query.
function withDownloadQuery(raw: string): string {
  if (raw === "") return "";
  return raw.includes("?") ? `${raw}&${DOWNLOAD_QUERY}` : `${raw}?${DOWNLOAD_QUERY}`;
}

// Los parametros que describen el recorte. Se quitan antes de poner los nuevos.
const CROP_PARAMS = ["w", "h", "fit", "q", "fm"] as const;

/**
 * La URL del binario con el recorte pedido, y SOLO con ese recorte.
 *
 * `urls.regular` ya viaja con el recorte de portada (lo pone `toPhoto`), asi que
 * anadirle los de galeria dejaria dos juegos de `w`/`h` en la misma URL y
 * Unsplash aplicaria el que le parezca: la foto cuadrada podria llegar 16:9.
 * Se descartan los del recorte anterior y se respeta `ixid`, que es la firma de
 * la peticion, no un parametro de tamano.
 */
function withCrop(raw: string, crop: string): string {
  if (raw === "") return "";
  const mark = raw.indexOf("?");
  if (mark < 0) return `${raw}?${crop}`;
  const params = new URLSearchParams(raw.slice(mark + 1));
  for (const key of CROP_PARAMS) params.delete(key);
  const rest = params.toString();
  const base = rest === "" ? raw.slice(0, mark) : `${raw.slice(0, mark)}?${rest}`;
  return `${base}&${crop}`;
}

function toPhoto(raw: unknown): UnsplashPhoto | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const id = text(r["id"]);
  const urls = obj(r["urls"]);
  const links = obj(r["links"]);
  const user = obj(r["user"]);
  const userLinks = obj(user["links"]);
  const regular = text(urls["regular"]);
  // Sin id ni binario la foto no sirve para nada: se descarta en vez de viajar
  // con campos vacios hasta que falle mas adelante.
  if (id === "" || regular === "") return undefined;
  const pageUrl = text(links["html"]);
  return {
    id,
    width: num(r["width"]),
    height: num(r["height"]),
    alt: text(r["alt_description"]),
    url: pageUrl,
    downloadLocation: text(links["download_location"]),
    photographer: text(user["name"]),
    photographerUrl: text(userLinks["html"]),
    sourceUrl: pageUrl,
    regularUrl: withDownloadQuery(regular),
  };
}

/**
 * Busca fotos. Devuelve `[]` ante cualquier problema: sin clave, error HTTP,
 * timeout, JSON que no es JSON o `results` que no es una lista.
 */
export async function searchUnsplash(
  query: string,
  opts: UnsplashSearchOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<UnsplashPhoto[]> {
  const key = apiKey();
  if (!key) {
    // Sin clave no hay proveedor: se dice y se sigue. Nunca se registra el valor.
    console.warn("unsplash_not_configured", { endpoint: "search" });
    return [];
  }
  const q = query.trim().slice(0, 80);
  if (q === "") return [];

  const params = new URLSearchParams({
    query: q,
    per_page: String(clampPerPage(opts.perPage)),
    orientation: opts.orientation,
  });

  let body: unknown;
  try {
    const res = await fetchImpl(`${ENDPOINT_SEARCH}?${params.toString()}`, {
      method: "GET",
      // `Client-ID <clave>` es el esquema de Unsplash, no un bearer.
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("unsplash_search_failed", { endpoint: "search", error: `http_${res.status}` });
      return [];
    }
    body = await res.json();
  } catch (error) {
    // Timeout, DNS, red caida o cuerpo que no es JSON: mismo trato, lista vacia.
    console.warn("unsplash_search_failed", { endpoint: "search", error: message(error) });
    return [];
  }

  const list = (body as { results?: unknown } | undefined)?.results;
  if (!Array.isArray(list)) return [];
  const out: UnsplashPhoto[] = [];
  for (const raw of list) {
    const photo = toPhoto(raw);
    if (photo) out.push(photo);
  }
  return out;
}

/**
 * URL de fichero aceptable, o `undefined`.
 *
 * Solo https y solo `images.unsplash.com`: la URL viene de un tercero, asi que
 * se valida aqui y no se confia en ella para nada mas.
 */
function safeUrl(raw: string, hosts: Set<string>): URL | undefined {
  if (raw === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (!hosts.has(parsed.hostname)) return undefined;
  return parsed;
}

/**
 * Baja el binario de la foto y comprueba que es una imagen de las aceptadas.
 *
 * El tipo se decide por los primeros bytes, no por `content-type`: la cabecera
 * de un tercero se falsifica.
 *
 * `crop` decide el recorte del fichero: `hero` (1600x900) o `gallery`
 * (1200x1200). Por defecto portada, que es lo que pedia el codigo antes de que
 * el banco necesitara cuadradas; las llamadas existentes no cambian.
 */
export async function downloadUnsplash(
  photo: UnsplashPhoto,
  fetchImpl: typeof fetch = fetch,
  crop: UnsplashCrop = DEFAULT_CROP,
): Promise<{ content: Buffer; mime: string } | undefined> {
  const query = cropQuery(crop);
  if (query === undefined) {
    // Recorte que no esta en la lista: no se pide nada. Es un fallo de codigo,
    // no de Unsplash, pero se trata igual que un fallo de descarga.
    console.warn("unsplash_download_failed", { error: "invalid_crop" });
    return undefined;
  }
  const raw = photo && typeof photo.regularUrl === "string" ? photo.regularUrl : "";
  const target = safeUrl(withCrop(raw, query), ALLOWED_FILE_HOSTS);
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
    console.warn("unsplash_download_failed", { error: message(error) });
    return undefined;
  }
  if (!res.ok) {
    console.warn("unsplash_download_failed", { error: `http_${res.status}` });
    return undefined;
  }

  // La cabecera se mira antes de leer: si ya se declara mas grande, no se baja.
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
    console.warn("unsplash_download_failed", { error: "too_large" });
    return undefined;
  }

  // Mismo tope aplicado al leer, para cuando no hay `content-length` fiable.
  const content = await readCapped(res, MAX_PHOTO_BYTES, "unsplash_download_failed");
  if (!content) return undefined;

  // El tipo real manda: cabecera y extension se falsifican.
  const mime = sniffMime(content.subarray(0, 16));
  if (!mime || !ACCEPTED_IMAGE_MIME.has(mime)) return undefined;
  return { content, mime };
}

/**
 * Avisa a Unsplash de que la foto se ha usado (`download_location`).
 *
 * Es una cortesia con el fotografo y una condicion de su API, no un requisito
 * para publicar: si falla, se registra y se sigue. Nunca lanza.
 */
export async function notifyUnsplashDownload(
  photo: UnsplashPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = apiKey();
  if (!key) return;
  const target = safeUrl(photo && typeof photo.downloadLocation === "string" ? photo.downloadLocation : "", ALLOWED_NOTIFY_HOSTS);
  if (!target) return;
  try {
    const res = await fetchImpl(target, {
      method: "GET",
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("unsplash_notify_failed", { error: `http_${res.status}` });
    }
  } catch (error) {
    // Cortesia, no requisito: un fallo aqui no cambia el resultado de la subida.
    console.warn("unsplash_notify_failed", { error: message(error) });
  }
}
