// Filtro de fotos por METADATOS, sin mirar la imagen.
//
// POR QUÉ EXISTE: el job de produccion llena el banco de fotos sin que nadie vea
// las imagenes. Aqui no hay vision: el gateway solo acepta texto, asi que el
// unico juicio posible es el que se puede escribir — `alt` de Unsplash (y sus
// `tags`, si vienen), dimensiones y proporcion. Esto codifica el criterio que
// hasta hoy se aplicaba a ojo sobre las 98 fotos del banco.
//
// REGLA DE ORO: ante la duda, rechazar. El job informa de la falta; no rellena
// un sector con una foto que no le toca. Un rechazo de mas cuesta una foto; un
// rechazo de menos pone la cara de una persona en la web de un cliente.
//
// Nada de este modulo toca la red ni el disco: solo recibe datos y devuelve un
// veredicto. Ni lanza ni conoce `process.env`.

import type { Sector } from "./photo-bank.js";
import type { UnsplashPhoto } from "./unsplash.js";

/** Motivo de rechazo. El primero que se cumple es el que se informa. */
export type RejectReason =
  | "too_small"
  | "duplicate"
  | "portrait_or_people"
  | "brand"
  | "no_description"
  | "aspect_mismatch"
  | "off_topic";

/** Los siete motivos, para inicializar contadores a cero sin olvidar ninguno. */
export const REJECT_REASONS: readonly RejectReason[] = [
  "duplicate",
  "too_small",
  "no_description",
  "portrait_or_people",
  "brand",
  "aspect_mismatch",
  "off_topic",
];

export interface FilterInput {
  photo: UnsplashPhoto;
  sector: Sector;
  orientation: "landscape" | "square";
  /** Ids que ya estan en el banco: no se repiten. */
  knownIds: ReadonlySet<string>;
}

export interface FilterResult {
  accepted: boolean;
  /** Solo presente cuando `accepted` es `false`. */
  reason?: RejectReason;
}

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

/**
 * Palabras que delatan a una persona o un retrato. Se comparan con limite de
 * palabra (ver `termRegex`): `management` no es `man` ni `human resources` es
 * un retrato.
 *
 * Se anaden plurales y las formas obvias (`smiling`, `models`) porque el `alt`
 * de Unsplash es una frase corriente, no una etiqueta.
 */
export const PEOPLE_TERMS: readonly string[] = [
  "portrait",
  "portraits",
  "face",
  "faces",
  "facial",
  "smiling at camera",
  "headshot",
  "headshots",
  "selfie",
  "selfies",
  "posing",
  "pose",
  "poses",
  "model",
  "models",
  "man",
  "men",
  "woman",
  "women",
  "male",
  "males",
  "female",
  "females",
  "girl",
  "girls",
  "boy",
  "boys",
  "person",
  "persons",
  "people",
  "person standing",
  "people looking",
  "candid",
  "close up of a",
  "eyes",
  "lips",
  "smile",
  "smiles",
  "smiling",
];

/**
 * Marcas visibles. Una marca en el `alt` es una marca en la foto: no se publica
 * el producto de otro en la web de un cliente.
 */
export const BRAND_TERMS: readonly string[] = [
  "apple",
  "iphone",
  "ipad",
  "macbook",
  "google",
  "microsoft",
  "nike",
  "adidas",
  "coca-cola",
  "coca cola",
  "pepsi",
  "starbucks",
  "mcdonald",
  "mcdonalds",
  "samsung",
  "sony",
  "makita",
  "bosch",
  "dell",
  "hp",
  "lenovo",
  "vodafone",
  "ikea",
  "amazon",
  "ferrari",
  "bmw",
  "mercedes",
  "tesla",
  "canon",
];

/**
 * Guardas de contexto: la palabra esta, pero no es la marca.
 *
 * `canon` solo es marca si no habla de derecho canonico; `apple` no lo es si es
 * fruta (`apple pie`); `amazon` no lo es si es el rio. Sin esto, una foto de un
 * puesto de manzanas o de un despacho de derecho se rechazaria por marca.
 */
const BRAND_GUARDS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>([
  ["apple", /(?:^|[^a-z0-9])apple(?:\s+[a-z]+){0,2}\s+(?:pie|pies|juice|juices|tart|tarts|cider|orchard|tree|trees|slice|slices)/i],
  ["canon", /(?:^|[^a-z0-9])canon\s+(?:law|lawyer|lawyers|ical)/i],
  ["amazon", /(?:^|[^a-z0-9])amazon\s+(?:river|rainforest|forest|basin)/i],
]);

