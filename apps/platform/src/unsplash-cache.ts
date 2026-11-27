// Caché en disco de las fotos de Unsplash.
//
// POR QUÉ EXISTE: la cuota de Unsplash se gasta por petición de búsqueda y por
// foto bajada. Sin caché, dos sitios que piden la misma foto la bajan dos veces.
// Aquí se baja UNA vez: `<MEDIA_LIBRARY_ROOT>/unsplash-cache/<id>/<id>.<ext>` con
// sus datos en `.../unsplash-cache/<id>/meta.json`.
//
// NO ES UN ALMACÉN DE SITIOS. Igual que la biblioteca de Pexels (library.ts),
// vive fuera de `SITES_ROOT`, es común a todos los sitios y NO se sirve nunca
// por HTTP: no hay ruta en server.ts que lea esta carpeta. Cada sitio guarda su
// COPIA propia como asset, así que borrar esta caché deja los sitios publicados
// intactos: solo se pierde la caché y se vuelve a bajar.
//
// La carpeta se llama `unsplash-cache` y no `unsplash` para no confundirse con
// el banco local de fotos (`deploy/photo-bank/unsplash/`), que es otra cosa: un
// conjunto de fotos ya elegidas y verificadas, no una caché de lo buscado.
//
// Aquí NO se habla con la red: entra y sale contenido ya descargado. Quien
// busca y descarga es unsplash.ts, y quien decide es internal-photos.ts.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionFor, sniffMime, type AssetKind } from "@webdesign/assets";
import { libraryRoot } from "./library.js";
import { MAX_PHOTO_BYTES, type UnsplashPhoto } from "./unsplash.js";

/** La licencia tal como la publica Unsplash, y como queda en `registerAsset`. */
export const UNSPLASH_LICENSE = "Unsplash License";

/**
 * Un id de Unsplash es una cadena corta (`v-KZt2CRU6Y`), no un número.
 *
 * Se valida con una lista blanca antes de tocar una ruta: sin esto, un id con
 * `/` o `..` saldría de la caché y escribiría donde no debe.
 */
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ¿Sirve este id para nombrar una carpeta? Se comprueba ANTES de crear el
 * candidato: un id con `/` o `..` no es un error que deba tumbar la petición,
 * es una foto que se descarta.
 */
export function isSafeUnsplashId(id: unknown): id is string {
  return typeof id === "string" && ID_OK.test(id);
}

function assertId(id: string): string {
  if (!isSafeUnsplashId(id)) throw new Error("invalid unsplash id");
  return id;
}

/** Lo que se guarda en `meta.json`. Mismos datos que la biblioteca de Pexels. */
export interface UnsplashCacheMeta {
  id: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
  downloadLocation: string;
  mime: string;
  query: string;
  savedAt: string;
  /**
   * Cuándo se avisó a Unsplash de que esta foto se usó (ISO), si se avisó.
   *
   * OPCIONAL Y COMPATIBLE: las entradas antiguas no lo tienen, y eso significa
   * "no avisada". Existe porque el aviso también gasta cuota: sin este dato, la
   * misma foto se anunciaría otra vez en cada ejecución que la reutiliza.
   */
  notifiedAt?: string;
}

/** Raíz de la caché: comparte `MEDIA_LIBRARY_ROOT` con la biblioteca de Pexels. */
export function unsplashCacheRoot(root: string = libraryRoot()): string {
  return join(root, "unsplash-cache");
}

function entryDir(id: string, root: string = libraryRoot()): string {
  return join(unsplashCacheRoot(root), assertId(id));
}

function metaPath(id: string, root: string = libraryRoot()): string {
  return join(entryDir(id, root), "meta.json");
}

/** El fichero se nombra con la extensión que corresponde al MIME REAL. */
function fileName(id: string, mime: string): string {
  return `${assertId(id)}.${extensionFor("image" as AssetKind, mime)}`;
}

/**
 * Lo único que esta caché puede contener: lo mismo que `registerAsset` admite
 * como imagen publicable. Un `mime` fuera de aquí no se usa ni para el nombre.
 */
const ACCEPTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function mimeOk(value: unknown): value is string {
  return typeof value === "string" && ACCEPTED_IMAGE_MIME.has(value);
}

/**
 * Entrada de la caché, o `undefined` si no es utilizable.
 *
 * `undefined` si falta `meta.json`, si falta el fichero, si el fichero está
 * VACÍO, si pasa del tope de tamaño y si sus primeros bytes no son del tipo que
 * dice `meta.json` (fichero truncado, sustituido o de otro tipo). En esos casos
 * la entrada se BORRA para no repetir la lectura y se vuelve a bajar la próxima
 * vez.
 */
