// Banco local de fotos libres (Lorem Picsum / Unsplash License).
//
// Sustituye a Pexels cuando la clave no está configurada o cuando la búsqueda
// devuelve cero candidatos. El resto del flujo (registerAsset, appendFuente,
// dedupe por sitio) no cambia: este módulo solo provee candidatos y contenido.
//
// POR QUÉ EXISTE: Pexels suspendió la clave (401). Las fotos viven en
// deploy/photo-bank/ y llegan a /app/deploy/photo-bank en la imagen Docker.
// En desarrollo se resuelve desde cwd(); en producción desde /app.
//
// NO SE LLAMA NUNCA DIRECTAMENTE DESDE SERVER.TS. Solo internal-photos.ts lo usa.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface BankPhoto {
  id: number;
  file: string;
  orientation: "landscape" | "square";
  width: number;
  height: number;
  alt: string;
  author: string;
}

interface Manifest {
  license: string;
  source: string;
  photos: BankPhoto[];
}

/**
 * Raíz del banco de fotos. Sigue el mismo patrón que `libraryRoot()` en
 * library.ts: variable de entorno primero; si no, ruta relativa a cwd() cuando
 * no es producción, y /app/deploy/photo-bank en producción.
 */
export function bankRoot(): string {
  const fromEnv = process.env["PHOTO_BANK_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  return process.env["NODE_ENV"] === "production"
    ? "/app/deploy/photo-bank"
    : join(process.cwd(), "deploy", "photo-bank");
}

// Caché en memoria: se lee el manifiesto una sola vez. `null` significa que ya
// se intentó y falló (no se reintenta en cada petición).
let _cache: BankPhoto[] | null | undefined = undefined;

function manifestPath(): string {
  return join(bankRoot(), "manifest.json");
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
    _cache = data.photos.filter(isValidBankPhoto);
    return _cache;
  } catch {
    // Manifiesto ausente o roto: devuelve vacío y no lanza.
    _cache = null;
    return [];
  }
}

function isValidBankPhoto(p: unknown): p is BankPhoto {
  if (!p || typeof p !== "object") return false;
  const b = p as Record<string, unknown>;
  return (
    typeof b["id"] === "number" &&
    typeof b["file"] === "string" &&
    (b["orientation"] === "landscape" || b["orientation"] === "square") &&
    typeof b["width"] === "number" &&
    typeof b["height"] === "number" &&
    typeof b["alt"] === "string" &&
    typeof b["author"] === "string"
  );
}

/**
 * Fotos del banco filtradas por orientación. Si el manifiesto falta o está roto
 * devuelve [] y no lanza.
 */
export async function listBankPhotos(orientation: "landscape" | "square"): Promise<BankPhoto[]> {
  const all = await loadManifest();
  return all.filter((p) => p.orientation === orientation);
}

/**
 * Lee el archivo de una foto del banco y detecta su MIME por los primeros bytes.
 * Mismo enfoque que `sniffMime` de pexels.ts: los primeros bytes mandan.
 * Devuelve `undefined` si el archivo no existe, está vacío o no es imagen.
 */
export async function readBankPhoto(
  photo: BankPhoto,
): Promise<{ content: Buffer; mime: string } | undefined> {
  // Nombre de archivo sin slashes: protección básica de path traversal.
  if (!photo.file || photo.file.includes("/") || photo.file.includes("..")) return undefined;
  const path = join(bankRoot(), photo.file);
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
