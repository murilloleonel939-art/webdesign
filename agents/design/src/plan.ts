import { BRIEF_FIELDS, FIELD_LABEL, PENDING_MARKER, type BriefField, type QuickBrief } from "./brief.js";
import type { SiteCopy } from "./copy.js";
import type { Preset, SitePhotos } from "./draft.js";
import { genericCopy } from "./generic-copy.js";
import { classifyShape, type SiteShape } from "./classify.js";

/** Mínimo de fotos de la galería para que exista como sección. */
export const GALLERY_MIN = 3;
/**
 * Las secciones de contenido que la página necesita sí o sí, en su orden
 * canónico (T-002.6). El preset decide estilo y orden preferido, no qué
 * contenido existe: si el copy lo sostiene, la sección va, haya hueco o no.
 */
const CANONICAL = ["features", "text", "process", "faq"] as const;

/** Mínimos de una sección publicable (criterio B2). */
export const MIN_SERVICES = 3;
export const MIN_PROCESS = 3;
export const MIN_FAQ = 2;

// Inventario y plan (spec 9.1: brief → inventario → recomendación → plan →
// checkpoint → construcción → validación).
//
// Los dos pasos son DATOS, no prosa del modelo. El inventario separa lo que el
// dueño afirmó de lo que falta; el plan decide qué secciones se van a escribir
// y por qué se descarta el resto. Si esta decisión la tomara el modelo, cada
// ejecución daría un plan distinto y el dueño no podría comparar dos borradores.

export type Known = { field: BriefField; label: string; value: string };
export type Missing = { field: BriefField; label: string };

export interface Inventory {
  /** Lo que el dueño dijo, literal. */
  known: Known[];
  /** Lo que falta. Nunca se rellena con una suposición. */
  missing: Missing[];
}

/**
 * Resultado de completar el copy (T-002.9).
 *
 * Separa el copy ya completo de las claves que vinieron de la plantilla y no del
 * modelo: `substituted` se consulta para asignar `origin` sin comparar textos,
 * que es lo que producía falsos `copy_generico` cuando el modelo coincidía por
 * casualidad con la plantilla (p. ej. CTA «Contactar»).
 */
export interface CompletedCopy {
  copy: SiteCopy;
  /** Claves de SiteCopy que vinieron de la plantilla y no del modelo. */
  substituted: ReadonlySet<keyof SiteCopy>;
}

/**
 * Completa por sección el copy del modelo con el genérico (T-002.3, criterio B2).
 *
 * El producto promete una página terminada, no una a medias. Si la guardia podó
 * tanto que una sección se queda por debajo del mínimo, la sección **entera** se
 * sustituye por la de `genericCopy`: nunca se mezcla un texto del modelo con uno
 * de plantilla dentro del mismo bloque. Una sección dicha mitad por el modelo y
 * mitad por plantilla se nota, y el visitante no sabría qué está leyendo.
 *
 * Mínimos: 3 servicios, 3 pasos de proceso, `aboutBody` no vacío y 2 preguntas.
 * El encabezado va con el cuerpo que lo acompaña: si los servicios (o los pasos)
 * son los genéricos, su encabezado también lo es. Los mínimos son los mismos que usa
 * `planSections`, así que plan y documento no pueden discrepar.
 *
 * Cuando `copy === undefined` se usa el genérico entero: todas las claves que
 * forman secciones quedan en `substituted`.
 *
 * Es idempotente: aplicarla sobre un copy ya completo no cambia nada.
 */
export function completeCopy(copy: SiteCopy | undefined, brief: QuickBrief): CompletedCopy {
  const generic = genericCopy(brief);
  const substituted = new Set<keyof SiteCopy>();

  if (copy === undefined) {
    // Sin copy del modelo: todo viene de la plantilla.
    for (const k of ["services", "servicesHeading", "aboutBody", "aboutHeading", "process", "processHeading", "faq",
                      "heroHeadline", "heroSubline", "heroCta", "closingHeadline", "closingCta"] as const) {
      substituted.add(k);
    }
    return { copy: generic, substituted };
  }

  const out: SiteCopy = { ...copy };
  if (copy.services.length < MIN_SERVICES) {
    out.services = generic.services;
    out.servicesHeading = generic.servicesHeading;
    substituted.add("services");
    substituted.add("servicesHeading");
  }
  // `aboutBody` vacío es lo que deja la guardia al podar: se repone entero.
  if (copy.aboutBody.trim() === "") {
    out.aboutBody = generic.aboutBody;
    out.aboutHeading = generic.aboutHeading;
    substituted.add("aboutBody");
    substituted.add("aboutHeading");
  }
  if (copy.process.length < MIN_PROCESS) {
    out.process = generic.process;
    out.processHeading = generic.processHeading;
    substituted.add("process");
    substituted.add("processHeading");
  }
  if (copy.faq.length < MIN_FAQ) {
    out.faq = generic.faq;
    substituted.add("faq");
  }
  return { copy: out, substituted };
}