/**
 * Frases genericas de Unsplash: no dicen QUE es la foto, solo que hay algo.
 * Ademas de esta lista corta, `no_description` rechaza cualquier `alt` formado
 * solo por relleno (ver `isFillerOnly`).
 */
export const GENERIC_ALT_PHRASES: readonly string[] = [
  "a close up of a person",
  "close up of a person",
  "a person",
  "a person standing",
  "a blurry image",
  "a blurry photo",
  "a blurry image of a building",
  "a blurry photo of a building",
  "a white background",
  "a black background",
  "an abstract background",
  "a picture of a building",
  "a building",
  "an empty room",
  "no description available",
  "a sign on a wall",
];

/** Palabras que no describen nada por si solas: si el `alt` es solo esto, no hay `alt`. */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "of",
  "with",
  "in",
  "on",
  "at",
  "and",
  "or",
  "to",
  "is",
  "are",
  "for",
  "from",
  "by",
  "close",
  "up",
  "image",
  "images",
  "photo",
  "picture",
  "pic",
  "shot",
  "blur",
  "blurry",
  "blurred",
  "background",
  "white",
  "black",
  "gray",
  "grey",
  "dark",
  "light",
  "bright",
  "empty",
  "simple",
  "some",
  "no",
  "description",
  "available",
  "person",
  "people",
  "building",
  "thing",
  "stuff",
  "object",
  "texture",
  "pattern",
  "abstract",
  "wall",
  "sign",
]);

/**
 * Lo que un sector tiene que mencionar para no ser `off_topic`.
 *
 * La lista es la puerta de entrada del sector: si el `alt` no nombra nada de
 * aqui, no hay forma de saber que la foto es del negocio que se esta montando.
 * Las dudas se resuelven dentro (ver `SECTOR_RISK`), no ensanchando la lista.
 */
export const SECTOR_TERMS: Readonly<Record<Sector, readonly string[]>> = {
  despacho: [
    "office",
    "offices",
    "desk",
    "desks",
    "meeting",
    "meetings",
    "conference",
    "workspace",
    "workspaces",
    "library",
    "libraries",
    "books",
    "reception",
    "lobby",
    "chair",
    "chairs",
  ],
  hosteleria: [
    "restaurant",
    "restaurants",
    "cafe",
    "cafes",
    "coffee",
    "bar",
    "bars",
    "kitchen",
    "kitchens",
    "table",
    "tables",
    "dining",
    "counter",
    "counters",
    "menu",
    "menus",
    "bakery",
    "bakeries",
  ],
  comercio: [
    "shop",
    "shops",
    "store",
    "stores",
    "boutique",
    "boutiques",
    "retail",
    "shelf",
    "shelves",
    "display",
    "displays",
    "market",
    "markets",
    "clothing",
    "product",
    "products",
  ],
  salud: [
    "clinic",
    "clinics",
    "medical",
    "dental",
    "dentist",
    "dentists",
    "hospital",
    "hospitals",
    "health",
    "doctor",
    "doctors",
    "office",
    "offices",
    "equipment",
    "treatment",
    "treatments",
  ],
  taller: [
    "workshop",
    "workshops",
    "garage",
    "garages",
    "tool",
    "tools",
    "workbench",
    "workbenches",
    "carpentry",
    "wood",
    "wooden",
    "machine",
    "machines",
    "mechanic",
    "mechanics",
  ],
  belleza: [
    "salon",
    "salons",
    "barber",
    "barbers",
    "hair",
    "spa",
    "spas",
    "beauty",
    "mirror",
    "mirrors",
    "chair",
    "chairs",
    "nail",
    "nails",
    "cosmetic",
    "cosmetics",
    "treatment",
    "treatments",
  ],
  neutro: [
    "office",
    "offices",
    "desk",
    "desks",
    "computer",
    "computers",
    "laptop",
    "laptops",
    "plant",
    "plants",
    "business",
    "work",
    "works",
    "hand",
    "hands",
    "meeting",
    "meetings",
    "notebook",
    "notebooks",
  ],
};

/**
 * Frase de cierre de `altFor` cuando no hay nada seguro que traducir.
 *
 * Es cierta POR CONSTRUCCION: la foto viene de una busqueda de ese sector, asi
 * que es un espacio de trabajo o el interior de un negocio, y no se afirma nada
 * del tipo concreto de negocio.
 */
