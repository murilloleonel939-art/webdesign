// Constructor del banco local de fotos de Unsplash (T-034).
//
// POR QUÉ CORRE AQUÍ Y NO EN EL WORKER: el banco vive en el volumen escribible
// de la plataforma (`/data/biblioteca` en producción) y la clave de Unsplash
// solo existe en su contenedor. Un job del worker llenaría un directorio que
// nadie lee y no tendría con qué autenticarse.
//
// POR QUÉ DE UNO EN UNO Y EN MEMORIA: el volumen y el manifiesto son únicos. Dos
// ejecuciones a la vez se pisarían el manifiesto y podrían duplicar fotos, así
// que hay un solo estado activo y la ruta responde 409 mientras dura. El estado
// se pierde al reiniciar el proceso: se puede relanzar y no borra nada.
//
// QUÉ NO HACE: no borra. Ni ficheros ni entradas del manifiesto. El banco solo
// crece; si una foto no se puede bajar, se cuenta y se sigue con la siguiente.
// Tampoco inventa: lo que no puede confirmar (autor, licencia, URL de la ficha)
// no se escribe, y el alt sale de `altFor`, que solo afirma lo que el alt inglés
// dice.
//
// EL ALT TIENE DOS CARAS Y NO SE PUEDEN CONFUNDIR: `filterPhoto` JUZGA el alt
// crudo en inglés que devuelve Unsplash; `altFor` produce el alt en castellano
// que sí va al manifiesto. Si se le pasara el traducido al filtro, casi todo
// caería en `off_topic` porque ninguna palabra del sector está en castellano.
//
// La cuota de Unsplash es por hora: cada búsqueda, cada descarga y cada aviso
// cuenta. Por eso hay un presupuesto por ejecución y por eso se mira la caché
// de disco antes de pedir nada a la red.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionFor, sniffMime, type AssetKind } from "@webdesign/assets";
import { _resetBankCache, bankRoot, isSector, SECTORS, type Sector } from "./photo-bank.js";
import { altFor, filterPhoto, REJECT_REASONS } from "./photo-filter.js";
import {
  downloadUnsplash,
  notifyUnsplashDownload,
  searchUnsplash,
  type UnsplashPhoto,
} from "./unsplash.js";
import { readFromUnsplashCache, saveToUnsplashCache } from "./unsplash-cache.js";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Objetivo por defecto: el banco de partida (6 portadas y 8 galerías por sector). */
const DEFAULT_HERO = 6;
const DEFAULT_GALLERY = 8;

/** Presupuesto de peticiones por defecto. Una pasada completa gasta ~30. */
const DEFAULT_MAX_REQUESTS = 40;
const MAX_REQUESTS = 200;
const MAX_TARGET = 12;

/** Fotos por búsqueda: 30 es el máximo de Unsplash y llena un sector de sobra. */
const PER_PAGE = 30;

/** Tope de tiempo de una ejecución: si se pasa, se cierra en `done` y se sigue. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Atribución que exige Unsplash en cada enlace que publicamos. */
const UTM = "utm_source=zottaweb&utm_medium=referral";

/** Lo único que se acepta como imagen publicable, igual que en `unsplash.ts`. */
const ACCEPTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** El manifiesto que se lee y se reescribe. */
const MANIFEST_NAME = "manifest.json";
const CREDITS_NAME = "CREDITS.md";

/**
 * Consultas por sector, en inglés y pensadas para INTERIORES y entornos.
 *
 * POR QUÉ ASÍ: Unsplash devuelve lo que se le pide. Una consulta como "oficina"
 * trae retratos de gente sonriendo a la cámara, que el filtro rechaza. Pidiendo
 * el espacio ("interior", "empty", "desk", "workbench") la foto sirve de fondo
 * sin poner la cara de nadie en la web de un cliente. Dos o tres por sector:
 * más gastaría búsquedas del presupuesto sin mejorar el resultado.
 */
