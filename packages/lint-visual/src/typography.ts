import { contrastRatio, finding, relativeSize, resolveVars, sectionOf, solidColor, toPx } from "./base.js";
import type { VisualLintOptions } from "./base.js";
import type { LintFinding } from "@webdesign/linter";

// Reglas de tipografia y color (spec 6.5).
// Todas son deterministas y sin coste de modelo.

export interface Ctx {
  doc: Document;
  styles: Map<Element, Record<string, string>>;
  vars: Record<string, string>;
  rules: import("./css.js").Rule[];
  /** CSS completo tal cual, para reglas que miran consultas de medios. */
  rawCss: string;
  opts: VisualLintOptions;
}

function styleOf(ctx: Ctx, el: Element): Record<string, string> {
  return ctx.styles.get(el) ?? {};
}

/**
 * SLOP_FONT_MONOCULTURE: mas del 60 % del texto en una unica tipografia
 * generica del sistema, cuando la entrada del catalogo definia pairing.
 *
 * Solo se evalua con `pairingExpected`: sin pairing declarado, una sola
 * tipografia es una decision legitima, no un tic.
 */
export function fontMonoculture(ctx: Ctx): LintFinding[] {
  if (!ctx.opts.pairingExpected) return [];
  const generics = ["serif", "sans-serif", "system-ui", "monospace", "-apple-system"];
  const families: string[] = [];
  const bodyFamily = styleOf(ctx, ctx.doc.body)["font-family"];
  if (bodyFamily) families.push(bodyFamily);
  for (const el of Array.from(ctx.doc.querySelectorAll("h1,h2,h3,p,li,a,blockquote"))) {
    const f = styleOf(ctx, el)["font-family"];
    if (f) families.push(f);
  }
  if (families.length === 0) return [];
  // La monocultura se mide sobre la familia dominante, no sobre la primera:
  // el body puede declarar una familia y los titulos otra.
  const firstOf = (f: string) => (f.split(",")[0] ?? "").trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const f of families) counts.set(firstOf(f), (counts.get(firstOf(f)) ?? 0) + 1);
  const [dominant, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (!generics.includes(dominant)) return [];
  if (hits / families.length <= 0.6) return [];
  return [finding("SLOP_FONT_MONOCULTURE", "single_generic_font_family", {
    fixHint: "apply_catalog_pairing",
  })];
}

/**
 * SLOP_GENERIC_GRADIENT: degradado de dos paradas en el rango violeta-azul por
 * defecto, sin relacion con la paleta de la entrada.
 *
 * Es el degradado de las plantillas genericas. Se mira el CSS emitido, no el
 * documento, porque el degradado puede venir del tema o de una seccion.
 */
export function genericGradient(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  for (const rule of ctx.rules) {
    const bg = rule.decls["background"] ?? rule.decls["background-image"];
    if (!bg || !bg.includes("gradient")) continue;
    const stops = bg.match(/#[0-9a-f]{3,6}|rgba?\([^)]*\)/gi) ?? [];
    if (stops.length < 2) continue;
    const colors = stops.map((s) => solidColor(s)).filter((c): c is string => !!c);
    if (colors.length < 2) continue;
    // Violeta-azul: el degradado tipico de plantilla va de azul a violeta, o
    // sea tono 220-285 (#2563eb es 221, #7c3aed es 262). Se calcula el tono
    // real en HSL; comparar canales a mano fallaba con ambos.
    const isVioletBlue = colors.slice(0, 2).every((c) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      // Gris puro: sin saturacion no hay violeta que detectar.
      if (d === 0) return false;
      const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (sat < 0.25) return false;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      return h >= 220 && h <= 285;
    });
    if (!isVioletBlue) continue;
    // Si coincide con la paleta del tema, no es generico: es la identidad.
    const accent = ctx.vars["--accent"]?.toLowerCase();
    if (accent && colors.some((c) => c.toLowerCase() === accent)) continue;
    out.push(finding("SLOP_GENERIC_GRADIENT", "generic_violet_gradient", {
      fixHint: "replace_with_palette_gradient",
    }));
    break; // un aviso por pagina basta para que el dueno lo vea
  }
  return out;
}