const SECTOR_FALLBACK_ALT: Readonly<Record<Sector, string>> = {
  despacho: "Espacio de trabajo",
  taller: "Espacio de trabajo",
  salud: "Espacio de trabajo",
  neutro: "Espacio de trabajo",
  hosteleria: "Interior de un negocio",
  comercio: "Interior de un negocio",
  belleza: "Interior de un negocio",
};

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex de una lista de terminos con limite de palabra.
 *
 * Se usa `(?:^|[^a-z0-9])` + lookahead en vez de `\b` porque `\b` depende de
 * `\w` y aqui el texto es ingles corriente con apostrofos y guiones. Los dos
 * bordes son obligatorios: `man` NO casa dentro de `management` ni `hp` dentro
 * de `happiness`.
 */
function termRegex(terms: readonly string[]): RegExp {
  const body = terms.map(escapeRe).join("|");
  return new RegExp(`(?:^|[^a-z0-9])(?:${body})(?=$|[^a-z0-9])`, "i");
}

/** Raiz basta para comparar singular y plural: «mesas» y «Mesa» son lo mismo. */
function stem(word: string): string {
  return word.toLowerCase().trim().replace(/(?:es|s)$/, "");
}

function normalise(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** ¿El texto menciona alguno de los terminos? */
function hits(text: string, regex: RegExp): boolean {
  return text !== "" && regex.test(text);
}

/**
 * Guardas de las palabras del sector: la palabra esta, pero no es del sector.
 *
 * `bar` de hosteleria es el local, no la pastilla: «a bar of soap» tiene que
 * caer en `off_topic`.
 */
const SECTOR_TERM_GUARDS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>([
  ["bar", /(?:^|[^a-z0-9])bar\s+of/],
]);

/** ¿Casa este termino suelto, con limite de palabra y sin su guarda? */
function matchesTerm(text: string, term: string): boolean {
  const one = new RegExp(`(?:^|[^a-z0-9])${escapeRe(term)}(?=$|[^a-z0-9])`, "i");
  if (!one.test(text)) return false;
  const guard = SECTOR_TERM_GUARDS.get(term);
  return !(guard && guard.test(text));
}

/** ¿El texto nombra algo del sector? */
function sectorHit(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => matchesTerm(text, term));
}

const PEOPLE_RE = termRegex(PEOPLE_TERMS);
const GENERIC_RE = termRegex(GENERIC_ALT_PHRASES);

/** Marca visible en el texto: la primera que case, o `undefined`. */
function brandHit(text: string): string | undefined {
  if (text === "") return undefined;
  for (const brand of BRAND_TERMS) {
    const one = new RegExp(`(?:^|[^a-z0-9])${escapeRe(brand)}(?=$|[^a-z0-9])`, "i");
    if (!one.test(text)) continue;
    const guard = BRAND_GUARDS.get(brand);
    if (guard && guard.test(text)) continue;
    return brand;
  }
  return undefined;
}

/** ¿El `alt` es solo relleno ("a close up of a", "blurry background"...)? */
function isFillerOnly(alt: string): boolean {
  const words = alt.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  return words.every((w) => FILLER_WORDS.has(w));
}

/**
 * `tags` de Unsplash, si vienen.
 *
 * NO se añade al tipo `UnsplashPhoto` porque esta sesion no ha podido mirar la
 * respuesta real de la API (la tarea prohibe red) y no se inventan campos: se
 * leen de forma defensiva. Vale tanto una lista de cadenas como la lista de
 * objetos `{ title }` que documenta Unsplash; lo que no encaje se ignora.
 */
function tagsOf(photo: UnsplashPhoto): string[] {
  const raw = (photo as unknown as Record<string, unknown>)["tags"];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const t = normalise(item);
      if (t !== "") out.push(t);
      continue;
    }
    if (item && typeof item === "object") {
      const title = normalise((item as Record<string, unknown>)["title"]);
      if (title !== "") out.push(title);
    }
  }
  return out;
}

/** Texto que se juzga: `alt` mas `tags` (si existen), en una sola cadena. */
function judgeable(photo: UnsplashPhoto, alt: string): string {
  const tags = tagsOf(photo);
  return tags.length === 0 ? alt : `${alt} ${tags.join(" ")}`.trim();
}

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

function reject(reason: RejectReason): FilterResult {
  return { accepted: false, reason };
}

/**
 * Veredicto de una foto. Las reglas se aplican en orden y gana la primera que
 * se cumple, para que el motivo informado sea el que de verdad importa (una
 * repetida es `duplicate` antes que `too_small`).
 */
