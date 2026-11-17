import type { LintFinding } from "@webdesign/linter";
import { finding, sectionOf, toPx } from "./base.js";
import type { Ctx } from "./typography.js";

// Reglas de estructura y contenido (spec 6.5).

function styleOf(ctx: Ctx, el: Element): Record<string, string> {
  return ctx.styles.get(el) ?? {};
}

/**
 * SLOP_NESTED_CARDS: tarjeta dentro de tarjeta dentro de tarjeta.
 *
 * Se define "tarjeta" por lo que la hace tal sin layout: fondo propio y
 * borde o sombra. Tres niveles anidados es el tic de las plantillas que
 * envuelven todo en un panel.
 */
export function nestedCards(ctx: Ctx): LintFinding[] {
  const isCard = (el: Element) => {
    const s = styleOf(ctx, el);
    const hasSurface = !!s["background"] || !!s["background-color"];
    const hasEdge = !!s["border"] || !!s["border-radius"] || !!s["box-shadow"];
    return hasSurface && hasEdge;
  };
  let worst = 0;
  let where: string | undefined;
  for (const el of Array.from(ctx.doc.querySelectorAll("section div, section li, section article"))) {
    let depth = 0;
    let node: Element | null = el;
    while (node) {
      if (isCard(node)) depth++;
      node = node.parentElement;
    }
    if (depth > worst) {
      worst = depth;
      where = sectionOf(el);
    }
  }
  if (worst < 3) return [];
  return [finding("SLOP_NESTED_CARDS", "three_nested_cards", {
    fixHint: "remove_one_card_level",
    ...(where ? { sectionId: where } : {}),
  })];
}

/**
 * SLOP_ICON_TILE_ABOVE_EVERY_HEADING: el mismo patron decorativo sobre mas de
 * 3 titulares.
 *
 * Sin captura, el patron se reconoce por estructura: un elemento decorativo
 * hermano inmediatamente anterior al titular, repetido.
 */
export function iconTileAboveHeadings(ctx: Ctx): LintFinding[] {
  const decorations: { section: string | undefined; sig: string }[] = [];
  for (const h of Array.from(ctx.doc.querySelectorAll("h2,h3"))) {
    const prev = h.previousElementSibling;
    if (!prev) continue;
    // El tile se reconoce por tener fondo o borde y nada de texto propio.
    const s = styleOf(ctx, prev);
    const hasSurface = !!s["background"] || !!s["background-color"] || !!s["border-radius"];
    const empty = (prev.textContent ?? "").trim() === "";
    if (!hasSurface || !empty) continue;
    decorations.push({
      section: sectionOf(h),
      sig: `${prev.tagName}.${prev.className}`,
    });
  }
  if (decorations.length <= 3) return [];
  // Solo cuenta si es el *mismo* patron repetido, no decoraciones distintas.
  const counts = new Map<string, number>();
  for (const d of decorations) counts.set(d.sig, (counts.get(d.sig) ?? 0) + 1);
  if (Math.max(...counts.values()) <= 3) return [];
  return [finding("SLOP_ICON_TILE_ABOVE_EVERY_HEADING", "repeated_decoration_above_headings", {
    fixHint: "vary_section_openers",
  })];
}

/** SLOP_CENTERED_EVERYTHING: todo centrado sin variacion de alineacion. */
export function centeredEverything(ctx: Ctx): LintFinding[] {
  const aligned: string[] = [];
  for (const el of Array.from(ctx.doc.querySelectorAll("section h1,section h2,section p,section li"))) {
    const ta = styleOf(ctx, el)["text-align"];
    if (ta) aligned.push(ta);
  }
  // Sin declaraciones propias se mira el body, que el tema no centra.
  const bodyAlign = styleOf(ctx, ctx.doc.body)["text-align"];
  const all = bodyAlign ? [...aligned, bodyAlign] : aligned;
  if (all.length < 4) return [];
  if (!all.every((a) => a === "center")) return [];
  return [finding("SLOP_CENTERED_EVERYTHING", "no_alignment_variation", {
    fixHint: "vary_alignment",
  })];
}

/** SLOP_SAME_CARD_RADIUS: un unico radio en todos los contenedores. */
export function sameCardRadius(ctx: Ctx): LintFinding[] {
  const radii = new Set<string>();
  let containers = 0;
  for (const [el, decls] of ctx.styles) {
    const r = decls["border-radius"];
    if (!r) continue;
    if (!el.matches("section div,section li,section article,section img,section button,section a")) continue;
    containers++;
    radii.add(r.trim());
  }
  // Con menos de cuatro contenedores no hay patron que juzgar.
  if (containers < 4) return [];
  // El tema usa `var(--radius)` en todos: eso es una decision del sistema de
  // diseno, no una plantilla repetida. Solo se avisa si ademas todo comparte
  // radio siendo elementos que no lo pedirian (imagenes y botones incluidos).
  if (radii.size !== 1) return [];
  const only = [...radii][0]!;
  if (only.includes("var(")) return [];
  return [finding("SLOP_SAME_CARD_RADIUS", "single_radius_everywhere", {
    fixHint: "vary_radius_by_role",
  })];
}

/** SLOP_SHADOW_ON_EVERYTHING: sombra en mas del 80 % de los bloques. */
export function shadowOnEverything(ctx: Ctx): LintFinding[] {
  const blocks = Array.from(ctx.doc.querySelectorAll("section div,section li,section article"));
  if (blocks.length < 5) return [];
  const withShadow = blocks.filter((el) => !!styleOf(ctx, el)["box-shadow"]).length;
  if (withShadow / blocks.length <= 0.8) return [];
  return [finding("SLOP_SHADOW_ON_EVERYTHING", "shadow_on_most_blocks", {
    fixHint: "use_shadow_sparingly",
  })];
}

