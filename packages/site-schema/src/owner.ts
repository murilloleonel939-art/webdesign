import type { Page, Section, SiteDocument } from "./index.js";

// Autoría del contenido (T-027).
//
// El agente de diseño no rediseña: reconstruye el documento entero desde el
// preset (`draftSite`). Sin una fusión, un rediseño borra lo que el dueño acababa
// de escribir en el panel —testimonios, precios, cifras, su titular, su teléfono—
// y eso no tiene vuelta atrás que el dueño sepa usar.
//
// Dos piezas y una sola idea: la autoría se MARCA cuando el dueño guarda
// (`markOwnerEdits`) y se RESPETA cuando el agente vuelve a generar
// (`mergeOwnerContent`). Ninguna de las dos adivina comparando textos a ojo: la
// marca la escribe el único que sabe quién guardó (el guardado del panel) y la
// fusión solo la lee.
//
// Lo que el dueño manda:
//   - `testimonials`, `testimonial`, `pricing` y `metrics` (T-025): nacen solo de
//     sus datos, así que se conservan enteras y nunca se inventan;
//   - el `email` y el `phone` del contacto;
//   - cada prop que él cambió a mano.
//
// Lo que manda el rediseño: estilo, orden, estructura y los textos que el dueño
// nunca tocó. La excepción está en `changeRequest`: cuando el dueño pide un
// cambio explícito en el chat, sus textos viejos no se conservan (si no, su
// petición no se aplicaría nunca).

/** Tipos que solo existen con datos del dueño: su contenido es suyo por definición. */
const OWNER_DATA_TYPES = new Set(["testimonials", "testimonial", "pricing", "metrics"]);

/**
 * Lo que hay que devolver a la página si el rediseño lo deja fuera.
 *
 * `testimonial` (en singular) no está: el agente no lo escribe nunca, así que
 * solo aparece si el dueño lo añadió, y en ese caso ya lo alcanza la fusión por
 * sección mientras el tipo siga en la página.
 */
const RESTORE_TYPES = new Set(["testimonials", "pricing", "metrics"]);

/** Datos de contacto que no se pierden aunque el brief nuevo no los traiga. */
const CONTACT_KEYS = ["email", "phone"] as const;

/** Delante de estos tipos se colocan los bloques recuperados: contacto y cierre van al final. */
const TAIL_TYPES = new Set(["contact", "cta"]);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Sección con sus marcas, sin dejar `ownerEdited` vacío en el documento. */
function withMarks(section: Section, marks: readonly string[] | undefined): Section {
  const clean = [...new Set(marks ?? [])];
  if (clean.length === 0) {
    // Sin marcas no se deja la clave puesta: un `ownerEdited: []` en cada
    // sección ensuciaría el documento y el hash del borrador.
    const copy: Section = { ...section };
    delete copy.ownerEdited;
    return copy;
  }
  return { ...section, ownerEdited: clean.sort() };
}

/** ¿Son la misma página? El id manda; el slug cubre un documento reconstruido. */
function findPage(pages: readonly Page[], target: Page): Page | undefined {
  return pages.find((p) => p.id === target.id) ?? pages.find((p) => p.slug === target.slug);
}

/**
 * Sección del documento anterior que corresponde a esta del nuevo.
 *
 * Primero por id, que es lo que asigna cada escritor (`s_hero`, `s_pricing`), y
 * solo si no hay por tipo, que es lo que salva el caso real: el panel crea la
 * sección con su propio id (`testimonials-1`) y el agente la reconstruye como
 * `s_testimonials`. Se consume cada anterior una vez para no emparejar los dos
 * bloques `features` de una página con el mismo anterior.
 */
function takePrevious(prevSections: readonly Section[], used: Set<number>, target: Section): Section | undefined {
  const byId = prevSections.findIndex((s, i) => !used.has(i) && s.id === target.id);
  const index = byId !== -1 ? byId : prevSections.findIndex((s, i) => !used.has(i) && s.type === target.type);
  if (index === -1) return undefined;
  used.add(index);
  return prevSections[index];
}

/**
 * Marca como del dueño los props que él escribió.
 *
 * Se llama desde el guardado del panel (`actorType: "user"`), con el documento
 * que había en la base: la diferencia entre los dos es la prueba de autoría.
 * No compara contra lo que el agente habría escrito —eso sería una heurística—
 * sino contra lo que había guardado, que es un hecho.
 *
 * Las marcas anteriores se conservan aunque el cliente no las mande: el editor
 * de Puck reenvía la página con lo que tiene en pantalla, y si la marca viviera
 * solo en el cliente el primer guardado la borraría.
 *
 * Un documento anterior ilegible no marca nada: mejor sin marca que una falsa.
 */
export function markOwnerEdits(previous: unknown, next: SiteDocument): SiteDocument {
  const prev = asDocument(previous);
  // Si el documento que llega tampoco se puede recorrer, se devuelve intacto: la
  // marca es una mejora del guardado, nunca una razón para que falle.
  if (!prev || !asDocument(next)) return next;
  return {
    ...next,
    pages: next.pages.map((nextPage) => {
      const prevPage = findPage(prev.pages, nextPage);
      if (!prevPage) {
        // Página nueva: la escribió el dueño entera.
        return { ...nextPage, sections: nextPage.sections.map((s) => withMarks(s, Object.keys(s.props))) };
      }
      return {
        ...nextPage,
        sections: nextPage.sections.map((nextSection) => {
          const prevSection = prevPage.sections.find((s) => s.id === nextSection.id);
          if (!prevSection) return withMarks(nextSection, Object.keys(nextSection.props));
          const marks = new Set(prevSection.ownerEdited ?? []);
          for (const [key, value] of Object.entries(nextSection.props)) {
            if (!same(value, prevSection.props[key])) marks.add(key);
          }
          return withMarks(nextSection, [...marks]);
        }),
      };
    }),
  };
}

