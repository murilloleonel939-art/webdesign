#!/usr/bin/env node
// Genera `agents/design/data/design-intelligence.json` a partir de los CSV de la
// skill `ui-ux-pro-max`. Mecanico y verificable: no se inventa ningun campo.
//
// Uso:
//   node scripts/build-design-intelligence.mjs
//   UI_UX_PRO_MAX_DATA=/otra/ruta node scripts/build-design-intelligence.mjs
//
// Sin dependencias: `node:fs` y un parser de CSV propio (comillas, comas y saltos
// de linea dentro de campos, y comillas escapadas como "").
//
// Reglas aplicadas (las del encargo):
//   - `id`: slug del nombre (minusculas, sin acentos, no alfanumerico -> guion).
//     Si dos filas colapsan al mismo id se anade -2, -3 y se avisa por stderr.
//   - `considerations`: parte `Key Considerations` por ". " o ";", recorta, quita
//     el punto final y descarta vacios.
//   - `keywords`: parte por comas, recorta, minusculas, sin repetir, sin vacios.
//   - `sections`: parte `Section Order` por ">" y normaliza con SECTION_RULES.
//   - `status`: valor tal cual viene en la columna (no se filtra nada aqui).
//   - Filas rotas (numero de campos distinto al de la cabecera): se saltan y se
//     listan; no se arreglan a mano.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(HERE, "..", "data", "design-intelligence.json");
const SRC_DIR = process.env.UI_UX_PRO_MAX_DATA ?? "/root/.agents/skills/ui-ux-pro-max/data";

// --- CSV -------------------------------------------------------------------

/** Parser de CSV: devuelve la cabecera y las filas como arrays de campos. */
function parseCsv(text) {
  const rows = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Una linea vacia final no es un registro.
    if (!(record.length === 1 && record[0].trim() === "")) rows.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || record.length > 0) pushRecord();
  if (rows.length === 0) return { header: [], rows: [], broken: [] };

  const [header, ...data] = rows;
  const broken = [];
  const good = [];
  data.forEach((fields, index) => {
    if (fields.length !== header.length) {
      broken.push({
        csv: null, // lo rellena el llamador
        line: index + 2, // la cabecera ocupa la linea 1
        fields: fields.length,
        expected: header.length,
        firstCell: (fields[0] ?? "").slice(0, 60),
      });
      return;
    }
    const obj = {};
    header.forEach((key, k) => {
      obj[key] = fields[k];
    });
    good.push(obj);
  });
  return { header, rows: good, broken };
}

function readCsv(name, brokenReport) {
  const path = join(SRC_DIR, `${name}.csv`);
  const parsed = parseCsv(readFileSync(path, "utf8"));
  for (const b of parsed.broken) brokenReport.push({ ...b, csv: `${name}.csv` });
  return parsed.rows;
}

// --- normalizadores --------------------------------------------------------