/**
 * SLOP_LOW_CONTRAST_TEXT_ON_COLOR: texto con contraste < 4.5:1 sobre fondo de
 * color. A diferencia de THEME_CONTRAST (6.4), aqui se mira el par efectivo
 * tras aplicar el CSS, no solo los tokens del tema.
 */
export function lowContrastOnColor(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(ctx.doc.querySelectorAll("h1,h2,h3,h4,p,li,a,blockquote,span"))) {
    const own = styleOf(ctx, el);
    const fg = solidColor(own["color"]);
    if (!fg) continue;
    // Subir hasta encontrar un fondo solido: el primer ancestro con color.
    let bg: string | undefined;
    let node: Element | null = el;
    while (node && !bg) {
      const s = styleOf(ctx, node);
      bg = solidColor(s["background-color"]) ?? solidColor(s["background"]);
      node = node.parentElement;
    }
    // Sin fondo declarado se asume el del body, que el tema siempre define.
    bg ??= solidColor(ctx.vars["--ground"]);
    if (!bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio >= 4.5) continue;
    const key = `${fg}|${bg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const section = sectionOf(el);
    out.push(finding("SLOP_LOW_CONTRAST_TEXT_ON_COLOR", "contrast_below_4_5", {
      fixHint: "raise_contrast",
      ...(section ? { sectionId: section } : {}),
    }));
  }
  return out;
}

// Colores que no son una eleccion de paleta: no cuentan como acento.
const NON_ACCENT = new Set(["transparent", "inherit", "currentcolor", "unset", "initial", "none"]);

/**
 * SLOP_MULTIPLE_ACCENTS: mas de un acento distinto en la misma pagina.
 *
 * Un acento pierde fuerza en cuanto hay dos: si el boton es azul, el enlace
 * morado y el CTA verde, nada destaca y la pagina parece cosida de trozos.
 *
 * Solo cuenta lo que el dueno ve como acento: el fondo de un boton o CTA y el
 * color del texto de un enlace. Con cero o uno no hay nada que reportar.
 */
export function multipleAccents(ctx: Ctx): LintFinding[] {
  const found = new Map<string, string>(); // color normalizado -> primer elemento
  const read = (el: Element, prop: string): string | undefined => {
    const raw = styleOf(ctx, el)[prop];
    if (!raw) return undefined;
    const value = resolveVars(raw, ctx.vars).trim().toLowerCase();
    if (!value || NON_ACCENT.has(value)) return undefined;
    return solidColor(value);
  };
  const push = (el: Element, color: string | undefined): void => {
    if (!color) return;
    if (!found.has(color)) found.set(color, sectionOf(el) ?? "page");
  };

  for (const el of Array.from(ctx.doc.querySelectorAll("button, [role=button], input[type=submit]"))) {
    push(el, read(el, "background-color") ?? read(el, "background"));
  }
  // Un enlace que se pinta como boton manda su fondo; uno normal, su tinta.
  for (const el of Array.from(ctx.doc.querySelectorAll("a[href]"))) {
    const bg = read(el, "background-color") ?? read(el, "background");
    if (bg) {
      push(el, bg);
      continue;
    }
    push(el, read(el, "color"));
  }
  if (found.size < 2) return [];

  // Un aviso por acento sobrante: el segundo color ya rompe la jerarquia, y el
  // `sectionId` dice donde aparece para que el dueno lo encuentre.
  const out: LintFinding[] = [];
  let first = true;
  for (const [, section] of found) {
    if (first) {
      first = false;
      continue;
    }
    out.push(finding("SLOP_MULTIPLE_ACCENTS", "more_than_one_accent_color", {
      fixHint: "use_single_accent",
      ...(section !== "page" ? { sectionId: section } : {}),
    }));
  }
  return out;
}

/**
 * SLOP_HEADING_SKIP: jerarquia que salta niveles (h1 -> h3).
 *
 * Se recorre el documento en orden y se compara con el ultimo nivel visto.
 */
export function headingSkip(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  let prev = 0;
  for (const el of Array.from(ctx.doc.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
    const level = Number(el.tagName.slice(1));
    if (prev !== 0 && level > prev + 1) {
      const section = sectionOf(el);
      out.push(finding("SLOP_HEADING_SKIP", "heading_level_skipped", {
        fixHint: "use_next_heading_level",
        ...(section ? { sectionId: section } : {}),
      }));
    }
    prev = level;
  }
  return out;
}

/**
 * SLOP_NO_VISUAL_HIERARCHY: ninguna diferencia de tamano entre h1, h2 y cuerpo.
 *
 * Sin layout, se comparan los tamanos declarados. El tema los define con
 * `calc(Nrem * s)`, asi que se lee el multiplicador.
 */
export function noVisualHierarchy(ctx: Ctx): LintFinding[] {
  const read = (sel: string) => {
    const el = ctx.doc.querySelector(sel);
    if (!el) return undefined;
    return relativeSize(styleOf(ctx, el)["font-size"]);
  };
  const h1 = read("h1");
  const h2 = read("h2");
  const body = relativeSize(styleOf(ctx, ctx.doc.body)["font-size"]);
  if (h1 === undefined && h2 === undefined) return [];
  // Se exige que h1 destaque sobre h2 y que h2 destaque sobre el cuerpo;
  // un 10 % de diferencia es indistinguible en pantalla.
  const ok = (a?: number, b?: number) => a === undefined || b === undefined || a >= b * 1.1;
  if (ok(h1, h2) && ok(h2, body)) return [];
  return [finding("SLOP_NO_VISUAL_HIERARCHY", "no_scale_difference", {
    fixHint: "increase_heading_scale",
  })];
}

/** SLOP_PADDING_CRAMPED: relleno interior por debajo del ritmo de la entrada. */
export function paddingCramped(ctx: Ctx): LintFinding[] {
  const rhythm = ctx.opts.rhythmPx;
  if (!rhythm) return [];
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const [el, decls] of ctx.styles) {
    const padding = decls["padding"];
    if (!padding) continue;
    // Solo el relleno uniforme en px es comparable sin layout.
    const px = toPx(padding);
    if (px === undefined || px >= rhythm * 0.5) continue;
    if (!el.matches("section,div,li,article,aside")) continue;
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding("SLOP_PADDING_CRAMPED", "padding_below_rhythm", {
      fixHint: "increase_padding",
      ...(section ? { sectionId: section } : {}),
    }));
  }
  return out;
}

/**
 * SLOP_TOUCH_TARGET_SMALL: objetivo tactil por debajo del minimo.
 *
 * El umbral depende del tipo de elemento. Un boton es un control y le
 * corresponde 44x44 (WCAG 2.5.5). Un enlace dentro de un parrafo es texto: la
 * spec pide 44, pero aplicarlo a todo marcaria cada enlace del sitio y el aviso
 * dejaria de leerse. Para texto se usa 24x24 (WCAG 2.5.8, nivel AA).
 */
export function touchTargetSmall(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  for (const el of Array.from(ctx.doc.querySelectorAll("a,button,[role=button]"))) {
    const s = styleOf(ctx, el);
    // Un control se reconoce porque tiene superficie propia o es un <button>.
    const isControl = el.tagName === "BUTTON"
      || !!s["background"] || !!s["background-color"] || !!s["border"] || !!s["min-height"];
    const min = isControl ? 44 : 24;

    const h = toPx(s["min-height"]) ?? toPx(s["height"]);
    const fs = toPx(s["font-size"]);
    // Sin `min-height`, se estima con el relleno vertical + linea de texto.
    // En `padding: .7em 1.3em` el primer valor es el vertical: leer el indice 1
    // daba el horizontal y marcaba como pequenos botones que no lo eran.
    const parts = (s["padding"] ?? "").trim().split(/\s+/).filter(Boolean);
    const padY = toPx(parts[0]);
    const estimate = h ?? (fs ?? 16) * 1.6 + (padY ?? 0) * 2;
    if (estimate >= min) continue;
    const section = sectionOf(el);
    out.push(finding("SLOP_TOUCH_TARGET_SMALL", "touch_target_too_small", {
      fixHint: "increase_tap_area",
      ...(section ? { sectionId: section } : {}),
    }));
  }
  return out;
}
