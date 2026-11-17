import { JSDOM } from "jsdom";
import type { LintFinding } from "@webdesign/linter";
import { computeStyles, cssVariables, inlineStyles, parseCss } from "./base.js";
export { cssVariables, inlineStyles, parseCss, resolveVars } from "./base.js";
import type { VisualLintOptions } from "./base.js";
import type { Ctx } from "./typography.js";
import {
  fontMonoculture, genericGradient, headingSkip, lowContrastOnColor,
  multipleAccents, noVisualHierarchy, paddingCramped, touchTargetSmall,
} from "./typography.js";
import {
  controlNoAccessibleName, fieldUnlabeled, linkVagueText, listNotSemantic,
  motionDurationOutOfRange, motionLayoutAnimation, motionNoReducedMotion, noVisibleFocus,
} from "./a11y.js";
import {
  centeredEverything, fixedWidthOverflow, iconTileAboveHeadings, nestedCards,
  placeholderText, sameCardRadius, shadowOnEverything, unresponsiveGrid, zIndexArbitrary,
} from "./structure.js";

// Linter de calidad visual (spec 6.5). Actua sobre el HTML del release, justo
// despues de renderizar y antes del swap atomico (4.3).
//
// Determinista y sin coste de modelo: se ejecuta en `workers` y en CI.
// Ninguna regla de aqui bloquea una publicacion pedida por el dueno; un `error`
// exige confirmacion y queda registrado en `audit_log`.
//
// Origen: el conjunto se adapta de `impeccable` (Apache 2.0) y se reimplementa
// aqui para no depender de su CLI ni de su runtime. Ver NOTICE.

/** Orden de ejecucion; el resultado se ordena por severidad al final. */
const RULES = [
  fontMonoculture,
  genericGradient,
  lowContrastOnColor,
  headingSkip,
  noVisualHierarchy,
  paddingCramped,
  touchTargetSmall,
  nestedCards,
  iconTileAboveHeadings,
  centeredEverything,
  sameCardRadius,
  shadowOnEverything,
  unresponsiveGrid,
  fixedWidthOverflow,
  placeholderText,
  // Ampliacion de Fase 4 (ver NOTICE): accesibilidad y movimiento.
  noVisibleFocus,
  motionLayoutAnimation,
  motionNoReducedMotion,
  motionDurationOutOfRange,
  // Ampliacion ui-skills (ver NOTICE): semantica y nombres accesibles.
  controlNoAccessibleName,
  fieldUnlabeled,
  linkVagueText,
  listNotSemantic,
  multipleAccents,
  zIndexArbitrary,
];

const RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/**
 * Analiza el HTML de una pagina renderizada y devuelve los hallazgos de 6.5.
 *
 * `pageId` solo etiqueta los hallazgos: el HTML ya no sabe de paginas.
 */
export function lintHtml(html: string, pageId?: string, opts: VisualLintOptions = {}): LintFinding[] {
  if (!html || typeof html !== "string") return [];

  // `runScripts` fuera: el HTML del release es contenido no confiable y aqui no
  // se ejecuta nada. Sin script, sin red.
  const dom = new JSDOM(html, { runScripts: undefined, resources: undefined });
  const doc = dom.window.document;

  const rawCss = inlineStyles(html).join("\n");
  const { rules } = parseCss(rawCss);
  const ctx: Ctx = {
    doc,
    styles: computeStyles(doc, rules),
    vars: cssVariables(rawCss),
    rules,
    rawCss,
    opts,
  };

  const findings: LintFinding[] = [];
  for (const rule of RULES) {
    for (const f of rule(ctx)) findings.push(pageId ? { ...f, pageId } : f);
  }

  // Orden estable: severidad y luego codigo, para que la salida no dependa del
  // orden de recorrido del DOM.
  return findings.sort((a, b) => {
    const bySeverity = (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9);
    return bySeverity !== 0 ? bySeverity : a.code.localeCompare(b.code);
  });
}

/** Analiza todas las paginas de un release ya renderizado por `pageId`. */
export function lintRelease(pages: Map<string, string>, opts: VisualLintOptions = {}): LintFinding[] {
  const out: LintFinding[] = [];
  for (const [pageId, html] of pages) out.push(...lintHtml(html, pageId, opts));
  return out;
}

/**
 * Ningun `error` de 6.5 impide publicar: como mucho exige que el dueno
 * confirme. Esta funcion existe para que el panel sepa cuando pedir esa
 * confirmacion, y para que nadie la confunda con `blocksPublication` de 6.4.
 */
export function needsOwnerConfirmation(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
