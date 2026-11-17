// Normalizacion: convierte los datos de origen al shape de NUESTRO tema.
//
// Esto es lo que significa "adaptar, no copiar". Los datos de origen hablan de
// webfonts, de 18 roles de color y de secciones que no existen en la plataforma;
// aqui se reducen a lo que el renderer sabe pintar de verdad, y se MIDE en vez de
// confiar. Todo lo que no pasa queda marcado con el motivo; nada se descarta en
// silencio.

import { contrastRatio } from "@webdesign/linter";
import { SECTION_TYPES, type SectionType } from "@webdesign/site-schema";

// 6.5 exige 4.5:1 para texto normal (SLOP_LOW_CONTRAST_TEXT_ON_COLOR).
export const MIN_CONTRAST = 4.5;

export type Status = "active" | "supplemental";

export interface Verdict {
  status: Status;
  reasons: string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(v: string | undefined): v is string {
  return typeof v === "string" && HEX.test(v.trim());
}

export interface PaletteIn {
  background?: string | undefined;
  foreground?: string | undefined;
  // Nuestro `accent` es enlace y fondo de boton principal. En el origen ese rol
  // es `Primary`; su `Accent` es un color de realce secundario. Se prefiere
  // Primary y solo se cae a Accent si Primary no llega al contraste.
  primary?: string | undefined;
  accent?: string | undefined;
}

export interface PaletteOut {
  colors: { ground: string; ink: string; accent: string };
  contrastInk: number;
  contrastAccent: number;
  verdict: Verdict;
}

// ground/ink/accent salen de Background/Foreground/Accent. Se miden los dos
// contrastes que el renderer usa de verdad: texto sobre fondo, y el acento, que es
// a la vez color de enlace sobre `ground` y fondo de boton con texto `ground`
// (theme-css.ts). Es la misma pareja en los dos casos, asi que basta una medida.
export function normalizePalette(p: PaletteIn): PaletteOut | null {
  if (!isHex(p.background) || !isHex(p.foreground)) return null;
  const ground = p.background.trim().toLowerCase();
  const ink = p.foreground.trim().toLowerCase();
  // Candidatos en orden de preferencia de rol. El umbral NO se relaja: se elige
  // el color del origen que cumple el rol, no se fabrica uno que pase.
  const candidates = [p.primary, p.accent].filter(isHex).map((c) => c.trim().toLowerCase());
  const first = candidates[0];
  if (first === undefined) return null;
  const accent = candidates.find((c) => contrastRatio(c, ground) >= MIN_CONTRAST) ?? first;
  const contrastInk = round2(contrastRatio(ink, ground));
  const contrastAccent = round2(contrastRatio(accent, ground));
  const reasons: string[] = [];
  if (contrastInk < MIN_CONTRAST) reasons.push(`contraste texto/fondo ${contrastInk} < ${MIN_CONTRAST}`);
  if (contrastAccent < MIN_CONTRAST) reasons.push(`contraste acento/fondo ${contrastAccent} < ${MIN_CONTRAST}`);
  return {
    colors: { ground, ink, accent },
    contrastInk,
    contrastAccent,
    verdict: { status: reasons.length ? "supplemental" : "active", reasons },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