/** Inventario del brief: qué sabemos y qué no, sin interpretar. */
export function inventory(brief: QuickBrief): Inventory {
  const known: Known[] = [];
  const missing: Missing[] = [];
  for (const field of BRIEF_FIELDS) {
    const value = brief[field];
    if (value === PENDING_MARKER) missing.push({ field, label: FIELD_LABEL[field] });
    else known.push({ field, label: FIELD_LABEL[field], value });
  }
  return { known, missing };
}

/** Por qué una sección se escribe, se degrada o se omite. */
export type PlanAction = "write" | "degrade" | "omit";

/**
 * De dónde sale el TEXTO de una sección (T-002.8). Solo depende del contenido,
 * nunca del preset: el mismo texto da el mismo origen con cualquier preset.
 */
export type SectionOrigin = "copy_del_dueno" | "copy_generico" | "contacto_del_dueno" | "contacto_generico";

export interface PlannedSection {
  type: string;
  /** Tipo real que se escribirá: `degrade` lo cambia a `text`. */
  as: string;
  action: PlanAction;
  /**
   * POR QUÉ la sección está (o no) en la página: `preset`, `completitud_*`,
   * `cierre_obligatorio`, `h1_obligatorio`, `fotos_de_la_busqueda` o el motivo
   * de una omisión. No dice de dónde sale el texto: eso es `origin`.
   */
  reason: string;
  /**
   * DE DÓNDE sale su texto. Solo en las secciones que se escriben y llevan texto
   * del copy o del contacto; la galería (fotos) y las omitidas no lo tienen.
   */
  origin?: SectionOrigin;
}

export interface PlannedPage {
  slug: string;
  title: string;
  sections: PlannedSection[];
}

export interface Plan {
  presetId: string;
  shape: SiteShape;
  pages: PlannedPage[];
}

/**
 * Decide qué hacer con cada sección del preset.
 *
 * Para `landing`, devuelve una página (`p_home`, `/`) con la lista de secciones
 * que ya producía antes. Para `site`, devuelve las cuatro páginas del contrato
 * T-003.3. En ambos casos el resultado es coherente con lo que `draftSite`
 * construirá: plan y documento no pueden discrepar.
 */
