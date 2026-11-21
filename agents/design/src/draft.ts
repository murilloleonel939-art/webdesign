import { validateSiteDocument, type Section, type SiteDocument } from "@webdesign/site-schema";
import { PENDING_MARKER, briefSentence, siteName, type QuickBrief } from "./brief.js";
import type { SiteCopy } from "./copy.js";
import { GALLERY_MIN, plannedTypes, planSections } from "./plan.js";

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

/** Una foto ya registrada en la biblioteca del sitio (`assetId` de la API). */
export interface PhotoRef {
  assetId: string;
  alt: string;
}

/** Fotos del borrador: hero opcional y galería de 3 a 4 (si no, no hay galería). */
export interface SitePhotos {
  hero?: PhotoRef;
  gallery: PhotoRef[];
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
// El plan pide el proceso como bloque `features` aparte, detras de las ventajas:
// en 6.1 no existe un tipo `process`, y ambas listas tienen la misma forma.
const PROCESS_ID = "s_process";

/** Titular del hero: solo hechos del brief, nunca una promesa inventada. */
export function heroHeadline(brief: QuickBrief): string {
  if (brief.name !== PENDING_MARKER) return cut(brief.name, 120);
  if (brief.businessType !== PENDING_MARKER && brief.city !== PENDING_MARKER) {
    return cut(`${brief.businessType} en ${brief.city}`, 120);
  }
  return PENDING_MARKER;
}

/**
 * Sección escrita con el copy del modelo (spec 9.1, `generate_copy`).
 *
 * El copy ya pasó por `guardCopy`, así que aquí no hay cifras ni premios
 * inventados. Testimonio y precio NO se escriben aunque el preset los pida: el
 * modelo no puede inventarlos y un marcador ahí solo ensucia la página.
 */
function copySection(type: string, id: string, brief: QuickBrief, copy: SiteCopy, photos: SitePhotos): Section | undefined {
  switch (type) {
    case "hero":
      return {
        id,
        type: "hero",
        props: {
          headline: copy.heroHeadline,
          ...(copy.heroSubline ? { subline: copy.heroSubline } : {}),
          cta: { label: copy.heroCta, href: CONTACT_HREF },
          ...(photos.hero ? { image: photos.hero.assetId } : {}),
        },
      };
    case "gallery":
      // La galería solo existe con fotos suficientes; si no, se omite entera.
      if (photos.gallery.length < GALLERY_MIN) return undefined;
      return { id, type: "gallery", props: { assetIds: photos.gallery.map((p) => p.assetId) } };
    case "features":
      // Sin servicios validos no hay tarjetas que escribir: la seccion se omite
      // en vez de rellenarse con el par "pendiente de confirmar".
      if (copy.services.length === 0) return undefined;
      return { id, type: "features", props: { heading: copy.servicesHeading, items: copy.services } };
    case "process":
      // Misma forma que `features`: en 6.1 no hay tipo propio para el proceso.
      if (copy.process.length === 0) return undefined;
      return { id: PROCESS_ID, type: "features", props: { heading: copy.processHeading, items: copy.process.slice(0, 4) } };
    case "text":
      // `about` sin texto propio: no se publica un parrafo vacio ni el marcador.
      if (copy.aboutBody === "") return undefined;
      return { id, type: "text", props: { heading: copy.aboutHeading, body: copy.aboutBody } };
    case "faq":
      // Menos de dos preguntas no es una sección: se omite entera.
      if (copy.faq.length < 2) return undefined;
      return { id, type: "faq", props: { items: copy.faq } };
    case "cta":
      return {
        id,
        type: "cta",
        props: { headline: copy.closingHeadline, cta: { label: copy.closingCta, href: CONTACT_HREF } },
      };
    case "contact":
      return { id, type: "contact", props: contactProps(brief) };
    case "testimonial":
    case "pricing":
      // Inventar un testimonio o un precio es justo lo que 9.1 prohíbe.
      return undefined;
    case "image":
      return undefined;
    default:
      // Cualquier otro tipo se escribe como `text` con el "sobre el negocio";
      // sin aboutBody no hay nada que escribir.
      if (copy.aboutBody === "") return undefined;
      return { id, type: "text", props: { heading: copy.aboutHeading, body: copy.aboutBody } };
  }
}

/**
 * Convierte un tipo del preset en una sección que el borrador puede sostener.
 *
 * `image` y `gallery` se omiten sin assets, y las secciones cuyo contenido solo
 * puede venir de datos que aún no existen se degradan a `text`.
 */
function draftSection(type: string, id: string, brief: QuickBrief, copy?: SiteCopy, photos?: SitePhotos): Section | undefined {
  if (copy !== undefined) return copySection(type, id, brief, copy, photos ?? { gallery: [] });
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
 * Nombre del sitio: el del dueño, el que dedujo el copy o el marcador.
 *
 * El orden importa: lo que escribió el dueño manda sobre lo que redactó el
 * modelo, que a su vez manda sobre el marcador. Nunca al revés.
 */
function docName(brief: QuickBrief, copy?: SiteCopy): string {
  if (brief.name !== PENDING_MARKER) return cut(siteName(brief), 80);
  const deduced = copy?.businessName?.trim();
  if (deduced !== undefined && deduced !== "") return cut(deduced, 80);
  return PENDING_MARKER;
}

/**
 * Construye y valida un `SiteDocument` a partir del brief y de un preset.
 *
 * Se valida antes de devolver: un borrador que no pasa `site-schema` no sale de
 * esta función, así que el agente nunca muta el sitio con algo inválido.
 */
export function draftSite(brief: QuickBrief, preset: Preset, copy?: SiteCopy, photos?: SitePhotos): SiteDocument {
  const sections: Section[] = [];
  const used = new Set<string>();
  const push = (type: string) => {
    let id = `s_${type}`;
    let n = 2;
    while (used.has(id)) id = `s_${type}_${n++}`;
    const section = draftSection(type, id, brief, copy, photos);
    if (!section) return;
    used.add(id);
    sections.push(section);
  };

  // El plan decide qué se escribe; el borrador no vuelve a decidirlo. Si lo
  // hiciera, `plan` y documento podrían discrepar y el dueño vería un plan que
  // no es el que se aplicó.
  for (const type of plannedTypes(planSections(brief, preset, copy, photos))) push(type);

  // Solo las fotos que el documento usa quedan registradas como assets.
  // El hero siempre lleva la foto cuando hay una (copySection la escribe).
  const usedPhotos: PhotoRef[] = [];
  if (photos?.hero && sections.some((s) => s.type === "hero")) usedPhotos.push(photos.hero);
  if (sections.some((s) => s.type === "gallery")) usedPhotos.push(...(photos?.gallery ?? []));

  const doc = {
    schemaVersion: 1 as const,
    // El nombre lo pone el dueño; si no lo dijo, el que dedujo el copy; si
    // tampoco hay, el marcador. Nunca un nombre inventado por el agente.
    meta: { name: docName(brief, copy), lang: "es" as const },
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
          title: cut(docName(brief, copy), 70),
          description: cut(copy?.seoDescription ?? `${brief.businessType} en ${brief.city}. ${brief.service}`, 160),
          noindex: false,
        },
        sections,
      },
    ],
    assets: usedPhotos.map((p) => ({ id: p.assetId, alt: p.alt })),
  };

  const check = validateSiteDocument(doc);
  if (!check.ok) throw new Error(`borrador invalido: ${check.errors.join("; ")}`);
  return check.doc;
}
