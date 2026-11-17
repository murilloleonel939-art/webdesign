// Tipografia y secciones: los dos sitios donde "usar el skill tal cual" rompe la
// plataforma en silencio.
//
// 1. Fuentes. El origen propone Playfair Display, Poppins, DM Sans... El renderer
//    solo resuelve pilas del SISTEMA (FAMILY_FALLBACK en theme-css.ts) y la CSP
//    del sitio no permite fuentes externas, a proposito: cargar Google Fonts
//    revelaria el sitio del cliente a un tercero. Una familia que no este en esa
//    tabla no da error: cae al sans por defecto y el diseno se pierde sin avisar.
//    Por eso aqui se traduce a familias CONOCIDAS y se declara el parecido.
//
// 2. Secciones. El origen describe ordenes como "Hero > Problem statement >
//    Solution overview > Testimonials carousel". La plataforma tiene 10 tipos
//    (SECTION_TYPES). Lo que no exista se descarta y se anota: no se inventan
//    tipos para que la fila entre.

import { SECTION_TYPES, type SectionType } from "@webdesign/site-schema";

// Familias que theme-css.ts sabe resolver. Se listan aqui a proposito en vez de
// importarlas: el renderer no las exporta, y este paquete no debe depender del
// renderer para construir datos. Si divergen, la prueba lo detecta.
export const KNOWN_FAMILIES = [
  "Inter",
  "Instrument Sans",
  "Libre Franklin",
  "Archivo",
  "Space Grotesk",
  "Nunito",
  "Serif",
  "Source Serif 4",
  "Fraunces",
  "Merriweather",
  "Mono",
] as const;

export type KnownFamily = (typeof KNOWN_FAMILIES)[number];

// Parecido por categoria. Playfair Display es un serif de contraste alto: la
// familia mas cercana que la plataforma sirve es Fraunces, no un sans.
const SERIF_NAMES = /playfair|merriweather|lora|libre baskerville|dm serif|cormorant|bitter|pt serif|noto serif|source serif|georgia|garamond|times|crimson|eb garamond|spectral|zilla|newsreader|literata/i;
const SLAB_SERIF_NAMES = /roboto slab|josefin slab|arvo|abril fatface/i;
const MONO_NAMES = /mono|code|consol|jetbrains|fira|source code|ibm plex mono|space mono/i;

// Familias geometricas/humanistas sin serif: todas caen en la pila sans del
// sistema, pero se distinguen para poder decir CUAL usar.
const GROTESK_NAMES = /space grotesk|archivo|instrument|libre franklin|work sans|manrope|sora|outfit|epilogue|plus jakarta/i;
const ROUNDED_NAMES = /nunito|quicksand|comfortaa|varela|baloo/i;

export interface FamilyMapping {
  family: KnownFamily;
  // Lo que se pierde al traducir. Se guarda para que el operador lo sepa.
  lost: string;
}

export function mapFamily(name: string): FamilyMapping | null {
  const raw = name.trim();
  if (!raw) return null;
  // Si ya es una de las nuestras, no hay nada que traducir.
  const exact = KNOWN_FAMILIES.find((f) => f.toLowerCase() === raw.toLowerCase());
  if (exact) return { family: exact, lost: "" };

  if (MONO_NAMES.test(raw)) return { family: "Mono", lost: `${raw}: sin webfont, se sirve la mono del sistema` };
  if (SERIF_NAMES.test(raw)) {
    // Fraunces es la serif de contraste alto; Merriweather la de texto corrido.
    const target: KnownFamily = /playfair|abril|dm serif|newsreader|spectral/i.test(raw) ? "Fraunces" : "Merriweather";
    return { family: target, lost: `${raw}: sin webfont, se sirve ${target} como equivalente` };
  }
  if (SLAB_SERIF_NAMES.test(raw)) return { family: "Source Serif 4", lost: `${raw}: sin webfont, se sirve Source Serif 4` };
  if (ROUNDED_NAMES.test(raw)) return { family: "Nunito", lost: `${raw}: sin webfont, se sirve Nunito` };
  if (GROTESK_NAMES.test(raw)) {
    const target: KnownFamily = /space grotesk/i.test(raw) ? "Space Grotesk" : /archivo/i.test(raw) ? "Archivo" : "Inter";
    return { family: target, lost: `${raw}: sin webfont, se sirve ${target}` };
  }
  return { family: "Inter", lost: `${raw}: sin webfont, se sirve Inter` };
}

