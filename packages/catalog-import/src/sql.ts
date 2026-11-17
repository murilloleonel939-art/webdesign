// Generacion de SQL. Se emite un INSERT ... ON CONFLICT (id) DO UPDATE para que
// reimportar refresque la fila en vez de duplicarla: el importador es idempotente
// y eso se prueba, no se promete.

import {
  LICENSE,
  LICENSE_URL,
  SOURCE,
  SOURCE_COMMIT,
  VERIFIED_AT,
  type ImportReport,
  type PaletteRow,
  type StyleRow,
  type PairingRow,
  type PatternRow,
  type ProductRow,
} from "./build.js";

// Escapado de literal SQL. Los datos vienen de un CSV: una comilla sin escapar
// seria una inyeccion y, peor, un catalogo corrupto que nadie mira.
export function lit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function arr(values: string[]): string {
  if (!values.length) return "'{}'";
  return `ARRAY[${values.map(lit).join(", ")}]::text[]`;
}

const provenance = (): string => `${lit(SOURCE)}, ${lit(LICENSE)}, ${lit(LICENSE_URL)}, ${lit(VERIFIED_AT)}::timestamptz`;

export function sqlForPalettes(rows: PaletteRow[]): string {
  if (!rows.length) return "";
  const cols = ["id", "name", "colors", "contrast_ink", "contrast_accent", "mood", "status", "source", "license", "license_url", "verified_at"];
  const values = rows.map((r) => {
    const c = `'${JSON.stringify(r.colors)}'::jsonb`;
    return `(${lit(r.id)}, ${lit(r.name)}, ${c}, ${r.contrastInk}, ${r.contrastAccent}, ${lit(r.mood)}, ${lit(r.status)}, ${provenance()})`;
  });
  const updates = cols
    .filter((c) => c !== "id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  return `INSERT INTO design_palettes (${cols.join(", ")}) VALUES\n  ${values.join(",\n  ")}\nON CONFLICT (id) DO UPDATE SET ${updates};\n`;
}

export function sqlForPairings(rows: PairingRow[]): string {
  if (!rows.length) return "";
  const cols = ["id", "name", "heading_family", "body_family", "scale", "mood", "status", "source", "license", "license_url", "verified_at"];
  const values = rows.map(
    (r) =>
      `(${lit(r.id)}, ${lit(r.name)}, ${lit(r.headingFamily)}, ${lit(r.bodyFamily)}, ${lit(r.scale)}, ${lit(r.mood)}, ${lit(r.status)}, ${provenance()})`,
  );
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return `INSERT INTO design_font_pairings (${cols.join(", ")}) VALUES\n  ${values.join(",\n  ")}\nON CONFLICT (id) DO UPDATE SET ${updates};\n`;
}

export function sqlForPatterns(rows: PatternRow[]): string {
  const valid = rows.filter((r) => r.sections.length > 0);
  if (!valid.length) return "";
  const cols = ["id", "name", "goal", "sections", "status", "source", "license", "license_url", "verified_at"];
  const values = valid.map(
    (r) => `(${lit(r.id)}, ${lit(r.name)}, ${lit(r.goal)}, '${JSON.stringify(r.sections)}'::jsonb, ${lit(r.status)}, ${provenance()})`,
  );
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return `INSERT INTO design_landing_patterns (${cols.join(", ")}) VALUES\n  ${values.join(",\n  ")}\nON CONFLICT (id) DO UPDATE SET ${updates};\n`;
}

export function sqlForProducts(rows: ProductRow[]): string {
  if (!rows.length) return "";
  const cols = ["id", "name", "summary", "keywords", "avoid", "status", "source", "license", "license_url", "verified_at"];
  const values = rows.map(
    (r) => `(${lit(r.id)}, ${lit(r.name)}, ${lit(r.summary)}, ${arr(r.keywords)}, ${lit(r.avoid)}, ${lit(r.status)}, ${provenance()})`,
  );
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return `INSERT INTO design_product_types (${cols.join(", ")}) VALUES\n  ${values.join(",\n  ")}\nON CONFLICT (id) DO UPDATE SET ${updates};\n`;
}

// Estilos de referencia: entran en `design_styles` con `kind = 'reference'`.
//
// Por que asi y no como presets: esa tabla la lee apps/platform/src/catalog.ts
// como lista de presets APLICABLES, y exige un tema completo. El origen no da hex
// por estilo, da prosa ("Monochromatic, Black #000000..."). Inventar un tema
// seria mentir; dejar las columnas vacias romperia el selector. La solucion es
// `kind`: un `reference` tiene nombre y para-que-sirve (util para recomendar y
// para el brief) pero el panel no lo ofrece como preset, y su tema es el neutro
// de la plataforma, no una invencion sobre el origen.
const NEUTRAL = {
  colors: { ground: "#ffffff", ink: "#111111", accent: "#0b5fff" },
  typography: { family: "Inter", scale: "normal" },
  spacing: { margin: 64, sectionGap: 80 },
};

export function sqlForStyles(rows: StyleRow[]): string {
  const valid = rows.filter((r) => r.name !== "");
  if (!valid.length) return "";
  const values = valid.map((r) => {
    const c = `'${JSON.stringify(NEUTRAL.colors)}'::jsonb`;
    const t = `'${JSON.stringify(NEUTRAL.typography)}'::jsonb`;
    const sp = `'${JSON.stringify(NEUTRAL.spacing)}'::jsonb`;
    return `(${lit(r.id)}, ${lit(r.name)}, ${lit(r.summary)}, ${c}, ${t}, ${sp}, 'rounded', '{}'::jsonb, '[]'::jsonb, 'reference', ${lit(r.status)}, ${provenance()})`;
  });
  return `INSERT INTO design_styles (id, name, summary, colors, typography, spacing, radius, dials, sections, kind, status, source, license, license_url, verified_at) VALUES\n  ${values.join(",\n  ")}\nON CONFLICT (id) DO NOTHING;\n`;
}

export function sqlForReport(report: ImportReport): string {
  const header = `-- Catalogo importado de ${SOURCE} en el commit ${SOURCE_COMMIT}.\n-- Licencia ${LICENSE}. Generado por @webdesign/catalog-import; no editar a mano.\n\nBEGIN;\n\n`;
  const body = [
    sqlForStyles(report.styles),
    sqlForPalettes(report.palettes),
    sqlForPairings(report.pairings),
    sqlForProducts(report.products),
    sqlForPatterns(report.patterns),
  ]
    .filter((s) => s !== "")
    .join("\n");
  return `${header}${body}\nCOMMIT;\n`;
}
