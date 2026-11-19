// Biblioteca local de imagenes del banco de Pexels (pedido del dueno).
//
// POR QUE EXISTE: sin ella, la misma foto se bajaba otra vez cada vez que un
// sitio la pedia, y cada bajada cuenta contra el limite de Pexels. Aqui se baja
// UNA vez: `<MEDIA_LIBRARY_ROOT>/pexels/<id>/<id>.<ext>`, con sus datos en
// `<MEDIA_LIBRARY_ROOT>/pexels/<id>/meta.json`. La carpeta se llama `pexels`
// justamente para que se vea de donde salio cada fichero.
//
// NO ES UN ALMACEN DE SITIOS. Vive fuera de `SITES_ROOT`, es comun a todos los
// sitios y NO se sirve NUNCA por HTTP: no hay ruta en server.ts que la lea (lo
// unico que sirve ficheros es `/assets/<siteId>/<kind>/<fichero>`, y su regex
// solo admite `[a-zA-Z0-9._-]`, sin `/` ni `..`, bajo `sitesRoot`). Cada sitio
// guarda ademas su COPIA propia como asset, asi que borrar esta biblioteca deja
// los sitios publicados intactos: solo se pierde la cache.
//
// El README.md de la biblioteca conserva autor, enlace y licencia de cada foto.
// La Pexels License no exige credito visible y la web no los muestra (decision
// del dueno), pero la trazabilidad no se pierde: esta aqui y en FUENTES.md.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionFor, type AssetKind } from "@webdesign/assets";
import type { PexelsPhoto } from "./pexels.js";

const LICENSE = "Pexels License";
const LICENSE_URL = "https://www.pexels.com/license/";

export interface PexelsMeta {
  id: number;
  kind: "photo" | "video";
  file: string;
  mime: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
  license: "Pexels License";
  licenseUrl: string;
  query: string;
  firstSeenAt: string;
  lastUsedAt: string;
  sites: string[];
}

/**
 * Raiz de la biblioteca. En produccion `/data/biblioteca`; en desarrollo
 * `.data/biblioteca` para no escribir en `/data` sin privilegios.
 */
export function libraryRoot(): string {
  const fromEnv = process.env["MEDIA_LIBRARY_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
  return process.env["NODE_ENV"] === "production" ? "/data/biblioteca" : ".data/biblioteca";
}

/** Directorio de la carpeta `pexels` de la biblioteca. */
function pexelsDir(root: string = libraryRoot()): string {
  return join(root, "pexels");
}

/** El id de Pexels es un entero positivo: se valida antes de tocar una ruta. */
function assertId(id: number): number {
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid pexels id");
  return id;
}

function entryDir(id: number, root: string = libraryRoot()): string {
  return join(pexelsDir(root), String(assertId(id)));
}

function metaPath(id: number, root: string = libraryRoot()): string {
  return join(entryDir(id, root), "meta.json");
}

function extFor(mime: string): string {
  return extensionFor("image" as AssetKind, mime);
}

function cell(value: string): string {
  const clean = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return clean === "" ? "—" : clean.replace(/\|/g, "\\|");
}

/**
 * README de la biblioteca. Funcion pura: recibe las entradas y devuelve el texto,
 * para poder probarla sin disco.
 */
export function libraryReadme(entries: PexelsMeta[]): string {
  const header = "| Id | Autor | Enlace | Licencia | Primera descarga | Sitios |\n| --- | --- | --- | --- | --- | --- |";
  const rows = entries
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((e) => `| ${cell(String(e.id))} | ${cell(e.photographer)} | ${cell(e.sourceUrl)} | ${cell(e.license)} | ${cell(e.firstSeenAt.slice(0, 10))} | ${cell(e.sites.join(", "))} |`);
  return [
    "# Biblioteca de imágenes de Pexels",
    "",
    "Caché compartida entre sitios: cada foto se descarga una sola vez y se",
    "reutiliza. Autor, enlace y licencia se conservan aquí porque la",
    "**Pexels License** no exige crédito visible y esta web no muestra créditos",
    "de imagen por decisión del dueño; la trazabilidad queda en este archivo y en",
    "el `FUENTES.md` de cada sitio.",
    "",
    `Licencia: ${LICENSE} — ${LICENSE_URL}`,
    "",
    header,
    ...rows,
    "",
  ].join("\n");
}

/** Todos los meta.json legibles de la biblioteca. Los ilegibles se ignoran. */
async function readAllMeta(root: string = libraryRoot()): Promise<PexelsMeta[]> {
  let dirs: string[];
  try {
    dirs = await readdir(pexelsDir(root));
  } catch {
    return [];
  }
  const out: PexelsMeta[] = [];
  for (const name of dirs) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const raw = await readFile(join(pexelsDir(root), name, "meta.json"), "utf8");
      out.push(JSON.parse(raw) as PexelsMeta);
    } catch {
      // Entrada sin meta: no cuenta, y `readFromLibrary` la tratara como ausente.
    }
  }
  return out;
}

// Marca con el numero de entradas: asi el README se reescribe solo cuando
// CAMBIA la cantidad, no en cada foto (pedido del dueno: escritura perezosa).
const README_MARK = /<!-- entradas: ([0-9]+) -->/;