const SECTOR_QUERIES: Readonly<Record<Sector, readonly string[]>> = {
  despacho: ["modern office interior desks", "empty conference room interior", "coworking workspace interior"],
  hosteleria: ["restaurant interior empty tables", "cafe interior counter", "bakery shop interior"],
  comercio: ["boutique store interior shelves", "retail shop display shelves", "small shop interior counter"],
  salud: ["dental clinic interior room", "medical office interior equipment", "physiotherapy room interior"],
  taller: ["woodworking workshop workbench", "garage workshop tools wall", "carpentry workshop interior"],
  belleza: ["hair salon interior chairs mirrors", "barber shop interior mirror", "spa interior room"],
  neutro: ["minimal office workspace desk", "modern workspace interior plants", "empty desk laptop notebook"],
};

/** Lado del recorte, que es lo que decide la orientación de la foto guardada. */
type Kind = "hero" | "gallery";

const KINDS: readonly Kind[] = ["hero", "gallery"];

/** Orientación tal como la entiende el filtro (`square`, no `squarish`). */
const FILTER_ORIENTATION: Readonly<Record<Kind, "landscape" | "square">> = {
  hero: "landscape",
  gallery: "square",
};

/** Orientación tal como la entiende Unsplash en la búsqueda. */
const SEARCH_ORIENTATION: Readonly<Record<Kind, "landscape" | "squarish">> = {
  hero: "landscape",
  gallery: "squarish",
};

/** Lado del fichero por defecto, si el JPEG no declara sus dimensiones. */
const CROP_SIZE: Readonly<Record<Kind, { width: number; height: number }>> = {
  hero: { width: 1600, height: 900 },
  gallery: { width: 1200, height: 1200 },
};

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type BankBuildStatus = "running" | "done" | "failed";

/** Por qué se acabó antes de tiempo. `null` si se llegó al objetivo. */
export type BankBuildReason = "budget_exhausted" | "timeout";

export interface BankBuildOptions {
  sectors: Sector[];
  hero: number;
  gallery: number;
  maxRequests: number;
}

export interface BankBuildSectorState {
  sector: Sector;
  planned: { hero: number; gallery: number };
  added: { hero: number; gallery: number };
  /** Rechazos contados por motivo (`duplicate`, `off_topic`, `download_failed`...). */
  skipped: Record<string, number>;
  missing: { hero: number; gallery: number };
  error?: string;
}

/** Estado de una ejecución. JSON serializable y sin datos internos ni la clave. */
export interface BankBuildRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: BankBuildStatus;
  reason: BankBuildReason | null;
  requestsUsed: number;
  budget: number;
  sectors: BankBuildSectorState[];
}

/** Recuento del manifiesto, por sector y tipo. Lo que hay ahora mismo. */
export interface BankInventory {
  total: number;
  sectors: Array<{ sector: Sector; hero: number; gallery: number }>;
}

/**
 * Dependencias inyectables. Todas tienen un valor real por defecto; solo los
 * tests las usan, para no tocar la red ni `/data`.
 */
export interface BankBuildDeps {
  fetch?: typeof fetch;
  /** Raíz del banco. Por defecto `bankRoot()`. */
  bankRoot?: string;
  readCache?: (id: string) => Promise<{ meta: { mime: string }; content: Buffer } | undefined>;
  saveCache?: (entry: { photo: UnsplashPhoto; content: Buffer; mime: string; query: string }) => Promise<unknown>;
  /** Tope de tiempo en milisegundos. Por defecto 10 minutos. */
  timeoutMs?: number;
}

/** Opciones que no valen: la ruta responde 400, no arranca nada. */
export class BankBuildInputError extends Error {
  constructor() {
    super("invalid bank build options");
    this.name = "BankBuildInputError";
  }
}

/** Ya hay una ejecución en curso: la ruta responde 409. */
export class BankBuildBusyError extends Error {
  constructor() {
    super("bank build already running");
    this.name = "BankBuildBusyError";
  }
}

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

// Un solo hueco: `active` mientras corre, `latest` siempre la última lanzada.
// Las dos apuntan al MISMO objeto mientras la ejecución sigue viva, y por eso el
// snapshot que se devuelve es una copia: quien lee no ve el estado a medias.
let active: BankBuildRun | null = null;
let latest: BankBuildRun | null = null;

function snapshot(run: BankBuildRun): BankBuildRun {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    reason: run.reason,
    requestsUsed: run.requestsUsed,
    budget: run.budget,
    sectors: run.sectors.map((s) => ({
      sector: s.sector,
      planned: { hero: s.planned.hero, gallery: s.planned.gallery },
      added: { hero: s.added.hero, gallery: s.added.gallery },
      skipped: { ...s.skipped },
      missing: { hero: s.missing.hero, gallery: s.missing.gallery },
      // `exactOptionalPropertyTypes`: la clave se omite, nunca vale `undefined`.
      ...(s.error === undefined ? {} : { error: s.error }),
    })),
  };
}