/** Slug estable: minusculas, sin acentos, resto -> guion simple. */
function slug(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Asigna ids unicos; informa de los que colapsaron. */
function withIds(rows, labelOf, collisions) {
  const seen = new Map();
  return rows.map((row) => {
    const base = slug(labelOf(row));
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (count > 1) collisions.push({ collection: null, base, id: `${base}-${count}` });
    return { id: count === 1 ? base : `${base}-${count}`, ...row };
  });
}

/** Lista por comas: recorta, minusculas, sin repetir, sin vacios. */
function listByComma(value) {
  const out = [];
  for (const part of value.split(",")) {
    const item = part.trim().toLowerCase();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Lista exacta por comas, conservando mayusculas (estilos, p. ej.). */
function listPreserving(value) {
  const out = [];
  for (const part of value.split(",")) {
    const item = part.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Lista exacta por "+" (estilos primarios), conservando mayusculas. */
function listByPlus(value) {
  const out = [];
  for (const part of value.split("+")) {
    const item = part.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** `Key Considerations` -> array de frases cortas. */
function considerationsOf(value) {
  const out = [];
  for (const part of value.split(/\.\s|;/)) {
    let item = part.trim();
    if (item.endsWith(".")) item = item.slice(0, -1).trim();
    if (item) out.push(item);
  }
  return out;
}

// Mapa de normalizacion de secciones. Se aplica en orden, primera regla que
// coincide (el texto va en minusculas y SIN quitar los parentesis: asi
// "Chapter 1 (problem)" y "Step 2 (solution)" se distinguen por posicion).
//  [regex, nombre canonico]
const SECTION_RULES = [
  [/\bctas?\b/, "cta"],
  [/^step \d+/, "step-<n>"], // Step 1 (problem) -> step-1
  [/^chapter \d+/, "chapter-<n>"], // Chapter 1 (problem) -> chapter-1
  [/^(full-bleed |dynamic |prompt\/input )?hero\b/, "hero"],
  [/^intro\b/, "intro"],
  [/\bfooter\b/, "footer"],
  [/\bvalue prop/, "value-prop"],
  [/\bbento\b/, "features"],
  [/\btransform/, "transformation"],
  [/\bpric/, "pricing"],
  [/\bfaq\b/, "faq"],
  [/\btestimonial/, "testimonials"],
  [/\bsocial proof/, "social-proof"],
  [/\bcomparison\b/, "comparison"],
  [/\bjourney\b/, "journey"],
  [/\bproblem\b/, "problem"],
  [/^solutions? by industry/, "solutions-industry"],
  [/^solutions? by role/, "solutions-role"],
  [/\bsolution/, "solution"],
  [/\bmetric/, "metrics"],
  [/\bhow it works\b/, "how-it-works"],
  [/\bbenefit/, "benefits"],
  [/\bproof\b/, "proof"],
  [/\blogos\b/, "logos"],
  [/\bcategor/, "categories"],
  [/\bfeatures?\b/, "features"],
  [/\bcontact/, "contact"],
  [/\bform\b/, "form"],
  [/\breview/, "reviews"],
  [/\brating/, "ratings"],
  [/^detail/, "details"],
  [/^project grid/, "projects"],
  [/^screenshots/, "screenshots"],
  [/^short description/, "description"],
  [/\btour\b/, "tour"],
  [/^full-screen interactive/, "interactive"],
  [/^lead magnet/, "lead-magnet"],
  [/\bpreview\b/, "preview"],
  [/^product video/, "product-demo"],
  [/\bspecs?\b/, "specs"],
  [/^purchase/, "purchase"],
  [/^agenda/, "agenda"],
  [/^speakers grid/, "speakers"],
  [/^speaker bio/, "speaker-bio"],
  [/^sponsors/, "sponsors"],
  [/^about author/, "author"],
  [/^about/, "about"],
  [/^active members/, "members"],
  [/^featured listings/, "listings"],
  [/^recent issues/, "archives"],
  [/^trust\b/, "trust"],
  [/^urgency/, "urgency"],
  [/^what you/, "learn"],
];

const unmappedSections = [];

function normalizeSection(chunk) {
  const text = chunk.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  for (const [regex, name] of SECTION_RULES) {
    if (!regex.test(text)) continue;
    const numbered = name.match(/^(step|chapter)-<n>$/);
    if (numbered) {
      const n = text.match(/\d+/);
      return `${numbered[1]}-${n ? n[0] : "1"}`;
    }
    return name;
  }
  // Respaldo documentado: slug del trozo sin parentesis. Nunca queda vacio.
  const fallback = slug(text.replace(/\([^)]*\)/g, ""));
  unmappedSections.push({ chunk: chunk.trim(), fallback });
  return fallback || "section";
}

/** `Section Order` -> array de secciones cortas, sin repetir y sin vacios. */
function sectionsOf(value) {
  const out = [];
  for (const chunk of value.split(">")) {
    const name = normalizeSection(chunk);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// --- construccion ----------------------------------------------------------

const broken = [];
const collisions = [];

const productRows = readCsv("products", broken);
const landingRows = readCsv("landing", broken);
const styleRows = readCsv("styles", broken);
const typographyRows = readCsv("typography", broken);
const colorRows = readCsv("colors", broken);

const products = withIds(
  productRows.map((row) => ({
    label: row["Product Type"],
    keywords: listByComma(row["Keywords"]),
    primaryStyles: listByPlus(row["Primary Style Recommendation"]),
    secondaryStyles: listPreserving(row["Secondary Styles"]),
    landingPattern: row["Landing Page Pattern"],
    paletteFocus: row["Color Palette Focus"],
    considerations: considerationsOf(row["Key Considerations"]),
  })),
  (row) => row.label,
  collisions,
);

const patterns = withIds(
  landingRows.map((row) => ({
    label: row["Pattern Name"],
    keywords: listByComma(row["Keywords"]),
    sections: sectionsOf(row["Section Order"]),
    ctaPlacement: row["Primary CTA Placement"],
    conversionNotes: row["Conversion Optimization"],
    // Columna real del CSV ("Aliases"): es la unica forma de cruzar los
    // `landingPattern` cortos de products.csv contra este catalogo.
    aliases: row["Aliases"] ? row["Aliases"].split("|").map((a) => a.trim()).filter(Boolean) : [],
  })),
  (row) => row.label,
  collisions,
);

const styles = withIds(
  styleRows.map((row) => ({
    label: row["Style Category"],
    status: row["Status"],
    keywords: listByComma(row["Keywords"]),
    primaryColors: listPreserving(row["Primary Colors"]),
    effects: row["Effects & Animation"],
    bestFor: row["Best For"],
    avoidFor: row["Do Not Use For"],
    cssVariables: row["Design System Variables"],
    // T-029: solo 6 de 89 estilos traen `--border-radius` en las variables; otros
    // 8 lo dicen en esta columna real. `theme.ts` la lee como segunda fuente.
    cssKeywords: row["CSS/Technical Keywords"],
  })),
  (row) => row.label,
  collisions,
);

// typography: `id` + las columnas reales de typography.csv (sin el indice "No"),
// con los nombres de columna pasados a camelCase.
const TYPOGRAPHY_KEYS = {
  "Font Pairing Name": "fontPairingName",
  Category: "category",
  "Heading Font": "headingFont",
  "Body Font": "bodyFont",
  "Mood/Style Keywords": "moodStyleKeywords",
  "Best For": "bestFor",
  "Google Fonts URL": "googleFontsUrl",
  "CSS Import": "cssImport",
  "Tailwind Config": "tailwindConfig",
  Notes: "notes",
};

const typography = withIds(
  typographyRows.map((row) => {
    const entry = {};
    for (const [column, key] of Object.entries(TYPOGRAPHY_KEYS)) entry[key] = row[column];
    return entry;
  }),
  (row) => row.fontPairingName,
  collisions,
);

// palettes (T-029): `id` + las columnas reales de colors.csv (sin "No"), en
// camelCase. `productType` es la columna "Product Type" tal cual: el `id` sale de
// ella con el mismo slug, asi que coincide con el `id` del producto.
const PALETTE_KEYS = {
  "Product Type": "productType",
  Primary: "primary",
  "On Primary": "onPrimary",
  Secondary: "secondary",
  "On Secondary": "onSecondary",
  Accent: "accent",
  "On Accent": "onAccent",
  Background: "background",
  Foreground: "foreground",
  Card: "card",
  "Card Foreground": "cardForeground",
  Muted: "muted",
  "Muted Foreground": "mutedForeground",
  Border: "border",
  Destructive: "destructive",
  "On Destructive": "onDestructive",
  Ring: "ring",
  Notes: "notes",
};

const palettes = withIds(
  colorRows.map((row) => {
    const entry = {};
    for (const [column, key] of Object.entries(PALETTE_KEYS)) entry[key] = row[column];
    return entry;
  }),
  (row) => row.productType,
  collisions,
);

const summary = JSON.parse(readFileSync(join(SRC_DIR, "catalog-summary.json"), "utf8"));

const payload = {
  generatedFrom: {
    skills: "ui-ux-pro-max",
    verifiedAt: summary.verifiedAt,
    counts: {
      products: products.length,
      patterns: patterns.length,
      styles: styles.length,
      typography: typography.length,
      palettes: palettes.length,
    },
  },
  products,
  patterns,
  styles,
  typography,
  palettes,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

// --- informe ---------------------------------------------------------------

const patternNames = new Set(patterns.map((p) => p.label));
for (const p of patterns) for (const alias of p.aliases) patternNames.add(alias);
const unresolved = products.filter((p) => !patternNames.has(p.landingPattern));

const report = {
  out: OUT_FILE,
  counts: payload.generatedFrom.counts,
  sectionRuleCount: SECTION_RULES.length,
  unmappedSections,
  brokenRows: broken,
  collisions,
  productsWithoutPattern: unresolved.length,
  unresolvedPatternLabels: [...new Set(unresolved.map((p) => p.landingPattern))].sort(),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
