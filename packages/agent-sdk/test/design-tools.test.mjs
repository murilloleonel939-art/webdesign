import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callTool,
  critique,
  makeCritiqueTool,
  makeLintTools,
  recommendDesignSystem,
  tokens,
  trimFindings,
  MAX_FINDINGS,
} from "../dist/index.js";

// Herramientas de diseño de solo lectura. Se prueban sin red, sin base y sin
// modelo: los datos entran como argumento. Lo que se comprueba es el contrato
// del que depende el agente: nunca mutan, nunca publican y el recorte no pierde
// un `error`.

const ctx = { runId: "r1", userId: "u1", token: "t", locale: "es", apiBaseUrl: "http://x" };

const CANDIDATES = [
  { id: "editorial", name: "Editorial", summary: "para medios y revistas", keywords: ["texto", "lectura"] },
  { id: "bold", name: "Bold", summary: "para comida y bebida", keywords: ["cafeteria", "bar"] },
  { id: "calm", name: "Calm", summary: "para clinicas y salud", keywords: ["clinica", "dental"] },
];

test("recommend_design_system devuelve motivos, no una eleccion sin explicar", async () => {
  const r = await callTool(recommendDesignSystem, ctx, {
    businessType: "cafeteria de especialidad",
    candidates: CANDIDATES,
  });
  assert.equal(r.ok, true);
  const data = r.data;
  assert.ok(data.recommendations.length >= 1 && data.recommendations.length <= 3);
  assert.equal(data.recommendations[0].id, "bold");
  // El motivo cita las palabras que coincidieron: el dueno puede juzgarlo.
  assert.match(data.recommendations[0].reason, /cafeteria|bar/);
  assert.equal(data.noConfidentMatch, false);
});

test("recommend_design_system admite que no sabe y no inventa una recomendacion", async () => {
  const r = await callTool(recommendDesignSystem, ctx, {
    businessType: "criadero de trufas blancas",
    candidates: CANDIDATES,
  });
  assert.equal(r.ok, true);
  // Mejor decir que ninguno encaja que recomendar cualquier cosa.
  assert.deepEqual(r.data.recommendations, []);
  assert.equal(r.data.noConfidentMatch, true);
});

test("recommend_design_system no acepta candidatos inventados por el modelo", async () => {
  // Fuera del esquema: el llamador pasa los candidatos, no el modelo.
  const r = await callTool(recommendDesignSystem, ctx, { businessType: "cafeteria", candidates: "editorial" });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "INVALID_TOOL_INPUT");
});

test("tokens descarta palabras vacias y acentos, sin producir basura", () => {
  assert.deepEqual(tokens("Cafetería de especialidad"), ["cafeteria", "especialidad"]);
  assert.deepEqual(tokens("the best for my"), ["best"]);
});

test("las cuatro herramientas son de lectura: ninguna muta", () => {
  const [runLint, runVisualLint] = makeLintTools({ lintHtml: () => [], lintVisual: () => [] });
  const critiqueTool = makeCritiqueTool({ lintVisual: () => [] });
  for (const t of [recommendDesignSystem, runLint, runVisualLint, critiqueTool]) {
    assert.equal(t.mutates, false, t.name);
    // Sin scope de escritura ni de publicacion.
    assert.ok(!t.scopes.includes("design:write"), t.name);
    assert.ok(!t.scopes.includes("site:publish"), t.name);
  }
});

test("no existe ninguna herramienta de publicacion en el SDK", async () => {
  const sdk = await import("../dist/index.js");
  const nombres = Object.keys(sdk).map((k) => k.toLowerCase());
  assert.ok(!nombres.some((n) => n.includes("publish")));
});