/**
 * Estado actual.
 *
 * `run` es la ejecución EN CURSO (`null` si no hay ninguna) y `last` la última
 * lanzada, corra o no: mientras dura son la misma. El panel necesita las dos
 * cosas a la vez —el botón se apaga con `run` y el resultado se lee de `last`—
 * y así no hay que inventar un tercer campo.
 */
export function getBankBuildState(): { run: BankBuildRun | null; last: BankBuildRun | null } {
  return {
    run: active === null ? null : snapshot(active),
    last: latest === null ? null : snapshot(latest),
  };
}

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Sectores pedidos.
 *
 * POLÍTICA: un sector que no está en la lista cerrada RECHAZA la petición (400).
 * Ignorarlo en silencio dejaría al operador mirando una ejecución que no hace lo
 * que pidió; y un fallo de tecleo ("oficina" por "despacho") no puede acabar en
 * un 202 que no construye nada.
 */
function parseSectors(value: unknown): Sector[] {
  if (value === undefined) return [...SECTORS];
  if (!Array.isArray(value) || value.length === 0) throw new BankBuildInputError();
  const out: Sector[] = [];
  for (const item of value) {
    if (!isSector(item)) throw new BankBuildInputError();
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function parseTarget(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TARGET) {
    throw new BankBuildInputError();
  }
  return value;
}

function parseBudget(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_REQUESTS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_REQUESTS) {
    throw new BankBuildInputError();
  }
  return value;
}

/**
 * Valida el cuerpo y devuelve opciones limpias.
 *
 * Se acepta `undefined` (POST sin cuerpo) como "todo por defecto": el panel
 * manda `{}` y un operador puede lanzarlo con `curl` sin escribir nada. Lo que
 * sobra se ignora; lo que está y no vale, no.
 */
export function parseBankBuildOptions(input: unknown): BankBuildOptions {
  if (input === undefined || input === null) {
    return { sectors: [...SECTORS], hero: DEFAULT_HERO, gallery: DEFAULT_GALLERY, maxRequests: DEFAULT_MAX_REQUESTS };
  }
  if (!isRecord(input)) throw new BankBuildInputError();
  return {
    sectors: parseSectors(input["sectors"]),
    hero: parseTarget(input["hero"], DEFAULT_HERO),
    gallery: parseTarget(input["gallery"], DEFAULT_GALLERY),
    maxRequests: parseBudget(input["maxRequests"]),
  };
}

// ---------------------------------------------------------------------------
// Manifiesto y ficheros
// ---------------------------------------------------------------------------

/**
 * El manifiesto tal cual, sin normalizar.
 *
 * `photo-bank.ts` lo lee para servir fotos, pero pierde campos (autor con
 * enlace, `downloadLocation`) y no lo reescribe. Aquí se conserva el documento
 * ENTERO —cabecera y entradas previas incluidas— porque cada foto nueva lo
 * reescribe: lo que no se copie, se pierde.
 */
interface ManifestDoc {
  photos: unknown[];
  [key: string]: unknown;
}

const MANIFEST_HEADER = {
  source: "Unsplash",
  license: "Unsplash License",
  licenseUrl: "https://unsplash.com/license",
  attributionRequired: true,
  utmSource: "zottaweb",
} as const;

function unsplashDir(root: string): string {
  return join(root, "unsplash");
}

async function loadManifestDoc(root: string): Promise<ManifestDoc> {
  const abs = join(unsplashDir(root), MANIFEST_NAME);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...MANIFEST_HEADER, photos: [] };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Un manifiesto ilegible NO se sobrescribe: reescribirlo borraría las fotos
    // que ya están publicadas. La ejecución se cierra en `failed` y no toca nada.
    throw new Error("manifest_unreadable");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["photos"])) throw new Error("manifest_unreadable");
  const doc: ManifestDoc = { ...parsed, photos: parsed["photos"] as unknown[] };
  // La cabecera no se inventa si falta: se rellena lo mínimo que el resto del
  // sistema espera y se deja lo que ya hubiera.
  for (const [key, value] of Object.entries(MANIFEST_HEADER)) {
    if (doc[key] === undefined) doc[key] = value;
  }
  return doc;
}

