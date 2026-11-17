// Ensamblado: lee los CSV de origen y produce FILAS listas para la base.
//
// No escribe en la base: genera las filas y el SQL. Asi el modo `--dry-run` puede
// ensenar exactamente que entraria, que caeria y por que, sin tocar nada. La
// escritura la hace `bin/import.mjs` con `--write`.

import { normalizePairing, normalizeSections, type Scale } from "./typography.js";
import { normalizePalette } from "./palette.js";
import { slug } from "./csv.js";

export const SOURCE = "ui-ux-pro-max";
export const LICENSE = "MIT";
export const LICENSE_URL = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/LICENSE";
// Commit fijado: el catalogo es reproducible. Subir de version es un cambio
// deliberado que se ve en el diff, no algo que cambie sola una noche.
export const SOURCE_COMMIT = "e59ff376a41f7ca47b7541ad5c116495cbade3ee";
export const VERIFIED_AT = "2026-11-04";

export interface PaletteRow {
  id: string;
  name: string;
  colors: { ground: string; ink: string; accent: string };
  contrastInk: number;
  contrastAccent: number;
  mood: string;
  status: "active" | "supplemental";
  reasons: string[];
}

export interface PairingRow {
  id: string;
  name: string;
  headingFamily: string;
  bodyFamily: string;
  scale: Scale;
  mood: string;
  status: "active" | "supplemental";
  reasons: string[];
}

export interface PatternRow {
  id: string;
  name: string;
  goal: string;
  sections: string[];
  status: "active" | "supplemental";
  reasons: string[];
  dropped: string[];
}

export interface ProductRow {
  id: string;
  name: string;
  summary: string;
  keywords: string[];
  avoid: string;
  status: "active" | "supplemental";
}

export interface StyleRow {
  id: string;
  name: string;
  summary: string;
  keywords: string[];
  status: "active" | "supplemental";
  reasons: string[];
  // El origen NO da hex por estilo: da prosa. Se guarda para que la paleta se
  // elija despues por producto, no se inventa un color aqui.
  lost: string[];
}

export interface ImportReport {
  palettes: PaletteRow[];
  pairings: PairingRow[];
  patterns: PatternRow[];
  products: ProductRow[];
  styles: StyleRow[];
  skipped: { file: string; reason: string; count: number }[];
}

type Csv = Array<Record<string, string>>;

// Los colores de origen son prosa ("Monochromatic, Black #000000, White #FFFFFF").
// Se extrae lo que se pueda afirmar; si no hay un hex claro por rol, se descarta.
const HEX_ANY = /#[0-9a-fA-F]{6}\b/g;

export function buildReport(files: {
  colors: Csv;
  typography: Csv;
  landing: Csv;
  products: Csv;
  styles: Csv;
}): ImportReport {
  const report: ImportReport = { palettes: [], pairings: [], patterns: [], products: [], styles: [], skipped: [] };

  // --- Paletas -------------------------------------------------------------
  for (const row of files.colors) {
    const productType = row["Product Type"] ?? "";
    const p = normalizePalette({
      background: row["Background"],
      foreground: row["Foreground"],
      primary: row["Primary"],
      accent: row["Accent"],
    });
    if (!p) {
      report.skipped.push({ file: "colors.csv", reason: `fila sin hex valido: ${productType}`, count: 1 });
      continue;
    }
    report.palettes.push({
      id: slug("pal", productType),
      name: productType || "Sin nombre",
      colors: p.colors,
      contrastInk: p.contrastInk,
      contrastAccent: p.contrastAccent,
      mood: (row["Notes"] ?? "").slice(0, 200),
      status: p.verdict.status,
      reasons: p.verdict.reasons,
    });
  }

  // --- Parejas tipograficas ------------------------------------------------
  for (const row of files.typography) {
    const nombre = row["Font Pairing Name"] ?? "";
    const out = normalizePairing({
      name: nombre,
      heading: row["Heading Font"] ?? "",
      body: row["Body Font"] ?? "",
      category: row["Category"],
    });
    if (!out) {
      report.skipped.push({ file: "typography.csv", reason: `pareja sin familia resoluble: ${nombre}`, count: 1 });
      continue;
    }
    // Si las dos familias son la misma, no hay pareja: es una sola fuente.
    const reasons = out.lost.length ? [`traducida: ${out.lost.join("; ")}`] : [];
    report.pairings.push({
      id: slug("font", nombre),
      name: nombre,
      headingFamily: out.headingFamily,
      bodyFamily: out.bodyFamily,
      scale: out.scale,
      mood: (row["Mood/Style Keywords"] ?? "").slice(0, 200),
      // Una pareja traducida sigue siendo util, pero ya no es la del origen: se
      // marca `supplemental` para que el panel lo diga sin mentir.
      status: reasons.length ? "supplemental" : "active",
      reasons,
    });
  }

  // --- Patrones de landing -------------------------------------------------
  for (const row of files.landing) {
    const nombre = row["Pattern Name"] ?? "";
    const out = normalizeSections(row["Section Order"] ?? "");
    report.patterns.push({
      id: slug("land", nombre),
      name: nombre,
      goal: (row["Conversion Optimization"] ?? "").slice(0, 300),
      sections: out.sections,
      status: out.verdict.status,
      reasons: out.verdict.reasons,
      dropped: out.dropped,
    });
  }

  // --- Tipos de producto ---------------------------------------------------
  for (const row of files.products) {
    const name = row["Product Type"] ?? "";
    if (!name) continue;
    const keywords = (row["Keywords"] ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k !== "")
      .slice(0, 20);
    report.products.push({
      id: slug("prod", name),
      name,
      summary: [row["Primary Style Recommendation"], row["Color Palette Focus"]].filter(Boolean).join(". ").slice(0, 400),
      keywords,
      avoid: "",
      status: "active",
    });
  }

  // --- Estilos -------------------------------------------------------------
  // El origen lista 89 estilos; solo entran los `active`. Un estilo marcado
  // `deprecated` en el origen no se resucita aqui.
  for (const row of files.styles) {
    const name = row["Style Category"] ?? "";
    const estado = (row["Status"] ?? "").toLowerCase();
    if (!name) continue;
    if (estado && estado !== "active") {
      report.skipped.push({ file: "styles.csv", reason: `origen lo marca ${estado}: ${name}`, count: 1 });
      continue;
    }
    const primary = row["Primary Colors"] ?? "";
    const hexes = primary.match(HEX_ANY) ?? [];
    report.styles.push({
      id: slug("style", name),
      name,
      summary: (row["Best For"] ?? "").slice(0, 300),
      keywords: (row["Keywords"] ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 20),
      // Un estilo sin un solo hex en su paleta primaria no puede alimentar el
      // tema: es prosa. Entra como supplemental y la paleta se toma de la fila
      // de producto que lo recomiende.
      status: hexes.length ? "active" : "supplemental",
      reasons: hexes.length ? [] : ["la paleta del origen es prosa, sin hex utilizable"],
      lost: hexes.length ? [] : [primary.slice(0, 120)],
    });
  }

  // Deduplicado: el slug puede colisionar (dos filas con el mismo nombre). Se
  // queda la primera: es la del origen, en su orden.
  const dedupe = <T extends { id: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  };
  report.palettes = dedupe(report.palettes);
  report.pairings = dedupe(report.pairings);
  report.patterns = dedupe(report.patterns);
  report.products = dedupe(report.products);
  report.styles = dedupe(report.styles);

  return report;
}
