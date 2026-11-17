import { validateSiteDocument, type Section, type SiteDocument } from "@webdesign/site-schema";
import { PENDING_MARKER, briefSentence, siteName, type QuickBrief } from "./brief.js";
import { plannedTypes, planSections } from "./plan.js";

// Borrador del modo rápido (spec 9.1, paso 6).
//
// El preset llega como DATO: no se consulta el catálogo ni se importa `platform`.
// Todo el contenido nace del brief del dueño. Lo que el brief no trae se queda
// con el marcador; lo que solo podría nacer de una invención (testimonios,
// ventajas, precios, preguntas frecuentes) NO se escribe: la sección se degrada
// a texto con el marcador, igual que hace `apps/platform/src/catalog.ts`.

/** Preset del catálogo tal como lo entrega el llamador. */
export const PRESET_SHAPE = "id,name,summary,keywords?,colors,typography,spacing,radius,sections";

export interface Preset {
  id: string;
  name: string;
  summary: string;
  keywords?: string[];
  colors: { ground: string; ink: string; accent: string };
  typography: { family: string; scale: string };
  spacing: { margin: number; sectionGap: number };
  radius: "square" | "rounded" | "pill";
  /** Tipos de sección del preset, en su orden. */
  sections: Array<{ type: string; variant?: string }>;
  dials?: { variance: number; motion: number; density: number };
}

const clamp = (n: unknown, min: number, max: number, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
};

const cut = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max).trimEnd());

// El marcador completo no cabe en `price` (máximo 20 caracteres en 6.1). Se
// recorta sin añadir ningún dato: sigue sin afirmar un precio.
const PENDING_PRICE = "pendiente";
const CONTACT_HREF = "#contacto";

/** Titular del hero: solo hechos del brief, nunca una promesa inventada. */
function heroHeadline(brief: QuickBrief): string {
  if (brief.name !== PENDING_MARKER) return cut(brief.name, 120);
  if (brief.businessType !== PENDING_MARKER && brief.city !== PENDING_MARKER) {
    return cut(`${brief.businessType} en ${brief.city}`, 120);
  }
  return PENDING_MARKER;
}

/**
 * Convierte un tipo del preset en una sección que el borrador puede sostener.
 *
 * `image` y `gallery` se omiten sin assets, y las secciones cuyo contenido solo
 * puede venir de datos que aún no existen se degradan a `text`.
 */
function draftSection(type: string, id: string, brief: QuickBrief): Section | undefined {
  switch (type) {
    case "hero":
      return {
        id,
        type: "hero",
        props: {
          headline: heroHeadline(brief),
          ...(brief.service !== PENDING_MARKER ? { subline: cut(brief.service, 240) } : {}),
          cta: { label: "Contactar", href: CONTACT_HREF },
        },
      };
    case "text":
      return { id, type: "text", props: { heading: brief.businessType, body: PENDING_MARKER } };
    case "pricing":
      // Nunca se heredan los precios del preset: no son del dueño.
      return {
        id,
        type: "pricing",
        props: { plans: [{ name: PENDING_MARKER, price: PENDING_PRICE, features: [] }] },
      };
    case "contact":
      return { id, type: "contact", props: contactProps(brief) };
    case "cta":
      return { id, type: "cta", props: { headline: PENDING_MARKER, cta: { label: "Contactar", href: CONTACT_HREF } } };
    case "features":
    case "testimonial":
    case "faq":
      // Ventajas, testimonios y preguntas: inventarlos es fabricar datos.
      return { id, type: "text", props: { heading: PENDING_MARKER, body: PENDING_MARKER } };
    case "image":
    case "gallery":
      return undefined; // sin assets propios no hay imagen que publicar
    default:
      return { id, type: "text", props: { body: PENDING_MARKER } };
  }
}

/** Contacto: solo se rellena con lo que el dueño escribió, tal cual. */
function contactProps(brief: QuickBrief): Record<string, unknown> {
  const raw = brief.contact;
  const props: Record<string, unknown> = { cta: { label: "Escribir", href: CONTACT_HREF } };
  if (raw !== PENDING_MARKER && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) props["email"] = raw;
  else if (raw !== PENDING_MARKER && /^[+\d][\d\s().-]{5,}$/.test(raw)) props["phone"] = cut(raw, 30);
  return props;
}

/**
 * Construye y valida un `SiteDocument` a partir del brief y de un preset.
 *
 * Se valida antes de devolver: un borrador que no pasa `site-schema` no sale de
 * esta función, así que el agente nunca muta el sitio con algo inválido.
 */
export function draftSite(brief: QuickBrief, preset: Preset): SiteDocument {
  const sections: Section[] = [];
  const used = new Set<string>();
  const push = (type: string) => {
    let id = `s_${type}`;
    let n = 2;
    while (used.has(id)) id = `s_${type}_${n++}`;
    const section = draftSection(type, id, brief);
    if (!section) return;
    used.add(id);
    sections.push(section);
  };

  // El plan decide qué se escribe; el borrador no vuelve a decidirlo. Si lo
  // hiciera, `plan` y documento podrían discrepar y el dueño vería un plan que
  // no es el que se aplicó.
  for (const type of plannedTypes(planSections(brief, preset))) push(type);

  const doc = {
    schemaVersion: 1 as const,
    meta: { name: siteName(brief), lang: "es" as const },
    design: {
      brief: briefSentence(brief),
      idea: preset.summary,
      // Un preset inventado no existe: si el id viene vacío se marca como pendiente.
      presetId: preset.id || PENDING_MARKER,
      dials: {
        variance: clamp(preset.dials?.variance, 0, 10, 4),
        motion: clamp(preset.dials?.motion, 0, 10, 4),
        density: clamp(preset.dials?.density, 0, 10, 5),
      },
    },
    theme: {
      colors: preset.colors,
      typography: { family: preset.typography.family, scale: preset.typography.scale },
      spacing: {
        margin: clamp(preset.spacing.margin, 0, 200, 48),
        sectionGap: clamp(preset.spacing.sectionGap, 0, 400, 64),
      },
      radius: preset.radius,
    },
    pages: [
      {
        id: "p_home",
        slug: "/",
        seo: {
          title: cut(siteName(brief), 70),
          description: cut(`${brief.businessType} en ${brief.city}. ${brief.service}`, 160),
          noindex: false,
        },
        sections,
      },
    ],
    assets: [],
  };

  const check = validateSiteDocument(doc);
  if (!check.ok) throw new Error(`borrador invalido: ${check.errors.join("; ")}`);
  return check.doc;
}