export async function readFromUnsplashCache(id: string): Promise<{ meta: UnsplashCacheMeta; content: Buffer } | undefined> {
  if (!isSafeUnsplashId(id)) return undefined;
  const root = libraryRoot();
  let meta: UnsplashCacheMeta;
  try {
    meta = JSON.parse(await readFile(metaPath(id, root), "utf8")) as UnsplashCacheMeta;
  } catch {
    return undefined;
  }
  // `mime` decide el nombre del fichero: si no es una imagen de las aceptadas,
  // el meta no sirve para nada y no se construye una ruta con él.
  if (!meta || !mimeOk(meta.mime)) {
    await discard(id, root);
    return undefined;
  }
  const file = join(entryDir(id, root), fileName(id, meta.mime));
  // Tope de tamaño ANTES de leer, con la MISMA constante que la descarga.
  //
  // POR QUÉ: la descarga de red ya está capada a `MAX_PHOTO_BYTES`, pero este
  // fichero vive en el volumen de datos y lo puede sustituir cualquiera que
  // escriba ahí (o un guardado anterior a medias). `readFile` sin tope se traga
  // lo que haya en disco, y `bank-builder` copia el contenido tal cual al banco:
  // un fichero de gigabytes agotaba la memoria del panel. Con `stat` primero, el
  // fichero grande se descarta sin reservar su tamaño, y se repite el número de
  // `unsplash.ts` en vez de inventar otro: dos topes distintos dejarían pasar
  // por la caché lo que la red no deja bajar.
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    // meta sin fichero: entrada inservible, se retira para no repetir la lectura.
    await discard(id, root);
    return undefined;
  }
  if (size > MAX_PHOTO_BYTES) {
    console.warn("unsplash_cache_too_large", { id, size });
    await discard(id, root);
    return undefined;
  }
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch {
    await discard(id, root);
    return undefined;
  }
  // Vacío o con una cabecera que no es la que se guardó: fichero truncado o
  // cambiado a mano. No se sirve nunca.
  const sniffed = content.byteLength > 0 ? sniffMime(content.subarray(0, 16)) : undefined;
  if (sniffed !== meta.mime) {
    console.warn("unsplash_cache_corrupt", { id });
    await discard(id, root);
    return undefined;
  }
  return { meta, content };
}

async function discard(id: string, root: string): Promise<void> {
  try {
    await rm(entryDir(id, root), { recursive: true, force: true });
  } catch {
    // Si no se puede borrar, la próxima lectura fallará igual: quien llama solo
    // necesita saber que no hay entrada válida.
  }
}

/**
 * Guarda una foto en la caché y devuelve su meta.
 *
 * Si ya existe `meta.json` solo se actualiza `savedAt`/`query`: el binario bueno
 * no se toca. Escritura atómica (`.tmp` + `rename`) para que un fallo a medias
 * no deje una entrada corrupta ni el binario truncado.
 */
export async function saveToUnsplashCache(entry: {
  photo: UnsplashPhoto;
  content: Buffer;
  mime: string;
  query: string;
}): Promise<UnsplashCacheMeta> {
  const root = libraryRoot();
  const { photo, content, mime, query } = entry;
  const id = assertId(photo.id);
  const dir = entryDir(id, root);
  const file = fileName(id, mime);
  const now = new Date().toISOString();

  // Si la entrada ya estaba y tenía aviso, se conserva: reescribir el meta por
  // una segunda descarga no puede hacer que la foto vuelva a anunciarse.
  const previo = await readNotifiedAt(dir);
  const meta: UnsplashCacheMeta = {
    id,
    alt: photo.alt,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl ?? "",
    sourceUrl: photo.sourceUrl,
    downloadLocation: photo.downloadLocation,
    mime,
    query,
    savedAt: now,
    ...(previo === undefined ? {} : { notifiedAt: previo }),
  };

  await mkdir(dir, { recursive: true });
  const abs = join(dir, file);
  const tmpFile = `${abs}.tmp`;
  await writeFile(tmpFile, content);
  await rename(tmpFile, abs);
  const tmpMeta = join(dir, "meta.json.tmp");
  await writeFile(tmpMeta, JSON.stringify(meta, null, 2), "utf8");
  await rename(tmpMeta, join(dir, "meta.json"));
  return meta;
}

/** `notifiedAt` del meta que ya hay, si lo hay. Nunca lanza. */
async function readNotifiedAt(dir: string): Promise<string | undefined> {
  try {
    const previo = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as { notifiedAt?: unknown };
    return typeof previo.notifiedAt === "string" && previo.notifiedAt !== "" ? previo.notifiedAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Anota que la foto ya se anunció a Unsplash, para no volver a gastar cuota.
 *
 * Escritura atómica (`.tmp` + `rename`) como el resto del fichero: un meta a
 * medias es una entrada que `readFromUnsplashCache` tiraría, y con ella la foto
 * cacheada. Si el meta no existe, no se inventa: sin entrada no hay nada que
 * marcar y la próxima descarga volverá a avisar, que es lo correcto.
 */
export async function markUnsplashNotified(id: string): Promise<void> {
  const root = libraryRoot();
  const dir = entryDir(id, root);
  const meta = JSON.parse(await readFile(metaPath(id, root), "utf8")) as UnsplashCacheMeta;
  if (!meta || typeof meta !== "object") return;
  const siguiente: UnsplashCacheMeta = { ...meta, notifiedAt: new Date().toISOString() };
  const tmp = join(dir, "meta.json.tmp");
  await writeFile(tmp, JSON.stringify(siguiente, null, 2), "utf8");
  await rename(tmp, join(dir, "meta.json"));
}
