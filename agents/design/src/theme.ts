import { readFileSync } from "node:fs";

import { contrastRatio } from "@webdesign/linter";

import type { Product } from "./product.js";
import type { Sector } from "./sector.js";

// Tema del sitio a partir del producto del catálogo (T-029).
//
// POR QUÉ EXISTE: el tema salía de 8 presets fijos (0009_design_catalog.sql) y
// dos negocios distintos se veían iguales. `design-intelligence.json` trae, por
// tipo de negocio, una paleta (colors.csv), unos estilos (styles.csv) y parejas
// tipográficas (typography.csv). Aquí se reducen al MISMO contrato de tema de
// `site-schema`: el renderer y `theme-css.ts` no cambian.
//
// LÍMITE DEL CONTRATO (no se amplía aquí): el catálogo pide más de lo que el
// tema puede expresar. Sombras (`--shadow`), radios por elemento
// (`--radius-card` ≠ `--radius-button`, Bauhaus «0px cards o 9999px botones»),
// peso tipográfico, colores secundario/muted/border y webfonts reales. El tema
// solo tiene 3 colores, un radio global, dos espaciados y una familia.
//
// Determinista: mismo producto → mismo tema. Sin modelo.

export interface SiteTheme {
  colors: { ink: string; accent: string; ground: string };
  radius: "square" | "rounded" | "pill";
  spacing: { margin: number; sectionGap: number };
  typography: { scale: "compact" | "normal" | "large"; family: string };
}

export type ProductProfile = Pick<Product, "id" | "label"> & { primaryStyles?: string[]; paletteFocus?: string };

export interface Palette {
  id: string;
  productType: string;
  primary: string;
  accent: string;
  background: string;
  foreground: string;
  [k: string]: string;
}

export interface Style {
  id: string;
  label: string;
  keywords: string[];
  cssVariables: string;
  cssKeywords: string;
}

export interface Typography {
  id: string;
  fontPairingName: string;
  category: string;
  headingFont: string;
  bodyFont: string;
  moodStyleKeywords: string;
  bestFor: string;
}

interface Data {
  products: Array<ProductProfile & { primaryStyles: string[] }>;
  palettes: Palette[];
  styles: Style[];
  typography: Typography[];
}

let cache: Data | undefined;
function data(): Data {
  if (cache === undefined) {
    const raw = readFileSync(new URL("../data/design-intelligence.json", import.meta.url), "utf8");
    const p = JSON.parse(raw) as Data;
    cache = { products: p.products, palettes: p.palettes, styles: p.styles, typography: p.typography };
  }
  return cache;
}

export function allPalettes(): readonly Palette[] {
  return data().palettes;
}
export function allStyles(): readonly Style[] {
  return data().styles;
}

// --- contraste ---------------------------------------------------------------

/** AA texto normal. El acento es enlace (texto normal) y fondo del botón con
 *  texto `ground`: la misma pareja, así que se exige 4.5 a las dos. */
export const MIN_CONTRAST = 4.5;

function hex(c: string): string {
  return c.trim().toLowerCase();
}
function rgb(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

/**
 * Corrige `fg` hasta cumplir `min` sobre `bg`: mezcla hacia negro si el fondo
 * es claro y hacia blanco si es oscuro, en pasos del 2 %. Devuelve el color sin
 * tocar si ya cumple. Siempre termina (negro/blanco puros dan ≥ 4.5 contra
 * cualquier fondo de su lado).
 */
export function ensureContrast(fg: string, bg: string, min = MIN_CONTRAST): { color: string; corrected: boolean } {
  const f = hex(fg);
  const b = hex(bg);
  if (contrastRatio(f, b) >= min) return { color: f, corrected: false };
  const target: [number, number, number] =
    contrastRatio("#000000", b) >= contrastRatio("#ffffff", b) ? [0, 0, 0] : [255, 255, 255];
  const src = rgb(f);
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = toHex([0, 1, 2].map((i) => src[i]! + (target[i]! - src[i]!) * t) as [number, number, number]);
    if (contrastRatio(c, b) >= min) return { color: c, corrected: true };
  }
  return { color: toHex(target), corrected: true };
}

/** Acento vs tinta: por debajo, el enlace no se distingue del texto. */
export const MIN_ACCENT_VS_INK = 1.6;

