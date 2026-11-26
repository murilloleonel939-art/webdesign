// Sector del negocio para la biblioteca de fotos (T-020).
//
// POR QUE EXISTE: el banco local guarda fotos ya verificadas por sector
// (`deploy/photo-bank/unsplash/<sector>/`). Sin esta pieza, la ruta de fotos
// tendria que adivinar el sector a partir de la consulta en ingles de Pexels, y
// una consulta generica devolveria fotos que no son del negocio del dueno.
//
// Misma tecnica que `classify.ts`: determinista, sin modelo, `\b` por palabra,
// sin acentos y con mayusculas indiferentes. La PRIMERA senal que coincide manda,
// en el orden de la tabla: es lo que hace que «buffet de abogados» sea despacho y
// no hosteleria.
//
// La tilde de la «ñ» NO se quita (a diferencia de `classify.ts`): «uñas» y
// «unas» no son la misma palabra, y «unas fotos» no es un salon de belleza.

import { PENDING_MARKER, type QuickBrief } from "./brief.js";

export type Sector = "despacho" | "hosteleria" | "comercio" | "salud" | "taller" | "belleza" | "neutro";

/** Lista cerrada de sectores: los mismos directorios que hay en el banco. */
export const SECTORS: readonly Sector[] = [
  "despacho",
  "hosteleria",
  "comercio",
  "salud",
  "taller",
  "belleza",
  "neutro",
];

/** Minusculas y sin acentos (la «ñ» se conserva). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\u006e\u0303/g, "\u00f1")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Tabla de senales, en el orden en que se prueban.
 *
 * Cada entrada es una RAIZ, no una palabra: `abogad` cubre «abogado»,
 * «abogados» y «abogacía». La mayoria se ancla solo al principio (`\babogad`)
 * porque la raiz sigue en la palabra; las de `WHOLE` se anclan a los dos lados
 * porque su forma corta aparece dentro de otra palabra castellana.
 */
const SIGNALS: ReadonlyArray<{ sector: Exclude<Sector, "neutro">; signals: readonly string[] }> = [
  {
    sector: "despacho",
    signals: ["abogad", "bufete", "buffet", "notar", "gestor", "asesor", "consultor", "fiscal", "contab", "juridi", "juridic"],
  },
  {
    sector: "salud",
    signals: ["dent", "clinic", "medic", "fisio", "psicolog", "veterinari", "farmaci", "optic", "salud"],
  },
  {
    sector: "belleza",
    signals: ["peluquer", "barber", "estetic", "uñas", "manicur", "maquillaj", "spa", "masaj"],
  },
  {
    sector: "hosteleria",
    signals: ["restaurant", "bar", "cafeter", "cafe", "pizzer", "hamburgues", "panader", "pasteler", "hotel", "hostal", "cocina", "food"],
  },
  {
    sector: "comercio",
    signals: ["tienda", "boutique", "moda", "ropa", "calzado", "joyer", "florister", "papeler", "bazar", "mercad", "supermerc", "comercio"],
  },
  {
    sector: "taller",
    signals: ["taller", "mecanic", "carpinter", "fontaner", "electric", "reforma", "obra", "construccion", "albañil", "pintor", "cerrajer"],
  },
];

/**
 * Senales cortas que solo valen como palabra completa.
 *
 * «bar» dentro de «barrio», «spa» dentro de «espagueti», «moda» dentro de
 * «modalidad»: las tres serian falsos positivos y la primera esta probada.
 */
const WHOLE = new Set(["bar", "spa", "moda", "obra", "uñas"]);

/** Escapa los caracteres especiales de regex de una senal. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Patron de una senal: palabra completa si esta en `WHOLE`, raiz si no. */
function signalPattern(signal: string): RegExp {
  const escaped = escapeRegExp(signal);
  return WHOLE.has(signal) ? new RegExp("\\b" + escaped + "\\b") : new RegExp("\\b" + escaped);
}

/** Patrones compilados una sola vez al cargar el modulo, en el orden de la tabla. */
const PATTERNS: ReadonlyArray<{ sector: Exclude<Sector, "neutro">; patterns: readonly RegExp[] }> = SIGNALS.map(
  (entry) => ({ sector: entry.sector, patterns: entry.signals.map((s) => signalPattern(normalize(s))) }),
);

/**
 * Sector del negocio a partir del brief.
 *
 * Mira los mismos cuatro campos que `classifyShape` —tipo de negocio, servicio,
 * texto libre y nombre— porque el dueño puede escribir la senal en cualquiera de
 * ellos. El marcador `pendiente de confirmar` no cuenta: no es una senal.
 *
 * Sin ninguna coincidencia devuelve `neutro`, el unico sector que no promete
 * nada sobre el negocio.
 */
export function sectorForBrief(brief: QuickBrief): Sector {
  const fields = [brief.businessType, brief.service, brief.description ?? "", brief.name]
    .filter((v) => v !== undefined && v !== PENDING_MARKER)
    .map(normalize)
    .join(" ");

  for (const { sector, patterns } of PATTERNS) {
    if (patterns.some((pattern) => pattern.test(fields))) return sector;
  }
  return "neutro";
}
