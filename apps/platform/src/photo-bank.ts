// Banco local de fotos libres (Unsplash License).
//
// Sustituye a Pexels cuando la clave no está configurada o cuando la búsqueda
// devuelve cero candidatos. El resto del flujo (registerAsset, appendFuente,
// dedupe por sitio) no cambia: este módulo solo provee candidatos y contenido.
//
// POR QUÉ EXISTE: Pexels suspendió la clave (401). Las fotos viven en
// deploy/photo-bank/unsplash/ y llegan a /app/deploy/photo-bank en la imagen
// Docker.
//
// T-020: el banco está organizado por SECTOR (`unsplash/<sector>/hero-01.jpg`), y
// una foto es de un sector por construcción. `listBankPhotos` recibe el sector y
// devuelve las de ESE sector; si ese sector no tiene ninguna de la orientación
// pedida, devuelve las de `neutro`, que es el único que no promete nada sobre el
// negocio. El manifiesto de la raíz (`deploy/photo-bank/manifest.json`) ya no se
// lee: está vacío a propósito y se queda donde está.
//
// NO SE LLAMA NUNCA DIRECTAMENTE DESDE SERVER.TS. Solo internal-photos.ts lo usa.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { libraryRoot } from "./library.js";

/** Sectores del banco: son los directorios de `deploy/photo-bank/unsplash/`. */
export type Sector = "despacho" | "hosteleria" | "comercio" | "salud" | "taller" | "belleza" | "neutro";

/** Lista cerrada de sectores, para validar lo que llega por la API interna. */
export const SECTORS: readonly Sector[] = [
  "despacho",
  "hosteleria",
  "comercio",
  "salud",
  "taller",
  "belleza",
  "neutro",
];

/** Sector al que caen los sectores sin fotos de la orientación pedida. */
const FALLBACK_SECTOR: Sector = "neutro";

/** Orientación tal como la pide el resto del sistema (Pexels usa `square`). */
export type BankOrientation = "landscape" | "square";

export interface BankPhoto {
  /** Id de Unsplash: cadena, no número (el de Pexels sí es número). */
  id: string;
  /** Ruta relativa al banco, con sector: "salud/hero-01.jpg". */
  file: string;
  sector: Sector;
  orientation: BankOrientation;
  width: number;
  height: number;
  alt: string;
  /** Nombre del fotógrafo: en el manifiesto es `photographer.name`. */
  author: string;
  /** Licencia de la foto, tal como consta en el manifiesto. */
  license: string;
  /** Página de la foto: es el `source_url` del activo registrado. */
  sourceUrl: string;
}

/** ¿Es un sector de la lista cerrada? Lo que no lo sea vale `neutro`. */
export function isSector(value: unknown): value is Sector {
  return typeof value === "string" && (SECTORS as readonly string[]).includes(value);
}

interface ManifestPhoto {
  id?: unknown;
  file?: unknown;
  sector?: unknown;
  orientation?: unknown;
  width?: unknown;
  height?: unknown;
  alt?: unknown;
  photographer?: { name?: unknown };
  photoPageUrl?: unknown;
}

interface Manifest {
  license?: unknown;
  photos?: unknown;
}

/**
 * Raíz del banco de fotos.
 *
 * `PHOTO_BANK_ROOT` manda si está. Si no, en produccion el banco vive junto a la
 * cache de medios (`libraryRoot()`), en `<raiz>/unsplash`, para poder actualizar
 * las fotos descomprimiendo un zip sin reconstruir la imagen. En desarrollo se
 * lee del repo.
 */
export function bankRoot(): string {
  const fromEnv = process.env["PHOTO_BANK_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  if (process.env["NODE_ENV"] === "production") return libraryRoot();
  return join(process.cwd(), "deploy", "photo-bank");
}

/** Carpeta del banco de Unsplash, que es donde vive el manifiesto que se lee. */
function unsplashRoot(): string {
  return join(bankRoot(), "unsplash");
}

// Caché en memoria: se lee el manifiesto una sola vez. `null` significa que ya
// se intentó y falló (no se reintenta en cada petición).
let _cache: BankPhoto[] | null | undefined = undefined;

function manifestPath(): string {
  return join(unsplashRoot(), "manifest.json");
}

async function loadManifest(): Promise<BankPhoto[]> {
  if (_cache !== undefined) return _cache ?? [];
  try {
    const raw = await readFile(manifestPath(), "utf8");
    const data = JSON.parse(raw) as Manifest;
    if (!Array.isArray(data.photos)) {
      _cache = null;
      return [];
    }
    const license = typeof data.license === "string" ? data.license : "Unsplash License";
    _cache = data.photos
      .map((p) => toBankPhoto(p, license))
      .filter((p): p is BankPhoto => p !== undefined);
    return _cache;
  } catch {
    // Manifiesto ausente o roto: devuelve vacío y no lanza.
    _cache = null;
    return [];
  }
}

/**
 * Convierte una entrada del manifiesto al tipo del módulo. Devuelve `undefined`
 * si le falta algo imprescindible: una entrada rota se salta, no rompe el resto.
 *
 * `orientation` en el manifiesto es `landscape` o `squarish` (así llama Unsplash
 * a lo que aquí es `square`); el resto del sistema solo conoce `square`.
 */
function toBankPhoto(entry: unknown, license: string): BankPhoto | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const p = entry as ManifestPhoto;
  if (typeof p.id !== "string" || typeof p.file !== "string") return undefined;
  if (typeof p.width !== "number" || typeof p.height !== "number") return undefined;
  if (typeof p.alt !== "string") return undefined;
  if (!isSector(p.sector)) return undefined;

  const orientation = p.orientation === "landscape" ? "landscape" : p.orientation === "squarish" || p.orientation === "square" ? "square" : undefined;
  if (orientation === undefined) return undefined;

  const name = p.photographer && typeof p.photographer.name === "string" ? p.photographer.name : undefined;
  if (name === undefined) return undefined;

  // La página de la foto es obligatoria: sin ella no hay atribución verificable.
  if (typeof p.photoPageUrl !== "string" || p.photoPageUrl === "") return undefined;

  return {
    id: p.id,
    file: p.file,
    sector: p.sector,
    orientation,
    width: p.width,
    height: p.height,
    alt: p.alt,
    author: name,
    license,
    sourceUrl: p.photoPageUrl,
  };
}