export function planSections(brief: QuickBrief, preset: Preset, copy?: SiteCopy, photos?: SitePhotos): Plan {
  const shape = classifyShape(brief);
  const { copy: text, substituted } = completeCopy(copy, brief);
  const galleryPhotos = photos?.gallery.length ?? 0;

  const write = (type: string, as: string, reason: string): PlannedSection => {
    const origin = originFromSet(as, substituted, brief);
    return origin === undefined ? { type, as, action: "write", reason } : { type, as, action: "write", reason, origin };
  };
  const omit = (type: string, reason: string): PlannedSection => ({ type, as: type, action: "omit", reason });

  // Construye la lista de secciones del preset (lógica preexistente).
  function buildPresetSections(): PlannedSection[] {
    const sections: PlannedSection[] = [];
    for (const s of preset.sections) {
      switch (s.type) {
        case "image":
          sections.push(omit(s.type, "sin_assets_del_dueno"));
          break;
        case "gallery":
          sections.push(galleryPhotos >= GALLERY_MIN ? write(s.type, "gallery", "fotos_de_la_busqueda") : omit(s.type, "sin_fotos_suficientes"));
          break;
        case "features":
          sections.push(text.services.length >= MIN_SERVICES ? write(s.type, "features", "preset") : omit(s.type, "sin_servicios_del_dueno"));
          sections.push(text.process.length >= MIN_PROCESS ? write("process", "process", "preset") : omit("process", "sin_pasos_del_dueno"));
          break;
        case "testimonial":
          sections.push(omit(s.type, "testimonio_requiere_cliente_real"));
          break;
        case "pricing":
          sections.push(omit(s.type, "precio_requiere_dato_del_dueno"));
          break;
        case "faq":
          sections.push(text.faq.length >= MIN_FAQ ? write(s.type, "faq", "preset") : omit(s.type, "sin_preguntas_del_dueno"));
          break;
        case "hero":
        case "contact":
        case "cta":
          sections.push(write(s.type, s.type, "preset"));
          break;
        default:
          sections.push(text.aboutBody === "" ? omit(s.type, "sin_about_del_dueno") : write(s.type, s.type, "preset"));
      }
    }
    const hasGallery = sections.some((s) => s.as === "gallery" && s.action === "write");
    if (galleryPhotos >= GALLERY_MIN && !hasGallery) {
      let at = 0;
      sections.forEach((s, i) => {
        if (s.as === "features" || s.as === "process") at = i + 1;
      });
      sections.splice(at, 0, write("gallery", "gallery", "fotos_de_la_busqueda"));
    }
    return closePlan(sections, text, write);
  }

  if (shape === "landing") {
    return {
      presetId: preset.id,
      shape,
      pages: [{ slug: "/", title: preset.id, sections: buildPresetSections() }],
    };
  }

  // shape === "site": cuatro páginas del contrato T-003.3.
  // Cada página lleva solo las secciones que el copy sostiene (completeCopy),
  // sin pricing ni testimonial, y sin el marcador.
  const makeSections = (...types: string[]): PlannedSection[] => {
    const result: PlannedSection[] = [];
    for (const t of types) {
      const supports = sectionSupported(t, text, galleryPhotos);
      if (supports) result.push(write(t, t, "preset"));
      // No se añade omit: en el plan de sitio las páginas ya están definidas,
      // no hay que justificar cada hueco al panel.
    }
    return result;
  };

  return {
    presetId: preset.id,
    shape,
    pages: [
      { slug: "/",              title: preset.id, sections: makeSections("hero", "features", "faq", "cta") },
      { slug: "/servicios",     title: "Servicios",       sections: makeSections("hero", "features", "process", "cta") },
      { slug: "/sobre-nosotros",title: "Sobre nosotros",  sections: makeSections("hero", "text", "faq") },
      { slug: "/contacto",      title: "Contacto",        sections: makeSections("hero", "contact") },
    ],
  };
}

/**
 * ¿El copy sostiene esta sección? Sin esto no se añade nada (T-002.6).
 *
 * Se pregunta al copy YA completado (`completeCopy`), que es el mismo que verá
 * el borrador: si dice que hay 3 servicios, hay sección de servicios.
 */
function supports(type: string, text: SiteCopy): boolean {
  switch (type) {
    case "features":
      return text.services.length >= MIN_SERVICES;
    case "text":
      return text.aboutBody.trim() !== "";
    case "process":
      return text.process.length >= MIN_PROCESS;
    case "faq":
      return text.faq.length >= MIN_FAQ;
    default:
      return false;
  }
}

/**
 * ¿Qué contacto del dueño se puede publicar? Correo o teléfono, tal cual.
 *
 * Una sola definición para el plan (que decide el `origin`) y el borrador (que
 * escribe la sección): si discreparan, el panel diría «contacto del dueño» sobre
 * una sección que sale sin datos.
 */
export function ownerContact(brief: QuickBrief): { email: string } | { phone: string } | undefined {
  const raw = brief.contact;
  if (raw === PENDING_MARKER || raw.trim() === "") return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { email: raw };
  if (/^[+\d][\d\s().-]{5,}$/.test(raw)) return { phone: raw.length <= 30 ? raw : raw.slice(0, 30).trimEnd() };
  return undefined;
}

/**
 * De dónde sale el texto de una sección (T-002.9).
 *
 * Se consulta `substituted`, el conjunto que `completeCopy` construyó al saber
 * exactamente qué claves sustituyó. No se compara texto: comparar producía falsos
 * `copy_generico` cuando el modelo coincidía por casualidad con la plantilla
 * (CTA «Contactar», titular corto igual al genérico).
 *
 * Hero: solo `copy_generico` si titular, subtítulo Y CTA vinieron todos de la
 * plantilla; si uno solo vino del modelo → `copy_del_dueno`.
 */
