import { BRIEF_FIELDS, FIELD_LABEL, PENDING_MARKER, type BriefField, type QuickBrief } from "./brief.js";
import type { Preset } from "./draft.js";

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
export function planSections(brief: QuickBrief, preset: Preset): Plan {
  const sections: PlannedSection[] = [];
  for (const s of preset.sections) {
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