/**
 * Clave de orden de una foto para una semilla dada.
 *
 * T-032a: dos sitios del mismo sector recibían siempre las mismas fotos, en el
 * orden del manifiesto, así que el dueño cambiaba el diseño y volvía a salir la
 * misma imagen. El orden pasa a depender de `siteId`: el hash sha256 de
 * `semilla + id` ordena las candidatas de forma DISTINTA por sitio y ESTABLE
 * para el mismo sitio (mismo hash, mismo orden, siempre).
 *
 * El separador NUL evita la colisión trivial ("ab" + "c" = "a" + "bc"): los ids
 * de Unsplash no llevan NUL, así que el par (semilla, id) es unívoco.
 */
function seedKey(seed: string, id: string): string {
  return createHash("sha256").update(`${seed}\u0000${id}`).digest("hex");
}

/**
 * Reordena por hash de `seed + id`. `sort` es estable en V8, así que un empate
 * de hash (imposible en la práctica) mantiene el orden del manifiesto y el
 * resultado sigue siendo determinista. No pierde ni duplica fotos: es un sort.
 */
function orderBySeed(photos: BankPhoto[], seed: string): BankPhoto[] {
  const keyed = photos.map((photo) => ({ photo, key: seedKey(seed, photo.id) }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map((entry) => entry.photo);
}

/**
 * Fotos del banco.
 *
 * - Con `sector`: las de ese sector en esa orientación.
 * - Si ese sector no tiene NINGUNA de esa orientación: las de `neutro`.
 * - Sin `sector`: todas las de esa orientación, de todos los sectores.
 *
 * - Con `seed` (el `siteId`): el resultado se reordena por hash de
 *   `seed + id`, para que dos sitios del mismo sector no reciban las mismas
 *   fotos en el mismo orden. El orden se aplica DESPUÉS de filtrar por sector y
 *   orientación, y también sobre la caída a `neutro`.
 * - Sin `seed`: orden del manifiesto, como antes de T-032a.
 *
 * Si el manifiesto falta o está roto devuelve [] y no lanza.
 */
export async function listBankPhotos(
  orientation: BankOrientation,
  sector?: Sector,
  seed?: string,
): Promise<BankPhoto[]> {
  const all = await loadManifest();
  const ofOrientation = all.filter((p) => p.orientation === orientation);
  // Un sector que no está en la lista cerrada se trata como `neutro`: la ruta
  // interna ya lo valida, esto es la segunda barrera.
  const wanted = sector === undefined ? undefined : isSector(sector) ? sector : FALLBACK_SECTOR;

  const pick = (photos: BankPhoto[]): BankPhoto[] =>
    seed === undefined || seed === "" ? photos : orderBySeed(photos, seed);

  if (wanted === undefined) return pick(ofOrientation);
  const own = ofOrientation.filter((p) => p.sector === wanted);
  if (own.length > 0) return pick(own);
  return pick(ofOrientation.filter((p) => p.sector === FALLBACK_SECTOR));
}

/**
 * Lee el archivo de una foto del banco y detecta su MIME por los primeros bytes.
 * Mismo enfoque que `sniffMime` de pexels.ts: los primeros bytes mandan.
 * Devuelve `undefined` si el archivo no existe, está vacío o no es imagen.
 */
export async function readBankPhoto(
  photo: BankPhoto,
): Promise<{ content: Buffer; mime: string } | undefined> {
  // La ruta del manifiesto lleva el sector ("salud/hero-01.jpg"), así que ahora
  // hay un solo separador permitido. Se rechaza lo que intente salir de la
  // carpeta del banco: "..", rutas absolutas y cualquier resolución que acabe
  // fuera de `unsplash/`.
  if (typeof photo.file !== "string" || photo.file === "") return undefined;
  if (photo.file.includes("..") || photo.file.startsWith("/") || photo.file.includes("\\")) return undefined;
  const root = unsplashRoot();
  const path = join(root, photo.file);
  if (!path.startsWith(root + sep)) return undefined;
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch {
    return undefined;
  }
  if (content.byteLength < 4) return undefined;
  const mime = sniffBankMime(content);
  if (!mime) return undefined;
  return { content, mime };
}

/**
 * Detecta MIME por magic bytes. Solo los tres tipos que registerAsset admite
 * como imagen publicable, igual que ACCEPTED_IMAGE_MIME de pexels.ts.
 */
function sniffBankMime(buf: Buffer): string | undefined {
  if (buf.length < 4) return undefined;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return undefined;
}

/** Limpia la caché en memoria (usado en tests para aislar casos). */
export function _resetBankCache(): void {
  _cache = undefined;
}