export function filterPhoto(input: FilterInput): FilterResult {
  // Defensa: quien llama puede traer un `input` incompleto de un JSON.
  const photo = (input && typeof input === "object" ? input.photo : undefined) as UnsplashPhoto | undefined;
  if (!photo || typeof photo !== "object") return reject("no_description");

  const id = normalise(photo.id);
  const alt = normalise(photo.alt);
  const text = judgeable(photo, alt);
  const orientation = input.orientation === "square" || (input.orientation as string) === "squarish" ? "square" : "landscape";
  const knownIds = input.knownIds instanceof Set ? input.knownIds : new Set<string>();

  // 1. duplicate
  if (id !== "" && knownIds.has(id)) return reject("duplicate");

  // 2. too_small: un `width` que no es numero se trata como 0 (no sirve).
  const width = typeof photo.width === "number" && Number.isFinite(photo.width) ? photo.width : 0;
  const minWidth = orientation === "square" ? 1200 : 1600;
  if (width < minWidth) return reject("too_small");

  // 3. no_description: sin descripcion no hay forma de saber que es.
  if (alt.length < 12 || GENERIC_RE.test(alt) || isFillerOnly(alt)) return reject("no_description");

  // 4. portrait_or_people: se mira `alt` + `tags`.
  if (hits(text, PEOPLE_RE)) return reject("portrait_or_people");

  // 5. brand
  if (brandHit(text) !== undefined) return reject("brand");

  // 6. aspect_mismatch
  const height = typeof photo.height === "number" && Number.isFinite(photo.height) ? photo.height : 0;
  const ratio = height > 0 ? width / height : Number.POSITIVE_INFINITY;
  if (orientation === "square") {
    if (ratio < 0.9 || ratio > 1.15) return reject("aspect_mismatch");
  } else if (ratio < 1.5 || ratio > 2.0) {
    return reject("aspect_mismatch");
  }

  // 7. off_topic: el sector tiene que estar nombrado en el texto.
  const sector = input.sector;
  const terms = sector && SECTOR_TERMS[sector] ? SECTOR_TERMS[sector] : SECTOR_TERMS.neutro;
  if (!sectorHit(text, terms)) return reject("off_topic");

  return { accepted: true };
}

/**
 * Filtra un lote de golpe.
 *
 * `knownIds` no se amplia con lo aceptado: quien llama decide si una foto
 * aceptada pasa a estar conocida. Asi un lote no se rechaza a si mismo.
 */
export function filterBatch(inputs: FilterInput[]): {
  accepted: FilterInput[];
  rejected: Array<{ input: FilterInput; reason: RejectReason }>;
  counts: Record<RejectReason, number>;
} {
  const accepted: FilterInput[] = [];
  const rejected: Array<{ input: FilterInput; reason: RejectReason }> = [];
  const counts = Object.create(null) as Record<RejectReason, number>;
  for (const reason of REJECT_REASONS) counts[reason] = 0;

  for (const input of Array.isArray(inputs) ? inputs : []) {
    const result = filterPhoto(input);
    if (result.accepted) {
      accepted.push(input);
    } else {
      const reason: RejectReason = result.reason ?? "off_topic";
      counts[reason] += 1;
      rejected.push({ input, reason });
    }
  }
  return { accepted, rejected, counts };
}

// ---------------------------------------------------------------------------
// Alt en castellano
// ---------------------------------------------------------------------------

interface AltEntry {
  re: RegExp;
  es: string;
}

/**
 * Sujeto principal del `alt`, en castellano. El orden importa: lo mas concreto
 * primero, para que `coffee shop` no acabe como «Café».
 *
 * Cada entrada solo se usa si su palabra ESTA en el `alt` original: no se anade
 * nada que la descripcion no diga.
 */
