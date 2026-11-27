import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `agents/design/data/design-intelligence.json` (T-024): extraccion mecanica de
// los CSV de la skill ui-ux-pro-max. Estas pruebas fijan los recuentos reales y
// las invariantes del extractor; si la skill cambia, aqui se ve primero.
//
// `scripts/build-design-intelligence.mjs` es el generador, sin dependencias.

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, "..", "data", "design-intelligence.json");
const raw = readFileSync(FILE, "utf8");
const data = JSON.parse(raw);

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test("recuentos: 194 productos, 34 patrones, 89 estilos, 74 parejas tipograficas", () => {
  assert.equal(data.products.length, 194);
  assert.equal(data.patterns.length, 34);
  assert.equal(data.styles.length, 89);
  assert.equal(data.typography.length, 74);
  // `generatedFrom` declara lo mismo que la realidad del archivo.
  assert.deepEqual(data.generatedFrom.counts, {
    products: 194,
    patterns: 34,
    styles: 89,
    typography: 74,
    palettes: 194,
  });
  assert.equal(data.generatedFrom.skills, "ui-ux-pro-max");
  assert.equal(data.generatedFrom.verifiedAt, "2026-11-04");
});

test("ids: unicos y con forma de slug en cada coleccion", () => {
  for (const name of ["products", "patterns", "styles", "typography"]) {
    const ids = data[name].map((entry) => entry.id);
    assert.equal(ids.length, new Set(ids).size, `ids repetidos en ${name}`);
    for (const id of ids) {
      assert.match(id, ID_RE, `id invalido en ${name}: ${id}`);
      assert.equal(id, id.toLowerCase(), `id no esta en minusculas en ${name}: ${id}`);
      assert.equal(
        id,
        id.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        `id con acentos en ${name}: ${id}`,
      );
    }
  }
});

test("perfil Dental Practice: estilos y consideraciones exactas", () => {
  const dental = data.products.find((p) => p.id === "dental-practice");
  assert.ok(dental, "falta el perfil dental-practice");
  assert.equal(dental.label, "Dental Practice");
  assert.deepEqual(dental.keywords, ["dental", "practice"]);
  assert.deepEqual(dental.primaryStyles, ["Soft UI Evolution", "Minimalism & Swiss Style"]);
  assert.deepEqual(dental.secondaryStyles, ["Accessible & Ethical", "Inclusive Design"]);
  assert.deepEqual(dental.considerations, [
    "Services",
    "Dentist profiles",
    "Before/after",
    "Online booking",
    "Insurance",
    "Patient testimonials",
    "Friendly imagery",
  ]);
  // "Before/after" exige que la barra sobreviva al recorte; "Patient
  // testimonials" que no se parta por el punto de la frase anterior.
  assert.ok(dental.considerations.includes("Before/after"));
  assert.ok(dental.considerations.includes("Patient testimonials"));
});

test("cruce landingPattern vs patterns: el patron de Dental Practice existe", () => {
  // products.csv usa una taxonomia corta ("Social Proof-Focused + Conversion")
  // que en landing.csv es un `alias`, no un `Pattern Name`. Por eso el cruce va
  // contra label ∪ aliases; contra label solo faltarian 172 de 194.
  const byLabel = new Set(data.patterns.map((p) => p.label));
  const byLabelOrAlias = new Set(byLabel);
  for (const pattern of data.patterns) {
    for (const alias of pattern.aliases) byLabelOrAlias.add(alias);
  }

  const dental = data.products.find((p) => p.id === "dental-practice");
  const resolved = data.patterns.find(
    (p) => p.label === dental.landingPattern || p.aliases.includes(dental.landingPattern),
  );
  assert.ok(resolved, `sin patron para "${dental.landingPattern}"`);
  assert.equal(resolved.label, "Hero + Testimonials + CTA");
  assert.ok(resolved.sections.length >= 3);

  const missing = data.products.filter((p) => !byLabelOrAlias.has(p.landingPattern));
  const missingAgainstLabelsOnly = data.products.filter((p) => !byLabel.has(p.landingPattern));

  // Cifras medidas, no deseadas: 48 productos apuntan a un patron que no existe
  // (38 etiquetas distintas; 4 son "N/A - ..." de productos de dashboard).
  assert.equal(missing.length, 48);
  assert.equal(missingAgainstLabelsOnly.length, 172);
  assert.ok(!missing.includes(dental), "Dental Practice no debe quedar sin patron");
});

test("secciones de patron: al menos 3 y ninguna vacia", () => {
  for (const pattern of data.patterns) {
    assert.ok(
      pattern.sections.length >= 3,
      `${pattern.id} tiene ${pattern.sections.length} secciones`,
    );
    for (const section of pattern.sections) {
      assert.equal(typeof section, "string");
      assert.notEqual(section.trim(), "", `seccion vacia en ${pattern.id}`);
      assert.match(section, ID_RE, `seccion no normalizada en ${pattern.id}: ${section}`);
    }
    // Sin repetir dentro del mismo patron.
    assert.equal(pattern.sections.length, new Set(pattern.sections).size, pattern.id);
  }
});

test("considerations: sin «undefined» ni «null»", () => {
  for (const product of data.products) {
    assert.ok(product.considerations.length > 0, `${product.id} sin consideraciones`);
    for (const item of product.considerations) {
      assert.equal(typeof item, "string");
      assert.notEqual(item.trim(), "", `${product.id} con consideracion vacia`);
      assert.doesNotMatch(item, /undefined|null/i, `${product.id}: ${item}`);
    }
  }
});

test("peso del archivo por debajo de 2 MB", () => {
  const bytes = statSync(FILE).size;
  assert.ok(bytes > 0);
  assert.ok(bytes < 2 * 1024 * 1024, `design-intelligence.json pesa ${bytes} bytes`);
});

test("estilos: los 89 estan, con el status tal cual del CSV (no se filtra)", () => {
  const counts = {};
  for (const style of data.styles) counts[style.status] = (counts[style.status] ?? 0) + 1;
  assert.deepEqual(counts, { active: 51, supplemental: 29, deprecated: 9 });
  const active = data.styles.find((s) => s.id === "minimalism-swiss-style");
  assert.ok(active, "falta minimalism-swiss-style");
  assert.equal(active.label, "Minimalism & Swiss Style");
  assert.equal(active.status, "active");
  assert.match(active.cssVariables, /--spacing/);
});

test("tipografia: id + columnas reales, sin el indice «No»", () => {
  const expectedKeys = [
    "id",
    "fontPairingName",
    "category",
    "headingFont",
    "bodyFont",
    "moodStyleKeywords",
    "bestFor",
    "googleFontsUrl",
    "cssImport",
    "tailwindConfig",
    "notes",
  ];
  for (const entry of data.typography) {
    assert.deepEqual(Object.keys(entry), expectedKeys);
    assert.ok(entry.headingFont);
    assert.ok(entry.bodyFont);
  }
  assert.equal(data.typography[0].id, "classic-elegant");
});