/**
 * SLOP_UNRESPONSIVE_GRID: rejilla de mas de 2 columnas que no colapsa por
 * debajo de 768 px.
 *
 * Se satisface con `auto-fit`/`auto-fill`, que colapsan solas, o con una
 * consulta de medios que declare una sola columna.
 */
export function unresponsiveGrid(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const media = ctx.rules.filter((r) => r.selectors.length > 0);
  void media;
  // Consultas de 768px declaradas en la hoja.
  const hasCollapse = /@media[^{]*max-width:\s*(7[0-9][0-9]|[0-7][0-9][0-9])px[^{]*\{[^}]*grid-template-columns:\s*(1fr|repeat\(\s*1\s*,)/i
    .test(ctx.rawCss);
  for (const [el, decls] of ctx.styles) {
    const cols = decls["grid-template-columns"];
    if (!cols) continue;
    if (cols.includes("auto-fit") || cols.includes("auto-fill")) continue;
    const fixed = /repeat\(\s*(\d+)\s*,/.exec(cols);
    const explicit = cols.trim().split(/\s+/).filter(Boolean).length;
    const count = fixed ? Number(fixed[1]) : explicit;
    if (!Number.isFinite(count) || count <= 2) continue;
    if (hasCollapse) continue;
    const section = sectionOf(el);
    out.push(finding("SLOP_UNRESPONSIVE_GRID", "grid_does_not_collapse", {
      fixHint: "use_auto_fit_grid",
      ...(section ? { sectionId: section } : {}),
    }));
    break; // un aviso por pagina: el mismo CSS se repite en todas
  }
  return out;
}

/**
 * SLOP_FIXED_WIDTH_OVERFLOW: ancho fijo que desborda a 360 px.
 *
 * 360 px es el viewport mas estrecho que la spec exige soportar. Sin layout se
 * compara el ancho declarado con ese limite, descontando el margen del tema.
 */
export function fixedWidthOverflow(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const margin = toPx(ctx.vars["--margin"]) ?? 0;
  const available = 360 - margin * 2;
  for (const [el, decls] of ctx.styles) {
    const w = toPx(decls["width"]);
    if (w === undefined) continue;
    // `max-width:100%` acota el desbordamiento: es la correccion correcta.
    const maxW = decls["max-width"];
    if (maxW && (maxW.includes("%") || maxW === "none")) continue;
    if (w <= available) continue;
    const section = sectionOf(el);
    out.push(finding("SLOP_FIXED_WIDTH_OVERFLOW", "fixed_width_exceeds_360", {
      fixHint: "use_max_width",
      ...(section ? { sectionId: section } : {}),
    }));
    break;
  }
  return out;
}

// Escala de profundidad permitida. Un `z-index` fuera de ella no es una
// decision de diseno: es un numero elegido para ganar una discusion.
const Z_SCALE = new Set(["-50", "-40", "-30", "-20", "-10", "0", "10", "20", "30", "40", "50"]);

/**
 * SLOP_Z_INDEX_ARBITRARY: un `z-index` suelto fuera de la escala.
 *
 * Valores como `z-index: 9999` se acumulan hasta que nadie sabe quien tapa a
 * quien y aparece un elemento por encima de una cabecera fija. Con una escala
 * corta el orden es legible y se puede razonar sobre el.
 *
 * Se leen los estilos ya resueltos (`ctx.styles`), no el CSS crudo: asi cuenta
 * tambien lo que llega por `style=`.
 */
export function zIndexArbitrary(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const [el, decls] of ctx.styles) {
    const raw = decls["z-index"];
    if (raw === undefined) continue;
    const value = raw.trim().toLowerCase();
    // `auto` es el valor inicial: no hay profundidad que juzgar.
    if (value === "auto" || value === "inherit" || value === "initial") continue;
    if (Z_SCALE.has(value)) continue;
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding("SLOP_Z_INDEX_ARBITRARY", "z_index_outside_scale", {
      fixHint: "use_z_index_scale",
      ...(section ? { sectionId: section } : {}),
    }));
  }
  return out;
}

/** Textos de relleno que no deben llegar a la version publicada. */
const PLACEHOLDERS = [/lorem ipsum/i, /pendiente de confirmar/i, /\bTODO\b/, /\bXXX\b/, /texto de ejemplo/i];

/**
 * SLOP_PLACEHOLDER_TEXT: texto de relleno en la version que se publica.
 *
 * Avisa pero no bloquea: el dueno puede publicar con textos provisionales si
 * lo decide, y el panel se lo recuerda.
 */
export function placeholderText(ctx: Ctx): LintFinding[] {
  const out: LintFinding[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(ctx.doc.querySelectorAll("h1,h2,h3,p,li,blockquote,a,button"))) {
    const text = (el.textContent ?? "").trim();
    if (!text) continue;
    const hit = PLACEHOLDERS.some((re) => re.test(text));
    if (!hit) continue;
    const section = sectionOf(el);
    const key = section ?? "page";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding("SLOP_PLACEHOLDER_TEXT", "placeholder_copy_published", {
      fixHint: "complete_pending_copy",
      ...(section ? { sectionId: section } : {}),
    }));
  }
  return out;
}