/** ¿La entrada es de este sector y de este tipo? */
function entryMatches(entry: unknown, sector: Sector, kind: Kind): boolean {
  if (!isRecord(entry)) return false;
  if (entry["sector"] !== sector) return false;
  const orientation = entry["orientation"];
  if (kind === "hero") return orientation === "landscape";
  return orientation === "squarish" || orientation === "square";
}

function countInManifest(doc: ManifestDoc, sector: Sector, kind: Kind): number {
  return doc.photos.filter((entry) => entryMatches(entry, sector, kind)).length;
}

/** Ids ya presentes en el banco: el filtro no repite ninguna de esas fotos. */
function manifestIds(doc: ManifestDoc): Set<string> {
  const ids = new Set<string>();
  for (const entry of doc.photos) {
    if (isRecord(entry) && typeof entry["id"] === "string" && entry["id"] !== "") ids.add(entry["id"]);
  }
  return ids;
}

/**
 * Escritura atómica del manifiesto (`.tmp` + `rename`).
 *
 * DESPUÉS DE CADA FOTO, no al final: si el proceso muere a mitad, el manifiesto
 * en disco tiene tantas entradas como ficheros hay. Un manifiesto que se escribe
 * solo al final dejaría fotos en el disco que nadie ve, y una escritura directa
 * dejaría un JSON truncado en cuanto algo falle a medias.
 */
async function writeManifestDoc(root: string, doc: ManifestDoc): Promise<void> {
  const dir = unsplashDir(root);
  await mkdir(dir, { recursive: true });
  const abs = join(dir, MANIFEST_NAME);
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await rename(tmp, abs);
}

/** Texto seguro para una celda de tabla Markdown. */
function cell(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim() : "";
}

/**
 * `CREDITS.md` completo, con el MISMO formato que el que ya está en el banco.
 *
 * Se reescribe entero con cada foto (es un fichero de unos pocos KB): así el
 * documento no puede quedar desincronizado con el manifiesto.
 */