const ALT_MAIN: readonly AltEntry[] = [
  { re: termRegex(["conference room", "meeting room"]), es: "Sala de reuniones" },
  { re: termRegex(["coffee shop", "coffeehouse"]), es: "Interior de una cafetería" },
  { re: termRegex(["restaurant", "restaurants", "dining room"]), es: "Interior de un restaurante" },
  { re: termRegex(["cafe", "cafes"]), es: "Interior de una cafetería" },
  { re: termRegex(["bakery", "bakeries"]), es: "Interior de una panadería" },
  { re: termRegex(["kitchen", "kitchens"]), es: "Cocina" },
  { re: termRegex(["bar", "bars"]), es: "Barra de bar" },
  { re: termRegex(["counter", "counters"]), es: "Mostrador" },
  { re: termRegex(["clinic", "clinics"]), es: "Interior de una clínica" },
  { re: termRegex(["dental", "dentist", "dentists"]), es: "Consulta dental" },
  { re: termRegex(["hospital", "hospitals"]), es: "Interior de un hospital" },
  { re: termRegex(["salon", "salons", "barber", "barbers"]), es: "Interior de una peluquería" },
  { re: termRegex(["spa", "spas"]), es: "Interior de un spa" },
  { re: termRegex(["workshop", "workshops", "workbench", "workbenches"]), es: "Taller" },
  { re: termRegex(["garage", "garages"]), es: "Interior de un garaje" },
  { re: termRegex(["library", "libraries"]), es: "Interior de una biblioteca" },
  { re: termRegex(["reception", "lobby"]), es: "Recepción" },
  { re: termRegex(["office", "offices", "workspace", "workspaces"]), es: "Espacio de trabajo" },
  { re: termRegex(["shop", "shops", "store", "stores", "boutique", "boutiques"]), es: "Interior de una tienda" },
  { re: termRegex(["shelf", "shelves"]), es: "Estanterías" },
  { re: termRegex(["display", "displays"]), es: "Expositor" },
  { re: termRegex(["market", "markets"]), es: "Mercado" },
  { re: termRegex(["menu", "menus"]), es: "Carta del local" },
  { re: termRegex(["coffee"]), es: "Café" },
  { re: termRegex(["table", "tables"]), es: "Mesa" },
  { re: termRegex(["chair", "chairs"]), es: "Silla" },
  { re: termRegex(["desk", "desks"]), es: "Mesa de trabajo" },
  { re: termRegex(["books"]), es: "Libros" },
  { re: termRegex(["tools", "tool"]), es: "Herramientas" },
  { re: termRegex(["machine", "machines"]), es: "Máquina" },
  { re: termRegex(["equipment"]), es: "Equipo" },
  { re: termRegex(["mirror", "mirrors"]), es: "Espejo" },
  { re: termRegex(["computer", "computers", "laptop", "laptops"]), es: "Ordenador" },
  { re: termRegex(["notebook", "notebooks"]), es: "Cuaderno" },
  { re: termRegex(["plant", "plants"]), es: "Plantas" },
  { re: termRegex(["wood", "wooden"]), es: "Madera" },
];

/** Detalles que se pueden afirmar como complemento: «... con estanterías». */
const ALT_DETAIL: readonly AltEntry[] = [
  { re: termRegex(["shelf", "shelves"]), es: "estanterías" },
  { re: termRegex(["window", "windows"]), es: "ventana" },
  { re: termRegex(["plant", "plants"]), es: "plantas" },
  { re: termRegex(["books"]), es: "libros" },
  { re: termRegex(["computer", "computers", "laptop", "laptops"]), es: "ordenador" },
  { re: termRegex(["chair", "chairs"]), es: "sillas" },
  { re: termRegex(["table", "tables"]), es: "mesas" },
  { re: termRegex(["tools", "tool"]), es: "herramientas" },
  { re: termRegex(["mirror", "mirrors"]), es: "espejo" },
];

/**
 * ``alt`` en castellano, corto y neutro.
 *
 * Solo se afirma lo que la descripcion original dice: cada frase sale de una
 * palabra que esta en el `alt`. Si no se puede traducir con seguridad, o si el
 * original habla de personas o marcas, se devuelve la frase generica del
 * sector, que es cierta por construccion. Nunca devuelve cadena vacia.
 */
export function altFor(photo: UnsplashPhoto, sector: Sector): string {
  const key: Sector = sector && SECTOR_TERMS[sector] ? sector : "neutro";
  const fallback = SECTOR_FALLBACK_ALT[key];
  const alt = normalise(photo && typeof photo === "object" ? photo.alt : "");
  if (alt === "") return fallback;

  // Con personas o marcas no se traduce: quitar solo el trozo ofensivo dejaria
  // una frase que afirma otra cosa. La foto no deberia llegar aqui, pero `altFor`
  // no puede devolver un `alt` que mencione a alguien o una marca.
  if (hits(alt, PEOPLE_RE)) return fallback;
  if (brandHit(alt) !== undefined) return fallback;

  let main: string | undefined;
  for (const entry of ALT_MAIN) {
    if (entry.re.test(alt)) {
      main = entry.es;
      break;
    }
  }

  const details: string[] = [];
  const seen = new Set<string>(main === undefined ? [] : [stem(main)]);
  for (const entry of ALT_DETAIL) {
    if (details.length >= 2) break;
    if (!entry.re.test(alt)) continue;
    // Singular y plural son el mismo detalle: «Mesa con mesas» no se escribe.
    const key = stem(entry.es);
    if (seen.has(key)) continue;
    seen.add(key);
    details.push(entry.es);
  }

  if (main === undefined && details.length === 0) return fallback;
  const base = main ?? fallback;
  if (details.length === 0) return base;
  return `${base} con ${details.length === 2 ? `${details[0]} y ${details[1]}` : details[0]}`;
}