/** Reescribe el README de la biblioteca solo si cambio el numero de entradas. */
async function refreshReadme(root: string = libraryRoot()): Promise<void> {
  const entries = await readAllMeta(root);
  const path = join(pexelsDir(root), "README.md");
  try {
    const current = await readFile(path, "utf8");
    const mark = README_MARK.exec(current);
    if (mark && Number(mark[1]) === entries.length) return;
  } catch {
    // Sin README todavia: se escribe.
  }
  const body = `${libraryReadme(entries)}<!-- entradas: ${entries.length} -->\n`;
  const tmp = `${path}.tmp`;
  try {
    await mkdir(pexelsDir(root), { recursive: true });
    await writeFile(tmp, body, "utf8");
    await rename(tmp, path);
  } catch {
    // Un README que no se escribe no puede tumbar una subida de fotos.
  }
}

/**
 * Entrada de la biblioteca, o `undefined` si no esta utilizable.
 *
 * Devuelve `undefined` cuando falta `meta.json`, cuando falta el fichero y
 * cuando el tamano del fichero no cuadra con el que se guardo: en ese ultimo
 * caso la entrada se BORRA (fichero truncado o cambiado no se sirve nunca) y se
 * vuelve a bajar la proxima vez.
 */
export async function readFromLibrary(id: number): Promise<{ meta: PexelsMeta; content: Buffer } | undefined> {
  const root = libraryRoot();
  let meta: PexelsMeta;
  try {
    meta = JSON.parse(await readFile(metaPath(id, root), "utf8")) as PexelsMeta;
  } catch {
    return undefined;
  }
  if (!meta || typeof meta.file !== "string" || meta.file.includes("/") || meta.file.includes("..")) {
    await discard(id, root);
    return undefined;
  }
  let content: Buffer;
  try {
    content = await readFile(join(entryDir(id, root), meta.file));
  } catch {
    // meta sin fichero: entrada inservible, se retira para no repetir la lectura.
    await discard(id, root);
    return undefined;
  }
  const expected = Number((meta as { bytes?: unknown }).bytes);
  // `bytes` no esta en la interfaz publica (es interno), pero si quedo escrito:
  // un tamano distinto es un fichero truncado o sustituido.
  if (Number.isFinite(expected) && expected > 0 && content.byteLength !== expected) {
    console.warn("pexels_library_corrupt", { id });
    await discard(id, root);
    return undefined;
  }
  return { meta, content };
}

async function discard(id: number, root: string): Promise<void> {
  try {
    await rm(entryDir(id, root), { recursive: true, force: true });
    await refreshReadme(root);
  } catch {
    // Si no se puede borrar, la proxima lectura volvera a fallar igual: no se
    // propaga, porque quien llama solo necesita saber que no hay entrada valida.
  }
}

/**
 * Guarda una foto en la biblioteca y devuelve su meta.
 *
 * Si ya existe `meta.json` NO se reescribe el fichero (la imagen buena no se
 * toca): solo se actualizan `lastUsedAt` y la lista de sitios. Asi dos sitios que
 * piden la misma foto se reparten una sola copia.
 */
export async function saveToLibrary(entry: {
  photo: PexelsPhoto;
  content: Buffer;
  mime: string;
  query: string;
  siteId: string;
}): Promise<PexelsMeta> {
  const root = libraryRoot();
  const { photo, content, mime, query, siteId } = entry;
  const id = assertId(photo.id);
  const dir = entryDir(id, root);
  const now = new Date().toISOString();
  const file = `${id}.${extFor(mime)}`;

  let existing: (PexelsMeta & { bytes?: number }) | undefined;
  try {
    existing = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as PexelsMeta & { bytes?: number };
  } catch {
    existing = undefined;
  }

  if (existing && typeof existing.file === "string") {
    const meta: PexelsMeta = {
      ...existing,
      lastUsedAt: now,
      sites: existing.sites.includes(siteId) ? existing.sites : [...existing.sites, siteId],
    };
    const path = join(dir, "meta.json");
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
    await rename(tmp, path);
    return meta;
  }

  const meta: PexelsMeta & { bytes: number } = {
    id,
    kind: "photo",
    file,
    mime,
    width: photo.width,
    height: photo.height,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl ?? "",
    sourceUrl: photo.url,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    query,
    firstSeenAt: now,
    lastUsedAt: now,
    sites: [siteId],
    bytes: content.byteLength,
  };
  await mkdir(dir, { recursive: true });
  const abs = join(dir, file);
  const tmpFile = `${abs}.tmp`;
  await writeFile(tmpFile, content);
  await rename(tmpFile, abs);
  const tmpMeta = join(dir, "meta.json.tmp");
  await writeFile(tmpMeta, JSON.stringify(meta, null, 2), "utf8");
  await rename(tmpMeta, join(dir, "meta.json"));
  await refreshReadme(root);
  return meta;
}

/** Cuantas fotos hay en la biblioteca y cuanto ocupan (solo los ficheros). */
export async function libraryStats(): Promise<{ photos: number; bytes: number }> {
  const root = libraryRoot();
  const entries = await readAllMeta(root);
  let bytes = 0;
  for (const meta of entries) {
    try {
      bytes += (await stat(join(pexelsDir(root), String(meta.id), meta.file))).size;
    } catch {
      // Entrada incompleta: no suma, que es lo honesto.
    }
  }
  return { photos: entries.length, bytes };
}
