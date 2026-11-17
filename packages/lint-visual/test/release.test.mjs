import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "@webdesign/renderer";
import { SAMPLE, samplePage } from "@webdesign/quality/test/fixtures.mjs";
import { lintHtml, needsOwnerConfirmation } from "../dist/index.js";

// Aceptacion de Fase 4: el linter visual corre sobre el HTML del release, no
// sobre un fixture escrito a mano. Si el renderer cambia, estas pruebas lo
// detectan; las de la tabla de 6.5 prueban las reglas en aislamiento.

// Se reutiliza el sitio de muestra de `@webdesign/quality`: ya esta validado
// contra el esquema y contra html-validate, asi que prueba el linter contra el
// HTML que el renderer produce de verdad en lugar de un fixture paralelo.

test("el sitio de muestra renderiza y el linter devuelve el contrato", () => {
  const html = renderPage(SAMPLE, "p_home");
  assert.ok(html.includes("Café de especialidad"));
  const findings = lintHtml(html, "p_home");
  assert.ok(Array.isArray(findings));
  for (const f of findings) {
    assert.equal(f.pageId, "p_home");
    assert.equal(typeof f.code, "string");
    assert.equal(typeof f.message, "string");
    assert.equal(typeof f.autofixable, "boolean");
  }
});

test("el sistema de diseno de la plataforma no dispara sus propias reglas", () => {
  // El tema del catalogo usa `var(--radius)` y rejillas auto-fit: eso es una
  // decision del sistema de diseno, no un tic de plantilla. Si el linter lo
  // marcara, avisaria en todos los sitios y dejaria de servir.
  const codes = lintHtml(renderPage(SAMPLE, "p_home"), "p_home").map((f) => f.code);
  assert.ok(!codes.includes("SLOP_UNRESPONSIVE_GRID"), codes.join(","));
  assert.ok(!codes.includes("SLOP_SAME_CARD_RADIUS"), codes.join(","));
  assert.ok(!codes.includes("SLOP_NO_VISUAL_HIERARCHY"), codes.join(","));
  assert.ok(!codes.includes("SLOP_GENERIC_GRADIENT"), codes.join(","));
});

test("el renderer no salta niveles de encabezado", () => {
  // Regresion: `features` y `pricing` pintaban <h3> sin <h2> de seccion, asi
  // que tras el h1 del hero la jerarquia saltaba. Lo detecto este linter y se
  // corrigio en ui-components dando titular opcional a text/features/pricing.
  const codes = lintHtml(renderPage(SAMPLE, "p_home"), "p_home").map((f) => f.code);
  assert.ok(!codes.includes("SLOP_HEADING_SKIP"), codes.join(","));
});

test("el linter detecta el titular que salta de nivel en HTML real", () => {
  const broken = structuredClone(SAMPLE);
  broken.pages[0].sections = [
    { id: "s1", type: "hero", props: { headline: "Uno", cta: { label: "Ir", href: "#contacto" }, subline: "" } },
    { id: "s9", type: "features", props: { items: [{ title: "A", body: "a" }] } },
  ];
  const findings = lintHtml(renderPage(broken, "p_home"), "p_home");
  assert.ok(findings.some((f) => f.code === "SLOP_HEADING_SKIP"), findings.map((f) => f.code).join(","));
});

test("un error de 6.5 exige confirmacion pero no bloquea", () => {
  const broken = structuredClone(SAMPLE);
  broken.pages[0].sections = [
    { id: "s1", type: "hero", props: { headline: "Uno", cta: { label: "Ir", href: "#contacto" }, subline: "" } },
    { id: "s9", type: "features", props: { items: [{ title: "A", body: "a" }] } },
  ];
  assert.equal(needsOwnerConfirmation(lintHtml(renderPage(broken, "p_home"), "p_home")), true);
});

test("SLOP_PLACEHOLDER_TEXT detecta el marcador de 9.1 en el release", () => {
  // El modo rapido deja "pendiente de confirmar" a proposito: el linter debe
  // avisar de que esa version no esta lista, sin impedir publicarla.
  const draft = structuredClone(SAMPLE);
  draft.pages[0].sections[1].props.body = "pendiente de confirmar";
  const findings = lintHtml(renderPage(draft, "p_home"), "p_home");
  const f = findings.find((x) => x.code === "SLOP_PLACEHOLDER_TEXT");
  assert.ok(f, findings.map((x) => x.code).join(","));
  assert.equal(f.severity, "warning");
  assert.equal(f.autofixable, false);
});

test("el HTML del release declara el CSP y el linter no lo rompe", () => {
  const html = renderPage(SAMPLE, "p_home");
  assert.ok(html.includes("Content-Security-Policy"));
  const findings = lintHtml(html, "p_home");
  // Ninguna regla debe sugerir HTML crudo: el sitio se sirve con CSP estricta.
  assert.ok(!findings.some((x) => /script|iframe/i.test(x.fixHint ?? "")));
});
