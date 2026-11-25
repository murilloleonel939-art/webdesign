import { validateSiteDocument, type Section, type SiteDocument } from "@webdesign/site-schema";
import { PENDING_MARKER, containsMarker, siteName, type QuickBrief } from "./brief.js";
import type { SiteCopy } from "./copy.js";
import { briefValueOk } from "./copy.js";
import { genericCopy } from "./generic-copy.js";
import { GALLERY_MIN, completeCopy, ownerContact, plannedTypes, planSections } from "./plan.js";

// Borrador del modo rápido (spec 9.1, paso 6).
//
// El preset llega como DATO: no se consulta el catálogo ni se importa `platform`.
// El contenido sale SIEMPRE de un copy: el del modelo (ya pasado por la guardia)
// o, si no lo hay, `genericCopy(brief)`, que solo dice lo que el brief sabe y
// rellena el resto con frases que no afirman ningún hecho del negocio (T-002.3).
// Ningún camino escribe el marcador `pendiente de confirmar` en el documento:
// lo que falta lo pide el panel a partir de `pending`, no la página publicada.
// Testimonio y precio se siguen omitiendo: no hay forma de escribirlos sin
// inventar, y un precio inventado es peor que no tener sección.

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

/** ¿El dueño dio este dato, o el brief lo dejo con el marcador? */
const known = (value: string): boolean => value !== PENDING_MARKER && value.trim() !== "";

const CONTACT_HREF = "#contacto";
// El plan pide el proceso como bloque `features` aparte, detras de las ventajas:
// en 6.1 no existe un tipo `process`, y ambas listas tienen la misma forma.
const PROCESS_ID = "s_process";

/**
 * Titular del hero: solo hechos del brief, nunca una promesa inventada.
 *
 * El nombre del dueño manda tal cual, aunque sea corto. Si no lo hay, el tipo
 * con la ciudad. Si tampoco, el titular de `genericCopy`, que baja por los
 * textos fijados en el contrato de T-002.2 y nunca devuelve el marcador.
 */
export function heroHeadline(brief: QuickBrief): string {
  // El predicado de la guardia se aplica ANTES de interpolar (T-002.4, Fix D):
  // esta función es el respaldo del titular en `guardCopy`, y sin el filtro
  // restauraba el reclamo que la guardia acababa de podar ("taller certificado
  // en Bilbao" volvía al hero por esta vía).
  if (briefValueOk(brief.name, brief)) return cut(brief.name, 120);
  if (briefValueOk(brief.businessType, brief) && briefValueOk(brief.city, brief)) {
    return cut(`${brief.businessType} en ${brief.city}`, 120);
  }
  return cut(genericCopy(brief).heroHeadline, 120);
}

/**
 * Sección escrita con el copy del modelo (spec 9.1, `generate_copy`).
 *
 * El copy ya pasó por `guardCopy`, así que aquí no hay cifras ni premios
 * inventados. Testimonio y precio NO se escriben aunque el preset los pida: el
 * modelo no puede inventarlos y un marcador ahí solo ensucia la página.
 */
