import { PENDING_MARKER, type QuickBrief } from "./brief.js";

// Clasificador de forma del sitio (T-003.3).
//
// Determinista y sin modelo: decide entre landing y sitio de varias paginas
// segun el brief. Las senales de oferta unica ganan a las de negocio con areas.
// Si no hay senal de ninguna, se asume landing: es la forma mas simple y la que
// no depende de que el brief este completo.

export type SiteShape = "landing" | "site";

/** Normaliza: minusculas y sin acentos. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Senales de oferta unica: si aparece alguna, es landing (regla 1). */
const LANDING_SIGNALS = [
  "curso",
  "masterclass",
  "ebook",
  "e-book",
  "lanzamiento",
  "evento",
  "webinar",
  "reserva",
  "reservar",
  "descarga",
  "descargar",
  "suscribete",
  "captar clientes",
  "promocion",
  "oferta",
  "taller intensivo",
];

/** Senales de negocio con varias areas: si aparece alguna (y ninguna de arriba), es site (regla 2). */
const SITE_SIGNALS = [
  "restaurante",
  "bar",
  "cafeteria",
  "clinica",
  "dental",
  "consultorio",
  "despacho",
  "abogad",
  "asesoria",
  "gestoria",
  "taller",
  "estudio",
  "academia",
  "escuela",
  "colegio",
  "gimnasio",
  "peluqueria",
  "tienda",
  "boutique",
  "hotel",
  "hostal",
  "agencia",
  "inmobiliaria",
  "constructora",
  "farmacia",
  "veterinaria",
  "optica",
];

/** Escapa los caracteres especiales de regex de una señal. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Patrón de palabra completa para una señal; `abogad` es raíz, solo ancla al inicio. */
function wordPattern(signal: string): RegExp {
  const escaped = escapeRegExp(signal);
  if (signal === "abogad") return new RegExp("\\b" + escaped);
  return new RegExp("\\b" + escaped + "\\b");
}

/** Patrones de señales de oferta única, compilados una vez al cargar el módulo. */
const LANDING_PATTERNS = LANDING_SIGNALS.map(wordPattern);

/** Patrones de señales de negocio con varias áreas, compilados una vez al cargar el módulo. */
const SITE_PATTERNS = SITE_SIGNALS.map(wordPattern);

/**
 * Clasifica la forma del sitio a partir del brief.
 *
 * Orden de las reglas:
 * 1. Señal de oferta única → landing.
 * 2. Señal de negocio con varias áreas → site.
 * 3. Sin señal → landing (forma predeterminada).
 */
export function classifyShape(brief: QuickBrief): SiteShape {
  const fields = [brief.businessType, brief.service, brief.description ?? "", brief.name]
    .filter((v) => v !== undefined && v !== PENDING_MARKER)
    .map(normalize)
    .join(" ");

  if (LANDING_PATTERNS.some((pattern) => pattern.test(fields))) return "landing";
  if (SITE_PATTERNS.some((pattern) => pattern.test(fields))) return "site";
  return "landing";
}