function creditsMarkdown(doc: ManifestDoc): string {
  const lines = [
    "# Créditos de las fotos",
    "",
    "Las fotos de esta carpeta son de [Unsplash](https://unsplash.com/license) y se usan bajo la",
    "Unsplash License: uso comercial libre y sin obligación de atribución, aunque aquí dejamos el",
    "crédito de cada autor. Cada enlace lleva `utm_source=zottaweb&utm_medium=referral`.",
    "",
    "| Foto | Autor | Licencia |",
    "| --- | --- | --- |",
  ];
  for (const entry of doc.photos) {
    if (!isRecord(entry)) continue;
    const file = cell(entry["file"]);
    if (file === "") continue;
    const photographer = isRecord(entry["photographer"]) ? entry["photographer"] : {};
    const name = cell(photographer["name"]) || "Unsplash";
    const profile = cell(photographer["profileUrl"]);
    const author = profile === "" ? name : `[${name}](${profile})`;
    lines.push(`| \`${file}\` | ${author} | [Unsplash License](https://unsplash.com/license) |`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeCredits(root: string, doc: ManifestDoc): Promise<void> {
  const dir = unsplashDir(root);
  await mkdir(dir, { recursive: true });
  const abs = join(dir, CREDITS_NAME);
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, creditsMarkdown(doc), "utf8");
  await rename(tmp, abs);
}

// ---------------------------------------------------------------------------
// Dimensiones reales del fichero
// ---------------------------------------------------------------------------

function byteAt(buf: Buffer, index: number): number {
  return buf[index] ?? 0;
}

/**
 * Ancho y alto REALES que declara el fichero, o `undefined`.
 *
 * POR QUÉ NO SE USAN LOS DE LA BÚSQUEDA: `photo.width`/`photo.height` son los de
 * la foto original en Unsplash, no los del recorte que se baja. El manifiesto
 * dice lo que hay en el fichero, así que se lee del propio fichero. Se cubren
 * JPEG (el recorte pide `fm=jpg`) y PNG; si no se puede leer, se usa el tamaño
 * que fuerza el recorte, que es el único dato cierto que queda.
 */
export function imageSize(content: Buffer): { width: number; height: number } | undefined {
  // JPEG: se recorren los segmentos hasta el SOF, que declara el tamaño.
  if (byteAt(content, 0) === 0xff && byteAt(content, 1) === 0xd8) {
    let i = 2;
    while (i + 9 < content.length) {
      if (byteAt(content, i) !== 0xff) return undefined;
      const marker = byteAt(content, i + 1);
      // Marcadores sin longitud (SOI, EOI, reinicio, TEM).
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (byteAt(content, i + 2) << 8) | byteAt(content, i + 3);
      if (len < 2) return undefined;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (byteAt(content, i + 5) << 8) | byteAt(content, i + 6);
        const width = (byteAt(content, i + 7) << 8) | byteAt(content, i + 8);
        return width > 0 && height > 0 ? { width, height } : undefined;
      }
      i += 2 + len;
    }
    return undefined;
  }
  // PNG: el IHDR va siempre el primero y lleva el tamaño en big endian.
  const png = content.subarray(0, 24);
  if (png.length === 24 && png.subarray(12, 16).toString("latin1") === "IHDR") {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Utilidades de escritura
// ---------------------------------------------------------------------------

/** Añade `?` o `&` según haga falta. */
function withUtm(url: string): string {
  if (url === "") return "";
  const sep = url.includes("?") ? "&" : "?";
  // Si ya lleva el utm (una entrada reutilizada) no se duplica.
  return url.includes(UTM) ? url : `${url}${sep}${UTM}`;
}

function bump(bag: Record<string, number>, key: string): void {
  bag[key] = (bag[key] ?? 0) + 1;
}

/** Índice libre más alto de la carpeta para ese tipo (`hero-07.jpg` → 7). */
async function maxIndex(dir: string, kind: Kind): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const pattern = new RegExp(`^${kind}-(\\d{1,3})\\.(?:jpg|jpeg|png|webp)$`, "i");
  let max = 0;
  for (const name of names) {
    const m = pattern.exec(name);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Escribe el fichero en el siguiente índice libre y devuelve su ruta relativa.
 *
 * NUNCA SOBRESCRIBE: se abre con `wx`, que falla si el nombre ya existe, y ante
 * ese fallo se prueba el siguiente índice. Mirar la carpeta y escribir después
 * dejaría una ventana en la que otro proceso (o una ejecución anterior a medias)
 * ocupa ese número.
 *
 * La extensión sigue al MIME REAL y no al recorte pedido: el recorte pide JPEG,
 * pero si Unsplash devolviera un PNG, llamarlo `.jpg` sería mentir en el nombre.
 */
async function writePhotoFile(
  dir: string,
  kind: Kind,
  content: Buffer,
  mime: string,
): Promise<{ file: string; index: number } | undefined> {
  await mkdir(dir, { recursive: true });
  const ext = extensionFor("image" as AssetKind, mime);
  let index = (await maxIndex(dir, kind)) + 1;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `${kind}-${String(index).padStart(2, "0")}.${ext}`;
    try {
      await writeFile(join(dir, name), content, { flag: "wx" });
      return { file: name, index };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      index += 1;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

interface ResolvedDeps {
  fetch: typeof fetch;
  root: string;
  readCache: NonNullable<BankBuildDeps["readCache"]>;
  saveCache: NonNullable<BankBuildDeps["saveCache"]>;
  download: typeof downloadUnsplash;
  notify: typeof notifyUnsplashDownload;
  timeoutMs: number;
}

function resolveDeps(deps: BankBuildDeps): ResolvedDeps {
  const timeout = deps.timeoutMs;
  return {
    fetch: deps.fetch ?? fetch,
    root: deps.bankRoot ?? bankRoot(),
    readCache: deps.readCache ?? readFromUnsplashCache,
    saveCache: deps.saveCache ?? saveToUnsplashCache,
    download: downloadUnsplash,
    notify: notifyUnsplashDownload,
    timeoutMs: typeof timeout === "number" && timeout >= 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

interface Ctx {
  run: BankBuildRun;
  deps: ResolvedDeps;
  doc: ManifestDoc;
  /** Ids ya en el banco MÁS los aceptados en esta ejecución. */
  known: Set<string>;
  deadline: number;
}

function emptySkipped(): Record<string, number> {
  const skipped: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const reason of REJECT_REASONS) skipped[reason] = 0;
  skipped["download_failed"] = 0;
  return skipped;
}

/**
 * Cobra una petición del presupuesto.
 *
 * `false` significa "no queda": la ejecución se cierra en `done` con
 * `budget_exhausted` y lo que falte queda como incompleto, no como error. La
 * cuota de Unsplash es por hora y gastarla no es un fallo del sistema.
 */
function spend(run: BankBuildRun): boolean {
  if (run.requestsUsed >= run.budget) return false;
  run.requestsUsed += 1;
  return true;
}

function stopReason(ctx: Ctx): BankBuildReason | null {
  if (ctx.run.reason !== null) return ctx.run.reason;
  if (Date.now() >= ctx.deadline) return "timeout";
  return null;
}

/**
 * Guarda una foto aceptada: caché, descarga, aviso, fichero y manifiesto.
 *
 * Devuelve `true` solo si la foto quedó escrita Y anotada en el manifiesto: si
 * se escribe el fichero pero falla el manifiesto, esa foto no existe para el
 * resto del sistema y contarla como añadida sería mentir.
 */
async function storePhoto(
  ctx: Ctx,
  sector: Sector,
  kind: Kind,
  report: BankBuildSectorState,
  photo: UnsplashPhoto,
  query: string,
): Promise<boolean> {
  let content: Buffer;
  let mime: string;

  // CACHÉ ANTES QUE RED, igual que en internal-photos.ts: una foto ya bajada no
  // se vuelve a pedir ni se cobra dos veces. Un acierto de caché tampoco avisa a
  // Unsplash, porque no es una descarga nueva.
  const cached = await ctx.deps.readCache(photo.id);
  if (cached) {
    content = cached.content;
    mime = cached.meta.mime;
  } else {
    if (!spend(ctx.run)) {
      ctx.run.reason = "budget_exhausted";
      return false;
    }
    const downloaded = await ctx.deps.download(photo, ctx.deps.fetch, kind);
    if (!downloaded) {
      bump(report.skipped, "download_failed");
      return false;
    }
    content = downloaded.content;
    mime = downloaded.mime;
    try {
      await ctx.deps.saveCache({ photo, content, mime, query });
    } catch (error) {
      // La caché es un ahorro, no un requisito: si no se puede guardar, la foto
      // se escribe igual y la próxima vez se bajará de nuevo.
      console.warn("bank_build_cache_failed", { error: String((error as Error).message || error) });
    }
    if (spend(ctx.run)) {
      // Cortesía con el fotógrafo y condición de la API. No lanza: si falla, se
      // registra dentro de unsplash.ts y la foto se queda.
      await ctx.deps.notify(photo, ctx.deps.fetch);
    } else {
      // Sin presupuesto para el aviso: se anota y se sigue, que la descarga ya
      // está pagada y tirar la foto sería desperdiciarla.
      ctx.run.reason = "budget_exhausted";
    }
  }

  // El MIME real manda, venga de la caché o de la red: un fichero que no es
  // imagen no se escribe en el banco ni se anuncia en el manifiesto.
  const sniffed = content.byteLength >= 4 ? sniffMime(content.subarray(0, 16)) : undefined;
  if (!sniffed || !ACCEPTED_IMAGE_MIME.has(sniffed)) {
    bump(report.skipped, "download_failed");
    return false;
  }

  const size = imageSize(content) ?? CROP_SIZE[kind];
  const written = await writePhotoFile(join(unsplashDir(ctx.deps.root), sector), kind, content, sniffed);
  if (!written) {
    bump(report.skipped, "write_failed");
    return false;
  }

  const photoPageUrl = withUtm(photo.url !== "" ? photo.url : `https://unsplash.com/photos/${photo.id}`);
  const entry = {
    id: photo.id,
    file: `${sector}/${written.file}`,
    sector,
    orientation: kind === "hero" ? "landscape" : "squarish",
    width: size.width,
    height: size.height,
    // Se juzga con el alt inglés (`filterPhoto`) y se publica el castellano.
    alt: altFor(photo, sector),
    photographer: {
      name: photo.photographer,
      profileUrl: withUtm(photo.photographerUrl !== "" ? photo.photographerUrl : "https://unsplash.com/"),
    },
    unsplashUrl: withUtm("https://unsplash.com/"),
    photoPageUrl,
    downloadLocation: photo.downloadLocation,
  };

  // Primero el manifiesto (atómico) y después el aviso en memoria: si el proceso
  // muere entre medias, sobra un fichero, que es recuperable; al revés, el
  // manifiesto apuntaría a un fichero que no existe.
  ctx.doc.photos.push(entry);
  await writeManifestDoc(ctx.deps.root, ctx.doc);
  await writeCredits(ctx.deps.root, ctx.doc);
  _resetBankCache();
  console.info("bank_build_photo_added", { sector, kind, file: entry.file });
  return true;
}

/**
 * Rellena un sector y un tipo hasta el objetivo.
 *
 * Se piden las consultas en orden y se para en cuanto se llega al objetivo: la
 * cuota es finita y el banco no necesita "un poco más" de lo pedido.
 */
async function fillSector(
  ctx: Ctx,
  sector: Sector,
  kind: Kind,
  target: number,
  report: BankBuildSectorState,
): Promise<void> {
  let have = countInManifest(ctx.doc, sector, kind);
  if (have >= target) return;

  for (const query of SECTOR_QUERIES[sector]) {
    if (have >= target) return;
    const reason = stopReason(ctx);
    if (reason !== null) {
      if (ctx.run.reason === null) ctx.run.reason = reason;
      return;
    }
    if (!spend(ctx.run)) {
      ctx.run.reason = "budget_exhausted";
      return;
    }
    const candidates = await searchUnsplash(
      query,
      { orientation: SEARCH_ORIENTATION[kind], perPage: PER_PAGE },
      ctx.deps.fetch,
    );

    for (const photo of candidates) {
      if (have >= target) return;
      const stop = stopReason(ctx);
      if (stop !== null) {
        if (ctx.run.reason === null) ctx.run.reason = stop;
        return;
      }
      // El alt CRUDO en inglés es el que juzga el filtro. El traducido se
      // escribe al manifiesto, no aquí.
      const verdict = filterPhoto({
        photo,
        sector,
        orientation: FILTER_ORIENTATION[kind],
        knownIds: ctx.known,
      });
      if (!verdict.accepted) {
        bump(report.skipped, verdict.reason ?? "off_topic");
        continue;
      }
      // Aceptada: se marca como conocida ANTES de bajarla, para no reintentarla
      // con la siguiente consulta aunque la descarga falle.
      ctx.known.add(photo.id);
      const saved = await storePhoto(ctx, sector, kind, report, photo, query);
      if (saved) {
        have += 1;
        report.added[kind] += 1;
      }
      if (ctx.run.reason !== null) return;
    }
  }
}

async function execute(ctx: Ctx, opts: BankBuildOptions): Promise<void> {
  for (const state of ctx.run.sectors) {
    // El presupuesto o el reloj pueden haberse agotado en el sector anterior:
    // se comprueba antes de empezar cada uno y se para la ejecución entera,
    // porque sin peticiones no se puede hacer nada en ningún sitio.
    const reason = stopReason(ctx);
    if (reason !== null) {
      if (ctx.run.reason === null) ctx.run.reason = reason;
      break;
    }
    try {
      for (const kind of KINDS) {
        const target = kind === "hero" ? opts.hero : opts.gallery;
        if (target === 0) continue;
        await fillSector(ctx, state.sector, kind, target, state);
        if (ctx.run.reason !== null) break;
      }
    } catch (error) {
      // Un sector que falla no tumba la biblioteca: se anota y se pasa al
      // siguiente. El mensaje es corto y sin detalles internos (ni la clave).
      state.error = "No se pudo completar este sector.";
      console.warn("bank_build_sector_failed", {
        sector: state.sector,
        error: String((error as Error).message || error).slice(0, 120),
      });
    }
  }

  // `missing` se cuenta SIEMPRE contra el manifiesto al final, incluso en los
  // sectores que no se llegaron a tocar: es lo que de verdad falta en disco, no
  // lo que se pretendía añadir.
  for (const state of ctx.run.sectors) {
    for (const kind of KINDS) {
      const target = kind === "hero" ? opts.hero : opts.gallery;
      state.missing[kind] = Math.max(0, target - countInManifest(ctx.doc, state.sector, kind));
    }
  }
}

// ---------------------------------------------------------------------------
// Contrato público
// ---------------------------------------------------------------------------

/**
 * Lanza una construcción y vuelve en seguida.
 *
 * El trabajo sigue en segundo plano: la ruta responde 202 con el estado inicial
 * y el panel lo sigue por `GET`. Cualquier fallo no controlado deja la ejecución
 * en `failed` con un mensaje corto; el detalle va al registro del servidor, sin
 * la clave ni cuerpos de terceros.
 */
export function startBankBuild(input: unknown, deps: BankBuildDeps = {}): BankBuildRun {
  const opts = parseBankBuildOptions(input);
  if (active !== null) throw new BankBuildBusyError();

  const run: BankBuildRun = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    reason: null,
    requestsUsed: 0,
    budget: opts.maxRequests,
    sectors: opts.sectors.map((sector) => ({
      sector,
      planned: { hero: opts.hero, gallery: opts.gallery },
      added: { hero: 0, gallery: 0 },
      skipped: emptySkipped(),
      missing: { hero: opts.hero, gallery: opts.gallery },
    })),
  };
  active = run;
  latest = run;
  console.info("bank_build_start", { budget: run.budget, sectors: run.sectors.length });

  const resolved = resolveDeps(deps);
  void runBuild(run, opts, resolved).catch((error: unknown) => {
    // Red de seguridad: un fallo inesperado (disco lleno, permisos) no puede
    // dejar la ejecución en `running` para siempre, porque el botón quedaría
    // bloqueado hasta reiniciar el proceso.
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.reason = null;
    active = null;
    latest = run;
    console.warn("bank_build_failed", { error: String((error as Error).message || error).slice(0, 120) });
  });

  return snapshot(run);
}

async function runBuild(run: BankBuildRun, opts: BankBuildOptions, deps: ResolvedDeps): Promise<void> {
  try {
    const doc = await loadManifestDoc(deps.root);
    const ctx: Ctx = {
      run,
      deps,
      doc,
      known: manifestIds(doc),
      deadline: Date.now() + deps.timeoutMs,
    };
    await execute(ctx, opts);
    run.status = "done";
  } catch (error) {
    // Fallo de verdad (manifiesto ilegible, disco lleno, permisos): la ejecución
    // se cierra en `failed`. El detalle va al registro del servidor y nunca sale
    // por la API ni incluye la clave.
    run.status = "failed";
    run.reason = null;
    console.warn("bank_build_error", { error: String((error as Error).message || error).slice(0, 120) });
  } finally {
    // `finishedAt` se pone en TODOS los caminos: una ejecución sin fecha de
    // cierre dejaría el botón bloqueado hasta reiniciar el proceso.
    run.finishedAt = new Date().toISOString();
    active = null;
    latest = run;
    // El resto del sistema lee el manifiesto de una caché en memoria: sin esto,
    // las fotos nuevas tardarían en verse hasta reiniciar el proceso.
    _resetBankCache();
    const event =
      run.status === "failed" ? "bank_build_failed" : run.reason === null ? "bank_build_done" : `bank_build_${run.reason}`;
    console.info(event, { requests: run.requestsUsed, budget: run.budget });
  }
}

/**
 * Recuento actual del manifiesto, por sector. Lo que el panel enseña al abrir.
 *
 * ES ESTRICTA A PROPÓSITO: si el manifiesto existe pero no se puede leer, LANZA
 * (`manifest_unreadable`) en vez de devolver ceros. Un banco ilegible es un fallo
 * que hay que ver —devolver "no hay fotos" escondería el problema y, peor aún,
 * invitaría a reconstruir el banco encima de un manifiesto roto—. Quien llama por
 * HTTP traduce esa excepción a un 500 controlado, porque es en la ruta donde una
 * promesa rechazada tumbaría el proceso; aquí, en el módulo, lanzar es lo correcto.
 *
 * Un manifiesto que NO existe sí devuelve ceros: un despliegue nuevo no tiene
 * banco todavía y eso no es un error, es el punto de partida.
 */
export async function bankInventory(root: string = bankRoot()): Promise<BankInventory> {
  const doc = await loadManifestDoc(root);
  const sectors = SECTORS.map((sector) => ({
    sector,
    hero: countInManifest(doc, sector, "hero"),
    gallery: countInManifest(doc, sector, "gallery"),
  }));
  return { total: doc.photos.length, sectors };
}