export interface ColorChoice {
  colors: SiteTheme["colors"];
  /** Rol del origen usado como acento. */
  accentFrom: "primary" | "accent";
  /** Notas de corrección («ink #x → #y (3.9 → 4.5)»). */
  corrections: string[];
}

/**
 * Paleta → colores del tema. `ground` ← Background, `ink` ← Foreground,
 * `accent` ← Primary. Nuestro acento es enlace y botón principal: en el origen
 * ese rol es Primary; su Accent es un realce secundario (las notas lo llaman
 * «CTA» a veces). Se cae a Accent SOLO si Primary no llega a AA y Accent sí, sin
 * tocarlo: se prefiere un color real del catálogo a uno fabricado. Es la misma
 * regla que `catalog-import/src/palette.ts`. Si ninguno llega, se corrige Primary.
 */
export function colorsFromPalette(p: Palette): ColorChoice {
  const ground = hex(p.background);
  const corrections: string[] = [];
  const ink = ensureContrast(p.foreground, ground);
  if (ink.corrected) {
    corrections.push(`ink ${hex(p.foreground)} → ${ink.color} (${r2(contrastRatio(hex(p.foreground), ground))} → ${r2(contrastRatio(ink.color, ground))})`);
  }
  // Candidatos en orden: color del catálogo que ya cumple y se distingue de la
  // tinta; después el mismo color corregido. Un acento casi igual a la tinta
  // (40 de 194 paletas tienen Primary ≈ Foreground, p. ej. b2b-service
  // #0f172a/#020617) deja enlaces y botones sin color: ahí manda Accent.
  const distinct = (c: string): boolean => contrastRatio(c, ink.color) >= MIN_ACCENT_VS_INK;
  const options: Array<{ from: ColorChoice["accentFrom"]; raw: string }> = [
    { from: "primary", raw: hex(p.primary) },
    { from: "accent", raw: hex(p.accent) },
  ];
  const fixed = options.map((o) => ({ ...o, fix: ensureContrast(o.raw, ground) }));
  const pick =
    fixed.find((o) => !o.fix.corrected && distinct(o.fix.color)) ??
    fixed.find((o) => distinct(o.fix.color)) ??
    fixed[0]!;
  const accentFrom = pick.from;
  const source = pick.raw;
  const accent = pick.fix;
  if (accent.corrected) {
    corrections.push(`accent ${source} → ${accent.color} (${r2(contrastRatio(source, ground))} → ${r2(contrastRatio(accent.color, ground))})`);
  }
  return { colors: { ground, ink: ink.color, accent: accent.color }, accentFrom, corrections };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- estilo → radio, espaciado, escala --------------------------------------

/** Valor de una variable `--name: valor` de la columna de variables. */
function cssVar(vars: string, name: string): string | undefined {
  const m = vars.match(new RegExp(`--${name}:\\s*([^,]+)`));
  return m ? m[1]!.trim() : undefined;
}

/** Primer número en px de un valor («12-16px» → 16: el máximo del rango; «2rem» → 32). */
function px(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = value.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(px|rem|%)?/);
  if (!m) return undefined;
  const n = Number(m[2] ?? m[1]);
  if (m[3] === "rem") return n * 16;
  if (m[3] === "%") return n >= 50 ? 999 : undefined;
  return n;
}

const has = (s: Style, re: RegExp): boolean => re.test([s.label, ...s.keywords].join(" ").toLowerCase());

export type Source = "variables" | "css" | "palabras" | "defecto";

/**
 * Radio del estilo. Fuentes, en orden: variable `--border-radius` (o `--radius`,
 * `--radius-card`, `--card-radius`: el radio de tarjeta es el que más superficie
 * pinta), después `border-radius` en «CSS/Technical Keywords», después palabras
 * del estilo, y si nada, `rounded`. Solo 14 de 89 estilos dicen un número.
 *
 * Escala (encargo): 0px → square; hasta 8px → rounded; ≥ 999px → pill. Entre
 * 9 y 998 px también `rounded`: el renderer pinta 12px y un radio de 24px en una
 * tarjeta grande no es una píldora. `--radius-pill` NO cuenta: es por elemento
 * (botones), y el tema solo tiene un radio global.
 */