export interface MergeOwnerOptions {
  /**
   * El dueño pidió un cambio explícito en esta ejecución (escribió en el
   * compositor del constructor). Entonces sus textos viejos no se conservan: si
   * se conservaran, "cambia el titular a X" no se aplicaría nunca. Sus datos
   * (testimonios, precios, cifras, contacto) sí: eso no se reescribe por chat.
   */
  changeRequest?: boolean;
}

/**
 * Funde un rediseño del agente con lo que el dueño ya había escrito.
 *
 * Devuelve un documento nuevo: no muta ninguno de los dos. Si no hay anterior
 * legible, devuelve el del agente tal cual (el primer diseño no tiene nada que
 * conservar y se comporta exactamente como antes de T-027).
 */
export function mergeOwnerContent(previous: unknown, next: SiteDocument, opts: MergeOwnerOptions = {}): SiteDocument {
  const prev = asDocument(previous);
  if (!prev) return next;
  const changeRequest = opts.changeRequest === true;

  // Bloques del dueño que viven en páginas que el rediseño ya no tiene (sitio de
  // cuatro páginas que pasa a landing, por ejemplo). Sin esto, cambiar de forma
  // se lleva por delante el contacto con precios de /contacto.
  const orphans = prev.pages
    .filter((p) => !next.pages.some((n) => n.id === p.id || n.slug === p.slug))
    .flatMap((p) => p.sections.filter((s) => RESTORE_TYPES.has(s.type)));
  const home = next.pages[0];

  return {
    ...next,
    pages: next.pages.map((nextPage) => {
      const prevPage = findPage(prev.pages, nextPage);
      let sections = prevPage ? mergePage(prevPage.sections, nextPage.sections, changeRequest) : nextPage.sections;
      if (nextPage.id === home?.id) {
        const extra = orphans.filter((s) => !sections.some((own) => own.type === s.type));
        if (extra.length > 0) sections = insertBeforeTail(sections, extra);
      }
      // `sections` es siempre otra lista cuando hay algo que fusionar: la del
      // rediseño se devuelve intacta si no.
      return sections === nextPage.sections ? nextPage : { ...nextPage, sections };
    }),
  };
}

/**
 * Fusión de una página: prop a prop en las secciones que existen en las dos, y
 * recuperación de los bloques de datos del dueño que el patrón nuevo no escribe.
 */
function mergePage(prevSections: readonly Section[], nextSections: readonly Section[], changeRequest: boolean): Section[] {
  const used = new Set<number>();
  const merged = nextSections.map((nextSection) => {
    const prevSection = takePrevious(prevSections, used, nextSection);
    return prevSection ? mergeSection(prevSection, nextSection, changeRequest) : nextSection;
  });
  const present = new Set(merged.map((s) => s.type));
  const restore = prevSections.filter((s) => RESTORE_TYPES.has(s.type) && !present.has(s.type));
  return restore.length === 0 ? merged : insertBeforeTail(merged, restore);
}

/** Una sección: los datos y los textos del dueño mandan sobre lo regenerado. */
function mergeSection(prev: Section, next: Section, changeRequest: boolean): Section {
  // Los bloques que solo existen con sus datos se conservan enteros: el agente
  // no puede escribirlos sin inventar, así que lo que hay es mejor que lo que
  // saldría de un brief vacío.
  if (OWNER_DATA_TYPES.has(next.type)) return withMarks({ ...next, props: { ...prev.props } }, prev.ownerEdited);

  const props: Record<string, unknown> = { ...next.props };
  if (next.type === "contact") {
    for (const key of CONTACT_KEYS) {
      if (prev.props[key] !== undefined) props[key] = prev.props[key];
    }
  }
  // Un cambio pedido en el chat caduca las marcas de texto: el valor nuevo es
  // del rediseño, y dejarlo marcado congelaría el titular para siempre.
  const marks = changeRequest ? [] : (prev.ownerEdited ?? []);
  for (const key of marks) if (key in prev.props) props[key] = prev.props[key];
  return withMarks({ ...next, props }, marks.filter((key) => key in prev.props));
}

/** Coloca los bloques recuperados justo antes del contacto y del cierre. */
function insertBeforeTail(sections: readonly Section[], extra: readonly Section[]): Section[] {
  const at = sections.findIndex((s) => TAIL_TYPES.has(s.type));
  const index = at === -1 ? sections.length : at;
  return [...sections.slice(0, index), ...extra, ...sections.slice(index)];
}

/**
 * El documento anterior, si sirve.
 *
 * Solo se comprueban páginas y secciones: la fusión no necesita validar el
 * entero (se lo va a validar `saveDraft`), pero sí saber que puede recorrerlo sin
 * romperse con un JSON viejo, un `{}` de las pruebas o basura de la base.
 */
function asDocument(value: unknown): SiteDocument | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const doc = value as SiteDocument;
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) return undefined;
  for (const page of doc.pages) {
    if (!page || !Array.isArray(page.sections)) return undefined;
    for (const section of page.sections) {
      if (!section || typeof section.type !== "string" || typeof section.props !== "object" || section.props === null) return undefined;
    }
  }
  return typeof doc.schemaVersion === "number" ? doc : undefined;
}