test("run_lint y run_visual_lint recortan a 20 y ponen los errores delante", async () => {
  const muchos = [
    ...Array.from({ length: 30 }, (_, i) => ({ code: `INFO_${i}`, severity: "info", message: "m" })),
    { code: "SLOP_HEADING_SKIP", severity: "error", message: "salta de h1 a h3" },
  ];
  const [runLint] = makeLintTools({ lintHtml: () => muchos, lintVisual: () => [] });
  const r = await callTool(runLint, ctx, { html: "<h1>x</h1>" });
  assert.equal(r.ok, true);
  assert.equal(r.data.findings.length, MAX_FINDINGS);
  assert.equal(r.data.findings[0].code, "SLOP_HEADING_SKIP");
  assert.equal(r.data.truncated, 11);
  assert.equal(r.data.needsOwnerConfirmation, true);
});

test("sin errores, needsOwnerConfirmation es falso", async () => {
  const [runLint] = makeLintTools({
    lintHtml: () => [{ code: "SLOP_PADDING_CRAMPED", severity: "warning", message: "m" }],
    lintVisual: () => [],
  });
  const r = await callTool(runLint, ctx, { html: "<p>x</p>" });
  assert.equal(r.data.needsOwnerConfirmation, false);
});

test("run_visual_lint valida la entrada: un html vacio no llega al linter", async () => {
  let llamado = false;
  const [, runVisualLint] = makeLintTools({
    lintHtml: () => [],
    lintVisual: () => {
      llamado = true;
      return [];
    },
  });
  const r = await callTool(runVisualLint, ctx, { html: "" });
  assert.equal(r.ok, false);
  assert.equal(llamado, false);
});

test("critique_draft devuelve como mucho 3 problemas y en orden fijo", () => {
  const findings = [
    { code: "SLOP_CENTERED_EVERYTHING", severity: "info", message: "todo centrado" },
    { code: "SLOP_LOW_CONTRAST_TEXT_ON_COLOR", severity: "error", message: "contraste bajo" },
    { code: "SLOP_NESTED_CARDS", severity: "warning", message: "tarjetas anidadas" },
    { code: "SLOP_HEADING_SKIP", severity: "error", message: "salto de nivel" },
  ];
  const out = critique(findings);
  assert.equal(out.problems.length, 3);
  // Lo que rompe el sitio va primero, siempre, sin depender del modelo.
  assert.equal(out.problems[0].code, "SLOP_LOW_CONTRAST_TEXT_ON_COLOR");
  assert.equal(out.problems[1].code, "SLOP_HEADING_SKIP");
});

test("critique es determinista: el mismo borrador da los mismos 3 problemas", () => {
  const findings = [
    { code: "SLOP_NESTED_CARDS", severity: "warning", message: "a" },
    { code: "SLOP_NESTED_CARDS", severity: "warning", message: "b" },
    { code: "SLOP_HEADING_SKIP", severity: "error", message: "c" },
  ];
  assert.deepEqual(critique(findings), critique([...findings].reverse()));
  // Un codigo repetido no ocupa dos de las tres plazas.
  assert.equal(critique(findings).problems.filter((p) => p.code === "SLOP_NESTED_CARDS").length, 1);
});

test("un codigo nuevo desconocido no se pierde, va detras", () => {
  const out = critique([
    { code: "REGLA_NUEVA", severity: "error", message: "nueva" },
    { code: "SLOP_CENTERED_EVERYTHING", severity: "info", message: "centrado" },
  ]);
  assert.deepEqual(out.problems.map((p) => p.code), ["SLOP_CENTERED_EVERYTHING", "REGLA_NUEVA"]);
});

test("critique_draft se expone como herramienta de lectura", async () => {
  const t = makeCritiqueTool({
    lintVisual: () => [{ code: "SLOP_HEADING_SKIP", severity: "error", message: "salto" }],
  });
  const r = await callTool(t, ctx, { html: "<h1>x</h1><h3>y</h3>" });
  assert.equal(r.ok, true);
  assert.equal(r.data.problems.length, 1);
});

test("trimFindings conserva sectionId cuando existe", () => {
  const out = trimFindings([{ code: "A", severity: "error", message: "m", sectionId: "s1" }]);
  assert.equal(out.findings[0].sectionId, "s1");
});
