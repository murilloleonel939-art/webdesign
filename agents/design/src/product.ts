import { readFileSync } from "node:fs";

import { PENDING_MARKER, type QuickBrief } from "./brief.js";

// Producto y patrón de portada a partir del brief (T-025).
//
// POR QUÉ EXISTE: la portada se componía con una tabla fija y una clínica dental
// recibía lo mismo que un restaurante. `design-intelligence.json` (T-024) dice,
// por tipo de producto, qué patrón de landing convierte y qué contenido importa.
// Aquí se elige el producto y el patrón; `plan.ts` traduce sus secciones a los
// tipos de `site-schema` y decide cuáles se pueden escribir sin inventar.
//
// Misma técnica que `classify.ts` y `sector.ts`: determinista, sin modelo,
// palabra completa o raíz, sin acentos y sin distinguir mayúsculas.

export interface Product {
  id: string;
  label: string;
  keywords: string[];
  landingPattern: string;
  considerations: string[];
}

export interface Pattern {
  id: string;
  label: string;
  sections: string[];
  aliases: string[];
}

interface DesignIntelligence {
  products: Product[];
  patterns: Pattern[];
}

let cache: DesignIntelligence | undefined;

/** Carga perezosa: 338 KB que solo hacen falta al componer la portada. */
function data(): DesignIntelligence {
  if (cache === undefined) {
    // `dist/product.js` y `src/product.ts` están ambos a un nivel de `data/`.
    const raw = readFileSync(new URL("../data/design-intelligence.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as DesignIntelligence;
    cache = { products: parsed.products, patterns: parsed.patterns };
  }
  return cache;
}

/**
 * Respaldo cuando no hay producto o su patrón no resuelve (48 de 194).
 *
 * `Hero + Features + CTA` es el patrón más general del catálogo: no pide nada
 * que dependa de datos del dueño (testimonios, precios, cifras) y todas sus
 * secciones se escriben con el copy que ya tenemos. Elegir uno de prueba social
 * para un negocio desconocido dejaría huecos que no se pueden llenar sin mentir.
 */
export const FALLBACK_PATTERN_ID = "hero-features-cta";

/** Minúsculas y sin acentos (como `classify.ts`). */
function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Puente español → palabras clave del catálogo (que están en inglés).
 *
 * Raíz española (anclada al inicio de palabra) → keywords que añade. Sin esto
 * «clínica dental» o «cafetería» no casarían con nada: el catálogo dice
 * `dental`, `clinic`, `cafe`. Se mantiene corta y a mano: cada entrada es un
 * negocio local de los que ya reconocen `classify.ts` y `sector.ts`.
 */
const ES_TO_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // «dent» a secas casaría con «dentro»: se usan las dos raíces reales.
  ["dental", ["dental"]],
  ["dentist", ["dental"]],
  ["odontolog", ["dental"]],
  ["clinic", ["clinic"]],
  ["medic", ["medical"]],
  ["veterinari", ["veterinary"]],
  ["restaurant", ["restaurant"]],
  ["cafeter", ["cafe"]],
  ["panader", ["bakery"]],
  ["pasteler", ["bakery"]],
  ["abogad", ["legal", "law"]],
  ["bufete", ["legal", "law"]],
  ["juridic", ["legal"]],
  ["hotel", ["hotel"]],
  ["hostal", ["hotel"]],
  ["peluquer", ["salon", "beauty"]],
  ["estetic", ["beauty", "aesthetic"]],
  ["spa", ["spa"]],
  ["masaj", ["massage"]],
  ["gimnasio", ["gym", "fitness"]],
  ["fontaner", ["plumber"]],
  ["electricist", ["electrician"]],
  ["inmobiliari", ["real-estate", "property"]],
  ["construc", ["construction"]],
  ["arquitect", ["architecture"]],
  ["fotograf", ["photography"]],
  ["guarderi", ["childcare", "daycare"]],
  ["farmaci", ["pharmacy"]],
  ["florister", ["florist"]],
  ["concesionari", ["dealership"]],
  ["residencia", ["elderly"]],
  ["tienda", ["shop", "store"]],
];

/** Palabras del catálogo que no identifican un producto («e» de e-commerce). */
const STOP = new Set(["e", "app", "the", "and", "a", "de", "real", "list", "buy"]);

/** Términos del brief: palabras normalizadas + keywords del puente español. */
function briefTerms(brief: QuickBrief): Set<string> {
  const text = [brief.businessType, brief.service, brief.description ?? "", brief.name]
    .filter((v) => v !== PENDING_MARKER)
    .map(normalize)
    .join(" ");
  const terms = new Set<string>(text.split(/[^a-z0-9-]+/).filter((w) => w !== "" && !STOP.has(w)));
  for (const [root, keywords] of ES_TO_KEYWORDS) {
    if (new RegExp("\\b" + root).test(text)) for (const k of keywords) terms.add(k);
  }
  return terms;
}

/**
 * Producto del catálogo que mejor casa con el brief, o `undefined`.
 *
 * Puntuación: cada keyword del producto presente en el brief suma `1 / df`,
 * donde `df` es en cuántos productos aparece. Así «dental» (1 producto) pesa más
 * que «clinic» (3) y «clínica dental» es `dental-practice`, no `medical-clinic`.
 * Empate → el primero en el orden del catálogo. Determinista.
 */
export function productForBrief(brief: QuickBrief): Product | undefined {
  const { products } = data();
  const terms = briefTerms(brief);
  if (terms.size === 0) return undefined;
  const df = new Map<string, number>();
  for (const p of products) for (const k of new Set(p.keywords)) df.set(k, (df.get(k) ?? 0) + 1);
  let best: Product | undefined;
  let bestScore = 0;
  for (const p of products) {
    let score = 0;
    for (const k of new Set(p.keywords)) {
      if (!STOP.has(k) && terms.has(k)) score += 1 / (df.get(k) ?? 1);
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Patrón por id (para el respaldo y las pruebas). */
export function patternById(id: string): Pattern | undefined {
  return data().patterns.find((p) => p.id === id);
}

export interface ResolvedPattern {
  pattern: Pattern;
  /** `exacto`: label o alias; `parcial`: una parte del `A + B`; `respaldo`: no resolvió. */
  match: "exacto" | "parcial" | "respaldo";
}

/**
 * Resuelve el `landingPattern` del producto contra `label` ∪ `aliases`.
 *
 * 1. Coincidencia exacta (sin distinguir mayúsculas) con label o alias.
 * 2. Si el nombre es compuesto («Hero-Centric Design + Conversion»), cada parte
 *    por orden: la primera que resuelve manda (es la dominante del catálogo).
 * 3. Si nada resuelve, o no hay producto: `FALLBACK_PATTERN_ID`.
 */
export function patternFor(product: Product | undefined): ResolvedPattern {
  const { patterns } = data();
  const index = new Map<string, Pattern>();
  for (const p of patterns) {
    index.set(normalize(p.label).trim(), p);
    for (const a of p.aliases) index.set(normalize(a).trim(), p);
  }
  if (product !== undefined) {
    const exact = index.get(normalize(product.landingPattern).trim());
    if (exact) return { pattern: exact, match: "exacto" };
    for (const part of product.landingPattern.split("+")) {
      const hit = index.get(normalize(part).trim());
      if (hit) return { pattern: hit, match: "parcial" };
    }
  }
  const fallback = patternById(FALLBACK_PATTERN_ID);
  if (!fallback) throw new Error(`design-intelligence: falta el patrón de respaldo ${FALLBACK_PATTERN_ID}`);
  return { pattern: fallback, match: "respaldo" };
}

/**
 * Sección del patrón → tipo del plan (los de `planSections`: `process` es un
 * `features` aparte y `gallery` sale de las fotos).
 *
 * `null` = no tenemos tipo equivalente: la sección se omite con aviso.
 * `footer` no está: el pie lo pinta siempre el renderer, fuera del documento.
 */
export const PATTERN_SECTION_TYPE: Readonly<Record<string, string | null>> = {
  hero: "hero",
  intro: "text",
  description: "text",
  problem: "text",
  about: "text",
  "value-prop": "text",
  "chapter-1": "text",
  "chapter-2": "text",
  "chapter-3": "text",
  features: "features",
  benefits: "features",
  solution: "features",
  details: "features",
  "how-it-works": "process",
  "step-1": "process",
  "step-2": "process",
  "step-3": "process",
  journey: "process",
  testimonials: "testimonials",
  reviews: "testimonials",
  "social-proof": "testimonials",
  ratings: "testimonials",
  proof: "testimonials",
  trust: "testimonials",
  metrics: "metrics",
  pricing: "pricing",
  faq: "faq",
  projects: "gallery",
  transformation: "gallery",
  contact: "contact",
  form: "contact",
  cta: "cta",
  purchase: "cta",
  comparison: null,
  "product-demo": null,
  "lead-magnet": null,
  screenshots: null,
  preview: null,
  interactive: null,
  tour: null,
  speakers: null,
  agenda: null,
  sponsors: null,
  categories: null,
  members: null,
  listings: null,
  archives: null,
  author: null,
  learn: null,
  "speaker-bio": null,
  urgency: null,
  "solutions-industry": null,
  "solutions-role": null,
  logos: null,
  specs: null,
};

/**
 * Consideraciones del producto → tipo del plan. Lo que la ficha dice que
 * importa en ese negocio («Patient testimonials», «Online booking»,
 * «Insurance»). Primer patrón que casa, en orden. Lo que no casa no añade nada
 * (p. ej. «Friendly imagery» es estilo, no contenido).
 */
const CONSIDERATION_TYPE: ReadonlyArray<readonly [RegExp, string]> = [
  [/testimonial|review|social proof|wall of love/i, "testimonials"],
  [/pric|package|plans?\b|tiers?\b/i, "pricing"],
  [/case results|statistic|metric|achievement/i, "metrics"],
  [/before\/after|portfolio|gallery/i, "gallery"],
  [/booking|reservation|ordering|contact|location/i, "contact"],
  [/insurance|faq|emergency info/i, "faq"],
  [/how it works|process|steps?\b/i, "process"],
  [/profiles|about|story/i, "text"],
  [/services?\b|menu|practice areas|amenit/i, "features"],
];

export function considerationType(consideration: string): string | undefined {
  for (const [re, type] of CONSIDERATION_TYPE) if (re.test(consideration)) return type;
  return undefined;
}