export function radiusForStyle(s: Style): { radius: SiteTheme["radius"]; source: Source } {
  const v = s.cssVariables ?? "";
  const fromVar = px(cssVar(v, "border-radius") ?? cssVar(v, "radius") ?? cssVar(v, "radius-card") ?? cssVar(v, "card-radius"));
  const fromCss = px((s.cssKeywords ?? "").match(/border-radius:\s*([^,;]+)/)?.[1]);
  const n = fromVar ?? fromCss;
  if (n !== undefined) {
    return { radius: n === 0 ? "square" : n >= 999 ? "pill" : "rounded", source: fromVar !== undefined ? "variables" : "css" };
  }
  if (has(s, /brutal|swiss|terminal|cli\b|pixel|e-ink|monochrome|hud|cyberpunk|bauhaus|editorial|newspaper|data-dense|dashboard/)) {
    return { radius: "square", source: "palabras" };
  }
  if (has(s, /\bpill|bubble|clay|y2k|playful|kawaii|toy/)) return { radius: "pill", source: "palabras" };
  return { radius: "rounded", source: "defecto" };
}

/**
 * Espaciado del estilo → `margin` 48–80 y `sectionGap` 56–96 (los rangos de los
 * 8 presets del SQL). Se busca un tamaño base en px: `--spacing`, `--section-padding`,
 * `--spacing-large`, `--block-gap`, `--grid-gap`; después `gap:`/`padding:` en
 * «CSS/Technical Keywords»; después palabras (espacioso → 48, denso → 12); si
 * nada, 24. Se acota a 8–64 y se interpola lineal a los dos rangos.
 */