// Escalas admitidas por el esquema y por scaleValue() de theme-css.ts.
export const SCALES = ["compact", "normal", "comfortable", "large", "xlarge"] as const;
export type Scale = (typeof SCALES)[number];

export function normalizeScale(scale: string | undefined): Scale {
  const s = (scale ?? "").trim().toLowerCase();
  if ((SCALES as readonly string[]).includes(s)) return s as Scale;
  return "normal";
}

export interface PairingIn {
  name: string;
  heading: string;
  body: string;
  category?: string | undefined;
}

export interface PairingOut {
  name: string;
  headingFamily: KnownFamily;
  bodyFamily: KnownFamily;
  scale: Scale;
  lost: string[];
}

// La categoria del origen ("Serif + Sans") orienta la escala: una pareja serif +
// sans pide titular grande para que el contraste se note.
export function normalizePairing(p: PairingIn): PairingOut | null {
  const h = mapFamily(p.heading);
  const b = mapFamily(p.body);
  if (!h || !b) return null;
  const cat = (p.category ?? "").toLowerCase();
  const scale: Scale = cat.includes("serif") ? "large" : "normal";
  const lost = [h.lost, b.lost].filter((x) => x !== "");
  return { name: p.name.trim(), headingFamily: h.family, bodyFamily: b.family, scale, lost };
}

// Secciones: se traduce el origen a los 10 tipos reales y se agrupan las que no
// existen. Lo importante es que la salida NUNCA contenga un tipo inventado: eso
// romperia el renderer al aplicar el patron.
const SECTION_HINTS: Array<{ match: RegExp; type: SectionType }> = [
  { match: /hero|headline|above the fold/i, type: "hero" },
  { match: /feature|benefit|value prop|solution overview|how it works/i, type: "features" },
  { match: /testimonial|review|social proof|quote|case stud/i, type: "testimonial" },
  { match: /pricing|plan|tier/i, type: "pricing" },
  { match: /faq|question|objection/i, type: "faq" },
  { match: /gallery|portfolio|showcase|photo/i, type: "gallery" },
  { match: /contact|form|lead|signup|waitlist/i, type: "contact" },
  { match: /cta|call to action|button/i, type: "cta" },
];
// "Footer" no se mapea a nada: la plataforma pinta el pie desde el propio layout,
// no es una seccion del documento. Mapearlo a `image` seria inventar un tipo y
// pintar una imagen donde el origen ponia un pie de pagina. Se descarta y queda
// anotado en `dropped`, que es la verdad.

export interface SectionsOut {
  sections: SectionType[];
  dropped: string[];
  verdict: { status: "active" | "supplemental"; reasons: string[] };
}

// El orden importa: es la composicion. Se mantiene el del origen y solo se
// descartan las entradas vacias.
export function normalizeSections(order: string): SectionsOut {
  const parts = order
    .split(/>|\||,|\u003e/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const out: SectionType[] = [];
  const dropped: string[] = [];
  for (const part of parts) {
    const hit = SECTION_HINTS.find((h) => h.match.test(part));
    if (!hit) {
      dropped.push(part);
      continue;
    }
    // Sin duplicados: dos "features" seguidos no aportan y el esquema no los
    // prohibe, pero repetir el mismo tipo deja un sitio monotono.
    if (out[out.length - 1] === hit.type) continue;
    out.push(hit.type);
  }
  const reasons: string[] = [];
  // Un patron sin hero no es una landing: entra como supplemental.
  if (!out.includes("hero")) reasons.push("el patron no incluye hero");
  if (out.length < 3) reasons.push("menos de 3 secciones reconocidas");
  // 6.2: 15 secciones por pagina como maximo.
  const sections = out.slice(0, 15);
  if (out.length > 15) reasons.push(`recortado de ${out.length} a 15 secciones`);
  return {
    sections,
    dropped,
    verdict: { status: reasons.length ? "supplemental" : "active", reasons },
  };
}

// Cinturon de seguridad: nada que no sea un tipo real sale de este paquete.
export function assertKnownSections(list: string[]): SectionType[] {
  return list.filter((t): t is SectionType => (SECTION_TYPES as readonly string[]).includes(t));
}