function buildSection(type: string, id: string, brief: QuickBrief, copy: SiteCopy, photos: SitePhotos): Section | undefined {
  switch (type) {
    case "hero":
      return {
        id,
        type: "hero",
        props: {
          // Recorte al máximo de la sección (T-002.7, Fix E): un titular compuesto
          // por tipo y ciudad largos superaba los 120 del esquema y abortaba la
          // ejecución entera. `cut` no puede bajar del mínimo de 8 del copy.
          headline: cut(copy.heroHeadline, 120),
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
      // `completeCopy` ya garantiza el mínimo; la guarda queda por si alguien
      // llama a `copySection` con un copy sin completar.
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
 * Red final del marcador (T-002.4, Fix A): ningún texto del documento lo lleva.
 *
 * Las capas anteriores ya lo filtran (`normalizeBrief`, `guardCopy`,
 * `briefValueOk`), pero confiar solo en ellas fue justo el fallo: un
 * `aboutBody` con "Horario pendiente de confirmar." atravesaba la guardia porque
 * no era el valor exacto. Aquí, pase lo que pase antes, la sección que lo
 * contuviera se rehace entera con el copy genérico, y si tampoco así queda
 * limpia, se omite. No se publica nunca.
 */
function copySection(type: string, id: string, brief: QuickBrief, copy: SiteCopy, photos: SitePhotos): Section | undefined {
  const direct = buildSection(type, id, brief, copy, photos);
  if (direct === undefined || !hasMarker(direct)) return direct;
  const fallback = buildSection(type, id, brief, genericCopy(brief), photos);
  if (fallback === undefined || hasMarker(fallback)) return undefined;
  return fallback;
}

/** ¿Algún texto de esta sección contiene el marcador? */
function hasMarker(section: Section): boolean {
  return containsMarker(JSON.stringify(section.props));
}

/** Texto publicable: si contiene el marcador, se cae al respaldo neutro. */
function safeText(value: string, fallback: string): string {
  return containsMarker(value) ? fallback : value;
}

/**
 * Contacto: solo se rellena con lo que el dueño escribió, tal cual.
 *
 * La validación vive en `ownerContact` (plan.ts) porque el plan necesita el
 * mismo juicio para decidir el `origin` (T-002.8). Una sola definición: si aquí
 * y allí discreparan, el panel diría «contacto del dueño» sobre una sección que
 * sale sin datos.
 */
function contactProps(brief: QuickBrief): Record<string, unknown> {
  const props: Record<string, unknown> = { cta: { label: "Escribir", href: CONTACT_HREF } };
  const contact = ownerContact(brief);
  if (contact === undefined) return props;
  if ("email" in contact) props["email"] = contact.email;
  else props["phone"] = contact.phone;
  return props;
}

/**
 * Nombre del sitio: el del dueño, el que dedujo el copy o el titular.
 *
 * El orden importa: lo que escribió el dueño manda sobre lo que redactó el
 * modelo, y eso sobre el titular derivado del brief. Nunca al revés. El último
 * escalón ya no es el marcador: `meta.name` es el título de la pestaña y del
 * SEO, y "pendiente de confirmar" ahí es justo lo que T-002 quita.
 */
function docName(brief: QuickBrief, copy: SiteCopy): string {
  // El nombre que escribió el dueño se conserva tal cual, aunque lleve un
  // reclamo: es un dato identificativo, no una afirmación nuestra (decisión del
  // lead en T-002.5, documentada en un ADR).
  if (known(brief.name)) return cut(siteName(brief), 80);
  // El nombre que dedujo el modelo pasa por la misma guardia (T-002.7, Fix C):
  // si reclama algo ("Café nº1 de Valencia") no se convierte en el nombre
  // público del sitio. Sin este filtro, el dueño sin nombre veía publicado el
  // reclamo que la guardia acababa de podar del copy.
  const deduced = copy.businessName?.trim();
  if (deduced !== undefined && deduced !== "" && briefValueOk(deduced, brief)) return cut(deduced, 80);
  return cut(heroHeadline(brief), 80);
}

/**
 * Frase del brief que se guarda en `design.brief`: solo lo que el dueño dijo.
 *
 * Sustituye aqui a `briefSentence` (brief.ts), que interpola el marcador en
 * cada hueco ("pendiente de confirmar en pendiente de confirmar"). `design.brief`
 * viaja dentro del documento entregado, asi que tambien cuenta para B1. Si el
 * dueño no dio ningun campo, se guarda su descripcion libre o nada.
 */
function designBrief(brief: QuickBrief): string {
  const parts: string[] = [];
  const place = [brief.businessType, brief.city].filter(known);
  if (place.length > 0) parts.push(place.join(" en "));
  if (known(brief.name)) parts.push(`nombre: ${brief.name}`);
  if (known(brief.service)) parts.push(`servicio: ${brief.service}`);
  if (known(brief.contact)) parts.push(`contacto: ${brief.contact}`);
  if (parts.length === 0 && brief.description !== undefined) parts.push(brief.description);
  return parts.join("; ").slice(0, 500);
}

/**
 * Construye y valida un `SiteDocument` a partir del brief y de un preset.
 *
 * Se valida antes de devolver: un borrador que no pasa `site-schema` no sale de
 * esta función, así que el agente nunca muta el sitio con algo inválido.
 */
export function draftSite(brief: QuickBrief, preset: Preset, copy?: SiteCopy, photos?: SitePhotos): SiteDocument {
  // Un preset sin id es un error del llamador (el catálogo siempre lo trae), no
  // un dato del dueño que se pueda dejar "pendiente". Se corta aquí, en vez de
  // escribir el marcador en `design.presetId`.
  if (preset.id.trim() === "") throw new Error("draftSite: preset sin id");
  // Sin copy del modelo, el copy genérico. Con copy, `completeCopy` repone por
  // sección lo que la guardia dejó por debajo del mínimo (T-002.3): nunca se
  // mezcla un texto del modelo con uno de plantilla dentro del mismo bloque.
  const { copy: text } = completeCopy(copy, brief);
  const sections: Section[] = [];
  const used = new Set<string>();
  // Respaldo neutro para el nombre: el titular del copy genérico, que ya filtra
  // cada dato del brief con la guardia y nunca lleva el marcador.
  const neutralName = cut(genericCopy(brief).heroHeadline, 80);
  const push = (type: string) => {
    let id = `s_${type}`;
    let n = 2;
    while (used.has(id)) id = `s_${type}_${n++}`;
    const section = copySection(type, id, brief, text, photos ?? { gallery: [] });
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
    // tampoco hay, el titular del brief. Nunca un nombre inventado por el agente.
    // Red final (Fix A): con el marcador dentro, el titular genérico.
    meta: { name: safeText(docName(brief, text), neutralName), lang: "es" as const },
    design: {
      // Con el marcador dentro no se guarda: es un campo libre y vacío es válido.
      brief: safeText(designBrief(brief), ""),
      idea: safeText(preset.summary, ""),
      presetId: preset.id,
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
          title: cut(safeText(docName(brief, text), neutralName), 70),
          description: cut(safeText(text.seoDescription, genericCopy(brief).seoDescription), 160),
          noindex: false,
        },
        sections,
      },
    ],
    // El `alt` llega del proveedor de fotos: con el marcador dentro se omite (es
    // opcional en 6.1), no se publica.
    assets: usedPhotos.map((p) => (containsMarker(p.alt) ? { id: p.assetId } : { id: p.assetId, alt: p.alt })),
  };

  const check = validateSiteDocument(doc);
  if (!check.ok) throw new Error(`borrador invalido: ${check.errors.join("; ")}`);
  // Última comprobación, sin excepciones: si algo se escapó de todo lo anterior,
  // el borrador no sale. Fallar aquí es preferible a entregar el marcador (B1).
  if (containsMarker(JSON.stringify(check.doc))) throw new Error("borrador invalido: contiene el marcador pendiente");
  return check.doc;
}
