import { validateSiteDocument, type Section, type SiteDocument } from "@webdesign/site-schema";
import { PENDING_MARKER, containsMarker, siteName, type QuickBrief } from "./brief.js";
import type { SiteCopy } from "./copy.js";
import { briefValueOk } from "./copy.js";
import { genericCopy } from "./generic-copy.js";
import { GALLERY_MIN, MIN_METRICS, MIN_PLANS, MIN_TESTIMONIALS, completeCopy, ownerContact, plannedTypes, planSections } from "./plan.js";
import { classifyShape } from "./classify.js";

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
    case "testimonials": {
      // T-025: solo los testimonios que dio el dueño en su brief, tal cual. Sin
      // ellos no hay sección: no existe un testimonio «genérico» honesto.
      // `ownerProvided` es verdad porque el texto lo escribió él, no el modelo.
      const items = brief.proof?.testimonials ?? [];
      if (items.length < MIN_TESTIMONIALS) return undefined;
      return { id, type: "testimonials", props: { heading: "Opiniones", items: items.slice(0, 3), ownerProvided: true } };
    }
    case "pricing": {
      // T-025: precios del dueño, nunca de ejemplo. El preset de landing sigue
      // omitiendo `pricing` en el plan, así que esto solo lo pide la portada.
      const plans = brief.proof?.plans ?? [];
      if (plans.length < MIN_PLANS) return undefined;
      return { id, type: "pricing", props: { heading: "Precios", plans: plans.slice(0, 3) } };
    }
    case "metrics": {
      const items = brief.proof?.metrics ?? [];
      if (items.length < MIN_METRICS) return undefined;
      return { id, type: "metrics", props: { heading: "En cifras", items: items.slice(0, 4) } };
    }
    case "testimonial":
      // Inventar un testimonio es justo lo que 9.1 prohíbe.
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
 * Para `landing`: una sola página (`p_home`, `/`), idéntica al comportamiento
 * anterior. Para `site`: cuatro páginas según el contrato de T-003.3.
 *
 * Se valida antes de devolver: un borrador que no pasa `site-schema` no sale de
 * esta función, así que el agente nunca muta el sitio con algo inválido.
 */