export function spacingForStyle(s: Style): { spacing: SiteTheme["spacing"]; source: Source; basePx: number } {
  const v = s.cssVariables ?? "";
  const spacingVar = cssVar(v, "spacing");
  // «4 8 16 24 32 48» es una escala: manda el paso mayor.
  const scale = spacingVar && /^\d+(\s+\d+)+$/.test(spacingVar) ? Math.max(...spacingVar.split(/\s+/).map(Number)) : undefined;
  const fromVar =
    scale ??
    px(spacingVar) ??
    px(cssVar(v, "section-padding")) ??
    px(cssVar(v, "spacing-large")) ??
    px(cssVar(v, "block-gap")) ??
    px(cssVar(v, "grid-gap"));
  const css = s.cssKeywords ?? "";
  const fromCss = px(css.match(/\b(?:gap|padding):\s*([0-9][^,;]*)/)?.[1] ?? css.match(/gaps?\s*\((\d+px)/)?.[1]);
  let base: number;
  let source: Source;
  if (fromVar !== undefined) {
    base = fromVar;
    source = "variables";
  } else if (fromCss !== undefined) {
    base = fromCss;
    source = "css";
  } else if (has(s, /spacious|white space|exaggerated|luxury|minimal|editorial|zen|calm/)) {
    base = 48;
    source = "palabras";
  } else if (has(s, /dense|dashboard|data|terminal|monitoring|analytics/)) {
    base = 12;
    source = "palabras";
  } else {
    base = 24;
    source = "defecto";
  }
  const t = (Math.min(64, Math.max(8, base)) - 8) / 56;
  return { spacing: { margin: Math.round(48 + 32 * t), sectionGap: Math.round(56 + 40 * t) }, source, basePx: base };
}

export function scaleForStyle(s: Style): SiteTheme["typography"]["scale"] {
  const size = px(cssVar(s.cssVariables ?? "", "typography-size"));
  if ((size !== undefined && size >= 32) || has(s, /large text|bold typography|poster|exaggerated|kinetic typography|big type/)) return "large";
  if (has(s, /dense|dashboard|compact|data-dense|terminal/)) return "compact";
  return "normal";
}

// --- estilo → pareja tipográfica → familia con pila real --------------------

/**
 * Familias que `theme-css.ts` sabe pintar (FAMILY_FALLBACK, catálogo T-029).
 * Ninguna carga un .ttf propio: el nombre comercial va primero por si el
 * visitante la tiene, y detrás hay una pila real del sistema.
 */
export const RENDERABLE_FAMILIES = new Set([
  "Inter", "Instrument Sans", "Libre Franklin", "Archivo", "Space Grotesk", "Nunito",
  "Serif", "Source Serif 4", "Fraunces", "Merriweather", "Mono",
]);

/**
 * Las cinco direcciones tipográficas con fuente propia servida desde
 * `/fonts/*.ttf` (T-030a, ver `theme-css.ts`). `theme.typography.family` sigue
 * siendo un `string` por contrato de esquema: aquí se guarda el nombre de la
 * dirección (p. ej. `"editorial"`), no una familia de fuente suelta, y
 * `theme-css.ts` es quien resuelve ese nombre a su pila real.
 */
export const TYPOGRAPHY_DIRECTIONS = [
  "editorial",
  "clasica",
  "calida",
  "moderna",
  "rotunda",
] as const;
export type TypographyDirection = (typeof TYPOGRAPHY_DIRECTIONS)[number];

/**
 * Estilo → dirección tipográfica. Regla explícita y determinista sobre las
 * palabras del estilo (label + keywords), en este orden de prioridad:
 *
 * 1. `editorial`: serif de alto contraste o explícitamente "editorial"
 *    (magazine, drop caps, pull quotes, austere, broadsheet, academia...).
 * 2. `clasica`: confianza, legal, corporativo (trust, authority, enterprise,
 *    professional, credentials, b2b, executive, scholarly aparte de 1).
 * 3. `calida`: hostelería, belleza, cálido (warm, organic, earthy, wellness,
 *    nature, handmade, cozy, biophilic).
 * 4. `moderna`: salud, tech, minimalista (clinical, health, saas, tech,
 *    minimal, swiss, clean, dashboard, fintech).
 * 5. `rotunda`: bold, playful, creativo (bold, playful, maximalism, chaos,
 *    y2k, neon, poster, loud).
 *
 * Si nada encaja, `moderna` (el valor por defecto que pide el encargo).
 */
export function directionForStyle(s: Style): TypographyDirection {
  const text = [s.label, ...s.keywords].join(" ").toLowerCase();
  const has = (re: RegExp): boolean => re.test(text);

  if (has(/editorial|magazine|drop cap|pull quote|broadsheet|academia|scholarly|austere|serif.*mechanical/)) {
    return "editorial";
  }
  if (has(/trust|authority|legal|law|enterprise|professional|credential|b2b|executive|corporate|audit|compliance|polaris|spectrum|fluent/)) {
    return "clasica";
  }
  if (has(/warm|organic|earthy|wellness|nature|handmade|cozy|biophilic|terracotta|skin tones|wood|soil|sand|clay|claymorphism|nature-inspired/)) {
    return "calida";
  }
  if (has(/health|clinic|medical|tech|saas|minimal|swiss|clean|dashboard|fintech|monitoring|analytics|data-dense|accessible|inclusive/)) {
    return "moderna";
  }
  if (has(/bold|playful|maximalism|chaos|y2k|neon|poster|loud|neubrutalism|brutalism|vibrant|kinetic|gen z|toy-like|bubbly/)) {
    return "rotunda";
  }
  return "moderna";
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/**
 * Pareja de typography.csv para el estilo: la que más palabras comparte entre
 * (label + keywords del estilo) y (mood + best for + nombre de la pareja).
 * Empate → la primera del catálogo.
 */
export function pairingForStyle(s: Style): Typography {
  const want = words([s.label, ...s.keywords].join(" "));
  const list = data().typography;
  let best = list[0]!;
  let bestScore = -1;
  for (const t of list) {
    const have = words(`${t.fontPairingName} ${t.moodStyleKeywords} ${t.bestFor}`);
    let score = 0;
    for (const w of want) if (have.has(w)) score++;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pareja → familia del tema. Si el titular de la pareja tiene pila propia en
 * `theme-css.ts`, se usa. Si no: titular serif → `Serif` (pila serif real del
 * sistema), mono → `Mono`, y sans → la del cuerpo si tiene pila, o `Inter`.
 * No se añade ninguna familia que no se vaya a cargar.
 */
export function familyForPairing(t: Typography): string {
  if (RENDERABLE_FAMILIES.has(t.headingFont)) return t.headingFont;
  const cat = t.category.toLowerCase();
  if (/^(display )?serif|^script \+ serif/.test(cat) || /garamond|bodoni|playfair|lora|cormorant|crimson|newsreader|serif/i.test(t.headingFont)) return "Serif";
  if (/^mono|^tech display \+ mono/.test(cat) || /mono|code/i.test(t.headingFont)) return "Mono";
  if (RENDERABLE_FAMILIES.has(t.bodyFont)) return t.bodyFont;
  return "Inter";
}

// --- respaldo y entrada ------------------------------------------------------

/**
 * Sin producto: un producto por sector, para que el respaldo no sea siempre el
 * mismo. `neutro` (o sin sector) → `b2b-service`, el más genérico.
 */
export const SECTOR_PRODUCT: Readonly<Record<Sector, string>> = {
  despacho: "legal-services",
  salud: "medical-clinic",
  belleza: "beauty-spa-wellness-service",
  hosteleria: "restaurant-food-service",
  comercio: "e-commerce",
  taller: "home-services-plumber-electrician",
  neutro: "b2b-service",
};

export interface ThemeTrace {
  productId: string;
  fallback: boolean;
  paletteId: string;
  styleId: string;
  pairingId: string;
  accentFrom: ColorChoice["accentFrom"];
  radiusSource: Source;
  spacingSource: Source;
  corrections: string[];
}

const FALLBACK_STYLE = "minimalism-swiss-style";

export function themeTrace(product: ProductProfile | undefined, sector?: Sector): { theme: SiteTheme; trace: ThemeTrace } {
  const d = data();
  let fallback = false;
  let prof: (ProductProfile & { primaryStyles?: string[] }) | undefined =
    product === undefined ? undefined : d.products.find((p) => p.id === product.id) ?? product;
  if (prof === undefined) {
    fallback = true;
    const id = SECTOR_PRODUCT[sector ?? "neutro"];
    prof = d.products.find((p) => p.id === id);
  }
  const palette =
    d.palettes.find((p) => p.id === prof?.id) ??
    d.palettes.find((p) => p.productType === prof?.label) ??
    d.palettes.find((p) => p.id === SECTOR_PRODUCT.neutro)!;
  if (palette.id !== prof?.id) fallback = true;
  const style =
    d.styles.find((s) => s.label === prof?.primaryStyles?.[0]) ?? d.styles.find((s) => s.id === FALLBACK_STYLE)!;
  const color = colorsFromPalette(palette);
  const r = radiusForStyle(style);
  const sp = spacingForStyle(style);
  const pairing = pairingForStyle(style);
  const theme: SiteTheme = {
    colors: color.colors,
    radius: r.radius,
    spacing: sp.spacing,
    // T-030a: el nombre de familia ya no sale de la pareja tipográfica
    // (`familyForPairing`), sino de una de las cinco direcciones con fuente
    // propia. `pairing` se conserva solo para el trace/resumen (pairingId,
    // `themeSummary`): no decide la tipografía del tema.
    typography: { scale: scaleForStyle(style), family: directionForStyle(style) },
  };
  return {
    theme,
    trace: {
      productId: prof?.id ?? palette.id,
      fallback,
      paletteId: palette.id,
      styleId: style.id,
      pairingId: pairing.id,
      accentFrom: color.accentFrom,
      radiusSource: r.source,
      spacingSource: sp.source,
      corrections: color.corrections,
    },
  };
}

export function themeForProduct(product: ProductProfile | undefined, sector?: Sector): SiteTheme {
  return themeTrace(product, sector).theme;
}

/** Resumen corto para `design.idea` (antes, el resumen del preset fijo). */
export function themeSummary(product: ProductProfile | undefined, sector?: Sector): string {
  const { trace } = themeTrace(product, sector);
  const d = data();
  const style = d.styles.find((s) => s.id === trace.styleId);
  const prod = d.products.find((p) => p.id === trace.productId) as (ProductProfile & { paletteFocus?: string }) | undefined;
  const pairing = d.typography.find((t) => t.id === trace.pairingId);
  const parts = [
    `Estilo ${style?.label ?? trace.styleId} para ${prod?.label ?? trace.productId}`,
    prod?.paletteFocus ? `paleta: ${prod.paletteFocus}` : "",
    pairing ? `tipografía: ${pairing.fontPairingName}` : "",
  ].filter(Boolean);
  return parts.join("; ").slice(0, 500);
}
