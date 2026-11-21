import { BRIEF_FIELDS, FIELD_LABEL, PENDING_MARKER, type BriefField, type QuickBrief } from "./brief.js";
import type { SiteCopy } from "./copy.js";
import type { Preset, SitePhotos } from "./draft.js";

/** Mínimo de fotos de la galería para que exista como sección. */
export const GALLERY_MIN = 3;

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

export interface PlannedSection {
  type: string;
  /** Tipo real que se escribirá: `degrade` lo cambia a `text`. */
  as: string;
  action: PlanAction;
  reason: string;
}

export interface Plan {
  presetId: string;
  sections: PlannedSection[];
}

/**
 * Decide qué hacer con cada sección del preset.
 *
 * Se degradan (`text`) las que solo pueden llenarse con datos que aún no
 * existen: ventajas, testimonios y preguntas. Se omiten las que necesitan un
 * asset propio. Escribir cualquiera de ellas sería inventar, que es justo lo que
 * 9.1 prohíbe.
 */
export function planSections(brief: QuickBrief, preset: Preset, copy?: SiteCopy, photos?: SitePhotos): Plan {
  const sections: PlannedSection[] = [];
  const galleryPhotos = photos?.gallery.length ?? 0;
  for (const s of preset.sections) {
  if (copy !== undefined) {
    // Con copy el plan cambia: lo que el modelo puede escribir con datos del
    // dueno se escribe; lo que solo existe si se inventa (testimonio, precio) se
    // omite. El plan tiene que decir lo mismo que el documento, o el dueno veria
    // un plan que no es el que se aplico.
    switch (s.type) {
      case "image":
        sections.push({ type: s.type, as: s.type, action: "omit", reason: "sin_assets_del_dueno" });
        break;
      case "gallery":
        sections.push(
          galleryPhotos >= GALLERY_MIN
            ? { type: s.type, as: "gallery", action: "write", reason: "fotos_de_la_busqueda" }
            : { type: s.type, as: s.type, action: "omit", reason: "sin_fotos_suficientes" },
        );
        break;
      case "features":
        // Sin servicios validos no hay ventajas que escribir: el borrador omite
        // la seccion y el plan lo dice igual, o el dueno veria un plan que no es
        // el que se aplico.
        sections.push(
          copy.services.length > 0
            ? { type: s.type, as: "features", action: "write", reason: "copy_del_dueno" }
            : { type: s.type, as: s.type, action: "omit", reason: "sin_servicios_del_dueno" },
        );
        // El proceso va siempre detras de las ventajas, como bloque propio, y se
        // omite con la misma regla que el borrador: sin pasos no hay seccion.
        sections.push(
          copy.process.length > 0
            ? { type: "process", as: "process", action: "write", reason: "copy_del_dueno" }
            : { type: "process", as: "process", action: "omit", reason: "sin_pasos_del_dueno" },
        );
        break;
      case "testimonial":
        sections.push({ type: s.type, as: s.type, action: "omit", reason: "testimonio_requiere_cliente_real" });
        break;
      case "pricing":
        sections.push({ type: s.type, as: s.type, action: "omit", reason: "precio_requiere_dato_del_dueno" });
        break;
      case "faq":
        sections.push(
          copy.faq.length >= 2
            ? { type: s.type, as: "faq", action: "write", reason: "copy_del_dueno" }
            : { type: s.type, as: s.type, action: "omit", reason: "sin_preguntas_del_dueno" },
        );
        break;
      case "hero":
        sections.push({ type: s.type, as: "hero", action: "write", reason: "copy_del_dueno" });
        break;
      default:
        // El resto se escribe como `text` con el "sobre el negocio": sin
        // aboutBody no hay texto y el borrador omite la seccion (draft.ts).
        // `contact` y `cta` no dependen de aboutBody: llevan sus propios props.
        sections.push(
          s.type !== "contact" && s.type !== "cta" && copy.aboutBody === ""
            ? { type: s.type, as: s.type, action: "omit", reason: "sin_about_del_dueno" }
            : { type: s.type, as: s.type, action: "write", reason: "copy_del_dueno" },
        );
    }
    continue;
  }
    switch (s.type) {
      case "image":
      case "gallery":
        sections.push({ type: s.type, as: s.type, action: "omit", reason: "sin_assets_del_dueno" });
        break;
      case "features":
        sections.push({ type: s.type, as: "text", action: "degrade", reason: "ventajas_requieren_datos_del_dueno" });
        break;
      case "testimonial":
        sections.push({ type: s.type, as: "text", action: "degrade", reason: "testimonio_requiere_cliente_real" });
        break;
      case "faq":
        sections.push({ type: s.type, as: "text", action: "degrade", reason: "preguntas_requieren_datos_del_dueno" });
        break;
      case "pricing":
        sections.push({ type: s.type, as: "pricing", action: "write", reason: "precio_queda_pendiente" });
        break;
      case "hero":
        sections.push({
          type: s.type,
          as: "hero",
          action: "write",
          reason: brief.name === PENDING_MARKER ? "titular_pendiente" : "titular_del_negocio",
        });
        break;
      default:
        sections.push({ type: s.type, as: s.type, action: "write", reason: "contenido_del_brief" });
    }
  }
  // Un preset sin galería no impide las fotos: la galería va tras los servicios y el proceso.
  const hasGallery = sections.some((s) => s.as === "gallery" && s.action === "write");
  if (copy !== undefined && galleryPhotos >= GALLERY_MIN && !hasGallery) {
    let at = 0;
    sections.forEach((s, i) => {
      if (s.as === "features" || s.as === "process") at = i + 1;
    });
    sections.splice(at, 0, { type: "gallery", as: "gallery", action: "write", reason: "fotos_de_la_busqueda" });
  }
  // Sin hero no hay h1 y 6.5 marca la jerarquía: se antepone uno.
  if (!sections.some((s) => s.type === "hero" && s.action === "write")) {
    sections.unshift({ type: "hero", as: "hero", action: "write", reason: "h1_obligatorio" });
  }
  return { presetId: preset.id, sections };
}

/** Los tipos que el borrador debe escribir, en orden y ya resueltos. */
export function plannedTypes(plan: Plan): string[] {
  return plan.sections.filter((s) => s.action !== "omit").map((s) => s.as);
}