export function draftSite(brief: QuickBrief, preset: Preset, copy?: SiteCopy, photos?: SitePhotos): SiteDocument {
  if (preset.id.trim() === "") throw new Error("draftSite: preset sin id");
  const { copy: text } = completeCopy(copy, brief);
  const shape = classifyShape(brief);
  const neutralName = cut(genericCopy(brief).heroHeadline, 80);
  const name = safeText(docName(brief, text), neutralName);
  const noPhotos: SitePhotos = { gallery: [] };

  const usedPhotos: PhotoRef[] = [];

  // Páginas interiores: hero sin foto (portada gráfica). La foto principal va
  // solo en la portada y la galería en /servicios: ninguna foto se repite.
  const innerPhotos: SitePhotos = { gallery: photos?.gallery ?? [] };

  function buildPage(id: string, slug: string, seoTitle: string, seoDesc: string, types: string[]): { id: string; slug: string; seo: { title: string; description: string; noindex: boolean }; sections: Section[] } {
    const sections: Section[] = [];
    const used = new Set<string>();
    const push = (type: string) => {
      let sid = `s_${type}`;
      let n = 2;
      while (used.has(sid)) sid = `s_${type}_${n++}`;
      const section = copySection(type, sid, brief, text, innerPhotos);
      if (!section) return;
      used.add(sid);
      sections.push(section);
    };
    for (const t of types) push(t);
    return {
      id,
      slug,
      seo: { title: cut(seoTitle, 70), description: cut(seoDesc, 160), noindex: false },
      sections,
    };
  }

  let pages: Array<{ id: string; slug: string; seo: { title: string; description: string; noindex: boolean }; sections: Section[] }>;

  if (shape === "landing") {
    // Landing: exactamente una página, misma lógica que antes.
    const sections: Section[] = [];
    const used = new Set<string>();
    const push = (type: string) => {
      let id = `s_${type}`;
      let n = 2;
      while (used.has(id)) id = `s_${type}_${n++}`;
      const section = copySection(type, id, brief, text, photos ?? noPhotos);
      if (!section) return;
      used.add(id);
      sections.push(section);
    };
    for (const t of plannedTypes(planSections(brief, preset, copy, photos))) push(t);

    if (photos?.hero && sections.some((s) => s.type === "hero")) usedPhotos.push(photos.hero);
    if (sections.some((s) => s.type === "gallery")) usedPhotos.push(...(photos?.gallery ?? []));

    pages = [{
      id: "p_home",
      slug: "/",
      seo: {
        title: cut(name, 70),
        description: cut(safeText(text.seoDescription, genericCopy(brief).seoDescription), 160),
        noindex: false,
      },
      sections,
    }];
  } else {
    // Site: cuatro páginas según T-003.3.
    // El hero de páginas distintas a la portada usa la etiqueta de la página
    // como titular. Si no llega al mínimo del esquema (8), se añade el nombre.
    const pageLabel = (label: string): string => {
      if (label.length >= 8) return label;
      return cut(`${label} · ${name}`, 120);
    };

    // Para cada página subinterna usamos un copy con heroHeadline sustituido
    // por la etiqueta, así `copySection("hero", ...)` escribe el título correcto.
    const textWith = (headline: string): SiteCopy => ({ ...text, heroHeadline: headline });

    const homeTypes = plannedTypes(planSections(brief, preset, copy, photos));
    const homeSections: Section[] = [];
    const usedH = new Set<string>();
    const pushH = (type: string) => {
      let id = `s_${type}`; let n = 2;
      while (usedH.has(id)) id = `s_${type}_${n++}`;
      const s = copySection(type, id, brief, text, photos ?? noPhotos);
      if (s) { usedH.add(id); homeSections.push(s); }
    };
    for (const t of homeTypes) pushH(t);
    if (photos?.hero && homeSections.some((s) => s.type === "hero")) usedPhotos.push(photos.hero);
    if (homeSections.some((s) => s.type === "gallery")) usedPhotos.push(...(photos?.gallery ?? []));

    const serviciosLabel = pageLabel("Servicios");
    const sobreLabel = pageLabel("Sobre nosotros");
    const contactoLabel = pageLabel("Contacto");

    pages = [
      {
        id: "p_home",
        slug: "/",
        seo: { title: cut(name, 70), description: cut(safeText(text.seoDescription, genericCopy(brief).seoDescription), 160), noindex: false },
        sections: homeSections,
      },
      buildPage("p_servicios", "/servicios", `Servicios — ${name}`, safeText(text.servicesHeading, "Servicios"), ["hero", "features", "process", "gallery", "cta"]),
      buildPage("p_sobre", "/sobre-nosotros", `Sobre nosotros — ${name}`, safeText(text.aboutHeading, "Sobre nosotros"), ["hero", "text", "faq"]),
      buildPage("p_contacto", "/contacto", `Contacto — ${name}`, "", ["hero", "contact"]),
    ];
    if (!homeSections.some((s) => s.type === "gallery") && pages[1]?.sections.some((s) => s.type === "gallery")) {
      usedPhotos.push(...(photos?.gallery ?? []));
    }
    // Sobrescribir el heroHeadline de las páginas subinternas: buildPage usa
    // el texto completo; reemplazamos las secciones hero con la etiqueta.
    for (const [pageIdx, label] of [[1, serviciosLabel], [2, sobreLabel], [3, contactoLabel]] as [number, string][]) {
      const pg = pages[pageIdx];
      if (!pg) continue;
      pg.sections = pg.sections.map((s) =>
        s.type === "hero"
          ? { ...s, props: { ...s.props as Record<string, unknown>, headline: cut(label, 120) } }
          : s,
      );
    }
  }

  const doc = {
    schemaVersion: 1 as const,
    meta: { name: safeText(docName(brief, text), neutralName), lang: "es" as const },
    design: {
      brief: safeText(designBrief(brief), ""),
      idea: safeText(preset.summary, ""),
      // La frase del dueño va aparte porque los otros dos campos no la guardan:
      // `brief` se compone con los campos y `idea` es el resumen del preset.
      // Sin esto, su burbuja en el chat mostraba "buffet de abogados en
      // barranquilla" en vez de la frase que escribió. `description` es el
      // `prompt` del panel, ya recortado a 500 por el servidor.
      ownerPrompt: safeText(brief.description ?? "", ""),
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
    pages,
    assets: usedPhotos.map((p) => (containsMarker(p.alt) ? { id: p.assetId } : { id: p.assetId, alt: p.alt })),
  };

  const check = validateSiteDocument(doc);
  if (!check.ok) throw new Error(`borrador invalido: ${check.errors.join("; ")}`);
  if (containsMarker(JSON.stringify(check.doc))) throw new Error("borrador invalido: contiene el marcador pendiente");
  return check.doc;
}