function originFromSet(type: string, substituted: ReadonlySet<keyof SiteCopy>, brief: QuickBrief): SectionOrigin | undefined {
  const sub = (k: keyof SiteCopy) => substituted.has(k);
  switch (type) {
    case "features":
      return sub("services") ? "copy_generico" : "copy_del_dueno";
    case "text":
      return sub("aboutBody") ? "copy_generico" : "copy_del_dueno";
    case "process":
      return sub("process") ? "copy_generico" : "copy_del_dueno";
    case "faq":
      return sub("faq") ? "copy_generico" : "copy_del_dueno";
    case "hero":
      // Solo genérico si LOS TRES campos vienen de la plantilla.
      return sub("heroHeadline") && sub("heroSubline") && sub("heroCta") ? "copy_generico" : "copy_del_dueno";
    case "cta":
      return sub("closingHeadline") || sub("closingCta") ? "copy_generico" : "copy_del_dueno";
    case "contact":
      return ownerContact(brief) === undefined ? "contacto_generico" : "contacto_del_dueno";
    default:
      // La galería lleva fotos, no texto: no tiene origen de texto.
      return undefined;
  }
}

/**
 * Cierra el plan: hero primero, contenido obligatorio, contacto y cierre al final.
 *
 * Es el arreglo de T-002.6. Antes se recorría el preset y solo se garantizaba
 * `hero`, así que un preset sin `text` entregaba la página sin presentación y
 * uno sin `features`, sin servicios ni pasos. El catálogo describe estilo; la
 * completitud no puede depender de que cada fila esté bien escrita.
 *
 * Reglas:
 *   - `hero` siempre primero.
 *   - Las canónicas que falten se añaden en orden features → text → process → faq
 *     (los pasos, detrás de los servicios), solo si el copy las sostiene.
 *   - `contact` y `cta` siempre al final, exista o no el preset.
 *   - Lo que el preset sí incluye conserva su posición relativa.
 *
 * Lo añadido aquí cambia el `reason` (por qué está), nunca el `origin` (de dónde
 * sale el texto), que `write` calcula igual que para las secciones del preset.
 */
function closePlan(
  sections: PlannedSection[],
  text: SiteCopy,
  write: (type: string, as: string, reason: string) => PlannedSection,
): PlannedSection[] {
  const hero = sections.find((s) => s.type === "hero" && s.action === "write") ?? write("hero", "hero", "h1_obligatorio");
  const content = sections.filter((s) => s !== hero && s.type !== "hero" && s.type !== "contact" && s.type !== "cta");
  const closing = sections.filter((s) => s.type === "contact" || s.type === "cta");
  const has = (type: string) => content.some((s) => s.type === type && s.action === "write");
  for (const type of CANONICAL) {
    if (has(type) || !supports(type, text)) continue;
    // El `reason` de completitud repite el origen, como pidió el contrato de
    // T-002.6: el panel lee de un vistazo que se añadió y de dónde sale.
    const added = write(type, type, "completitud");
    content.push({ ...added, reason: `completitud_${added.origin === "copy_del_dueno" ? "copy_del_dueno" : "copy_generico"}` });
  }
  const contact = closing.find((s) => s.type === "contact") ?? write("contact", "contact", "cierre_obligatorio");
  const cta = closing.find((s) => s.type === "cta") ?? write("cta", "cta", "cierre_obligatorio");
  return [hero, ...content, contact, cta];
}

/** Los tipos que el borrador debe escribir, en orden y ya resueltos. */
export function plannedTypes(plan: Plan): string[] {
  // Compatibilidad: para landing devuelve las secciones de la primera página.
  const first = plan.pages[0];
  if (!first) return [];
  return first.sections.filter((s) => s.action !== "omit").map((s) => s.as);
}

/**
 * ¿El copy sostiene esta sección para las páginas de sitio (T-003.3)?
 * Distinción respecto a `supports`: también acepta hero, contact y cta que
 * siempre se escriben, y gallery que depende de las fotos disponibles.
 */
function sectionSupported(type: string, text: SiteCopy, galleryPhotos: number): boolean {
  switch (type) {
    case "hero":
    case "contact":
    case "cta":
      return true;
    case "features":
      return text.services.length >= MIN_SERVICES;
    case "process":
      return text.process.length >= MIN_PROCESS;
    case "text":
      return text.aboutBody.trim() !== "";
    case "faq":
      return text.faq.length >= MIN_FAQ;
    case "gallery":
      return galleryPhotos >= GALLERY_MIN;
    default:
      return false;
  }
}
