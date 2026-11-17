import { JSDOM } from "jsdom";
import { contrastRatio, type LintFinding, type Severity } from "@webdesign/linter";
import { cssVariables, inlineStyles, parseCss, resolveVars, type Rule } from "./css.js";

// Linter visual (spec 6.5). Actua sobre el HTML ya renderizado, no sobre el
// documento JSON, porque hay defectos que solo existen en el resultado.
//
// Ninguna regla de aqui bloquea una publicacion pedida por el dueno: un `error`
// de 6.5 exige confirmacion, no impide publicar. El bloqueo duro es de 6.4.

export { parseCss, cssVariables, resolveVars, inlineStyles } from "./css.js";
export type { Rule } from "./css.js";

export interface VisualLintOptions {
  /** Entrada del catalogo aplicada; si definia pairing, la monocultura es defecto. */
  pairingExpected?: boolean;
  /** Ritmo vertical de la entrada, en px. Por debajo de esto el relleno aprieta. */
  rhythmPx?: number;
}

// Se reutiliza el contrato de 6.4 tal cual: la spec exige que ambas
// implementaciones compartan `LintFinding` para que ningun hallazgo dependa de
// un navegador salvo los que lo necesitan de verdad.
/** Semillas de la severidad por codigo, para que ninguna regla la improvise. */
const SEVERITY: Record<string, Severity> = {
  SLOP_FONT_MONOCULTURE: "warning",
  SLOP_GENERIC_GRADIENT: "warning",
  SLOP_NESTED_CARDS: "warning",
  SLOP_ICON_TILE_ABOVE_EVERY_HEADING: "info",
  SLOP_LOW_CONTRAST_TEXT_ON_COLOR: "error",
  SLOP_HEADING_SKIP: "error",
  SLOP_PADDING_CRAMPED: "warning",
  SLOP_CENTERED_EVERYTHING: "info",
  SLOP_SAME_CARD_RADIUS: "info",
  SLOP_SHADOW_ON_EVERYTHING: "warning",
  SLOP_NO_VISUAL_HIERARCHY: "error",
  SLOP_UNRESPONSIVE_GRID: "error",
  SLOP_FIXED_WIDTH_OVERFLOW: "error",
  SLOP_TOUCH_TARGET_SMALL: "warning",
  SLOP_PLACEHOLDER_TEXT: "warning",
  // Ampliacion de Fase 4. Foco invisible deja fuera a quien usa teclado: es
  // `error` (pide confirmacion, no bloquea). El movimiento es `warning`: es
  // calidad y salud, pero un sitio sigue siendo usable con ello.
  A11Y_NO_VISIBLE_FOCUS: "error",
  MOTION_LAYOUT_ANIMATION: "warning",
  MOTION_NO_REDUCED_MOTION: "warning",
  MOTION_DURATION_OUT_OF_RANGE: "info",
  // Ampliacion ui-skills (ver NOTICE): nombre accesible, etiquetas de campo,
  // texto de enlace y semantica de lista. Un control o un campo sin nombre
  // quedan inutilizables para quien no ve la pantalla: son `error`. El texto
  // de enlace y la lista sin semantica son calidad: `warning`.
  A11Y_CONTROL_NO_ACCESSIBLE_NAME: "error",
  A11Y_FIELD_UNLABELED: "error",
  A11Y_LINK_VAGUE_TEXT: "warning",
  A11Y_LIST_NOT_SEMANTIC: "warning",
  // Acento unico y escala de `z-index`: son tics de plantilla, no defectos de
  // uso. Avisan sin exigir confirmacion.
  SLOP_Z_INDEX_ARBITRARY: "warning",
  SLOP_MULTIPLE_ACCENTS: "info",
};

export function finding(code: string, message: string, extra: Partial<LintFinding> = {}): LintFinding {
  const severity = SEVERITY[code];
  if (!severity) throw new Error(`unknown visual rule: ${code}`);
  return { code, severity, message, autofixable: false, ...extra };
}

/** Los `data-section-id` permiten situar el hallazgo en una seccion concreta. */
function sectionOf(el: Element | null | undefined): string | undefined {
  const s = el?.closest?.("[data-section-id]");
  return s?.getAttribute("data-section-id") ?? undefined;
}

/**
 * Cascade minimo: jsdom no calcula estilos, asi que se aplica cada regla con
 * `querySelectorAll` y se acumulan las propiedades que interesan en orden de
 * aparicion, que es como el navegador resolveria a igual especificidad.
 */
export function computeStyles(doc: Document, rules: Rule[]): Map<Element, Record<string, string>> {
  const out = new Map<Element, Record<string, string>>();
  for (const rule of rules) {
    for (const raw of rule.selectors) {
      // Los pseudo-elementos no son seleccionables y harian fallar el motor.
      const selector = raw.replace(/::[a-z-]+(\([^)]*\))?/gi, "");
      if (!selector || selector.includes(":hover") || selector.includes(":focus")) continue;
      let matched: Element[];
      try {
        matched = Array.from(doc.querySelectorAll(selector));
      } catch {
        continue; // selector que jsdom no entiende: no aporta, no rompe
      }
      for (const el of matched) {
        const prev = out.get(el) ?? {};
        out.set(el, { ...prev, ...rule.decls });
      }
    }
  }
  // El atributo `style=` gana a cualquier regla de la hoja sin `!important`.
  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const prev = out.get(el) ?? {};
    out.set(el, { ...prev, ...inlineDecls(el) });
  }
  return out;
}

/** Declaraciones de un atributo `style=`, que no viven en la hoja. */
export function inlineDecls(el: Element): Record<string, string> {
  const attr = el.getAttribute?.("style");
  if (!attr) return {};
  const out: Record<string, string> = {};
  for (const part of attr.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (prop && value) out[prop] = value;
  }
  return out;
}

/** Primer color solido de un valor; `color-mix` y degradados no se resuelven. */
export function solidColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1]!;
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1]!, rgb[2]!, rgb[3]!].map((n) => Number(n).toString(16).padStart(2, "0"));
    return `#${r}${g}${b}`;
  }
  return undefined;
}

/** Numero con unidad a px. `rem`/`em` se aproximan a 16px porque sin layout no hay raiz. */
export function toPx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(-?[\d.]+)\s*(px|rem|em)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
}

/** Tamano relativo declarado, para comparar jerarquia sin resolver `calc`. */
export function relativeSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const calc = /calc\(\s*([\d.]+)\s*rem/.exec(value);
  if (calc) return Number(calc[1]);
  const px = toPx(value);
  return px === undefined ? undefined : px / 16;
}

export { contrastRatio, sectionOf };
