import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "@webdesign/linter";
import { SECTION_TYPES } from "@webdesign/site-schema";
import {
  KNOWN_FAMILIES,
  MIN_CONTRAST,
  buildReport,
  lit,
  mapFamily,
  normalizePalette,
  normalizeSections,
  parseCsv,
  sqlForReport,
} from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data");
const read = (name) => parseCsv(readFileSync(join(DATA, `${name}.csv`), "utf8"));
const real = () =>
  buildReport({ colors: read("colors"), typography: read("typography"), landing: read("landing"), products: read("products"), styles: read("styles") });

test("el CSV respeta comillas, comas y saltos dentro de un campo", () => {
  const rows = parseCsv('a,b\n"uno, dos","linea\nnueva"\n"con ""comillas""",x\n');
  assert.deepEqual(rows, [
    { a: "uno, dos", b: "linea\nnueva" },
    { a: 'con "comillas"', b: "x" },
  ]);
});

test("una comilla sin cerrar es un error, no una fila corrupta", () => {
  assert.throws(() => parseCsv('a\n"sin cerrar\n'), /comilla sin cerrar/);
});

test("paleta: se prefiere el rol Primary y se cae a Accent solo si Primary no llega", () => {
  // Primary #2563eb sobre blanco pasa: es el que se elige.
  const ok = normalizePalette({ background: "#ffffff", foreground: "#111111", primary: "#2563eb", accent: "#f97316" });
  assert.equal(ok.colors.accent, "#2563eb");
  assert.equal(ok.verdict.status, "active");
  // Primary amarillo no pasa; Accent oscuro si: se cae a Accent.
  const cae = normalizePalette({ background: "#ffffff", foreground: "#111111", primary: "#fde047", accent: "#1d4ed8" });
  assert.equal(cae.colors.accent, "#1d4ed8");
});

test("paleta: el umbral no se relaja; si ninguno llega, entra supplemental con el motivo", () => {
  const p = normalizePalette({ background: "#ffffff", foreground: "#111111", primary: "#fde047", accent: "#facc15" });
  assert.equal(p.verdict.status, "supplemental");
  assert.match(p.verdict.reasons.join(" "), /contraste acento\/fondo/);
  // Y nunca se fabrica un color: el acento es uno de los del origen.
  assert.ok(["#fde047", "#facc15"].includes(p.colors.accent));
});

test("paleta sin hex valido no entra", () => {
  assert.equal(normalizePalette({ background: "blanco", foreground: "#111111", primary: "#2563eb" }), null);
});

test("las familias del importador son exactamente las que el renderer sabe pintar", () => {
  // theme-css.ts no exporta su tabla; se lee el fuente. Si alguien anade o quita
  // una familia alli y no aqui, el importador ofreceria una que cae al sans por
  // defecto sin avisar.
  const css = readFileSync(join(HERE, "..", "..", "renderer", "src", "theme-css.ts"), "utf8");
  const bloque = css.slice(css.indexOf("FAMILY_FALLBACK"), css.indexOf("};", css.indexOf("FAMILY_FALLBACK")));
  const claves = [...bloque.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z]+)):/gm)].map((m) => m[1] ?? m[2]);
  assert.deepEqual([...claves].sort(), [...KNOWN_FAMILIES].sort());
});

test("una webfont del origen se traduce a una familia del sistema y dice que se pierde", () => {
  const m = mapFamily("Playfair Display");
  assert.equal(m.family, "Fraunces");
  assert.match(m.lost, /sin webfont/);
  assert.equal(mapFamily("Inter").lost, "");
  assert.equal(mapFamily("JetBrains Mono").family, "Mono");
});

test("secciones: nunca se inventa un tipo; el footer se descarta y queda anotado", () => {
  const out = normalizeSections("Hero > Problem statement > Testimonials carousel > Pricing > Footer");
  assert.deepEqual(out.sections, ["hero", "testimonial", "pricing"]);
  assert.ok(out.dropped.includes("Footer"));
  assert.ok(out.dropped.includes("Problem statement"));
});

test("un patron sin hero entra supplemental", () => {
  const out = normalizeSections("Features > Pricing > FAQ");
  assert.equal(out.verdict.status, "supplemental");
  assert.match(out.verdict.reasons.join(" "), /hero/);
});

test("datos reales: ninguna fila activa incumple lo que la plataforma exige", () => {
  const r = real();
  for (const p of r.palettes.filter((x) => x.status === "active")) {
    assert.ok(contrastRatio(p.colors.ink, p.colors.ground) >= MIN_CONTRAST, p.id);
    assert.ok(contrastRatio(p.colors.accent, p.colors.ground) >= MIN_CONTRAST, p.id);
  }
  for (const f of r.pairings) {
    assert.ok(KNOWN_FAMILIES.includes(f.headingFamily), f.id);
    assert.ok(KNOWN_FAMILIES.includes(f.bodyFamily), f.id);
  }
  for (const l of r.patterns) {
    for (const t of l.sections) assert.ok(SECTION_TYPES.includes(t), `${l.id}: ${t}`);
    assert.ok(l.sections.length <= 15, l.id);
  }
  // Recuentos fijados: si el origen o la normalizacion cambian, se ve en la prueba.
  assert.equal(r.palettes.length, 192);
  assert.equal(r.palettes.filter((x) => x.status === "active").length, 140);
});

test("ids estables: dos importaciones producen los mismos ids y sin duplicados", () => {
  const a = real();
  const b = real();
  for (const k of ["palettes", "pairings", "patterns", "products", "styles"]) {
    const ids = a[k].map((x) => x.id);
    assert.deepEqual(ids, b[k].map((x) => x.id), k);
    assert.equal(new Set(ids).size, ids.length, `${k} con ids duplicados`);
  }
});

test("el SQL escapa comillas y es idempotente (ON CONFLICT)", () => {
  assert.equal(lit("O'Brien"), "'O''Brien'");
  const sql = sqlForReport(real());
  assert.match(sql, /^-- Catalogo importado/);
  assert.equal((sql.match(/ON CONFLICT \(id\)/g) ?? []).length, 5);
  // Los estilos importados son referencia, nunca presets aplicables. Se mira la
  // columna `kind` de las filas de design_styles, no la palabra suelta: "preset"
  // aparece dentro de textos de producto y ahi es legitimo.
  const estilos = sql.slice(sql.indexOf("INSERT INTO design_styles"), sql.indexOf("INSERT INTO design_palettes"));
  assert.match(estilos, /'reference'/);
  assert.doesNotMatch(estilos, /'preset'/);
});
