import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "@webdesign/renderer";
import { SAMPLE } from "@webdesign/quality/test/fixtures.mjs";
import { lintHtml } from "../dist/index.js";
import { toMs } from "../dist/a11y.js";

// Reglas de accesibilidad y movimiento (ampliacion de Fase 4). Una prueba
// positiva y una negativa por regla: la positiva demuestra que detecta el
// defecto, la negativa que no lo inventa donde no lo hay.

const codes = (html) => lintHtml(html, "p_home").map((f) => f.code);
const page = (css) =>
  `<!doctype html><html lang="es"><head><style>${css}</style></head><body>` +
  `<section id="s1"><h1>Hola</h1><a href="#x">Ir</a><button>Enviar</button></section></body></html>`;

test("A11Y_NO_VISIBLE_FOCUS: se dispara si alguien quita el anillo y no lo repone", () => {
  const html = page("a,button{outline:none}");
  assert.ok(codes(html).includes("A11Y_NO_VISIBLE_FOCUS"));
});

test("A11Y_NO_VISIBLE_FOCUS: no se dispara con el anillo del navegador ni con :focus-visible", () => {
  // Nadie toca el outline: el navegador lo pinta, no hay defecto.
  assert.ok(!codes(page("a{color:#0645ad}")).includes("A11Y_NO_VISIBLE_FOCUS"));
  // Alguien lo quita pero repone uno propio: correcto.
  assert.ok(!codes(page("a,button{outline:none}\na:focus-visible{outline:2px solid #0645ad}")).includes("A11Y_NO_VISIBLE_FOCUS"));
});

test("MOTION_LAYOUT_ANIMATION: animar width o `all` es un defecto; transform no", () => {
  assert.ok(codes(page("a{transition:width .2s}")).includes("MOTION_LAYOUT_ANIMATION"));
  assert.ok(codes(page("a{transition:all .2s}")).includes("MOTION_LAYOUT_ANIMATION"));
  assert.ok(!codes(page("a{transition:transform .2s}")).includes("MOTION_LAYOUT_ANIMATION"));
  assert.ok(!codes(page("a{transition:opacity .2s, transform .2s}")).includes("MOTION_LAYOUT_ANIMATION"));
});

test("MOTION_NO_REDUCED_MOTION: con movimiento y sin consulta, avisa", () => {
  assert.ok(codes(page("a{transition:opacity .2s}")).includes("MOTION_NO_REDUCED_MOTION"));
  const conConsulta = page("a{transition:opacity .2s}\n@media (prefers-reduced-motion:reduce){a{transition:none}}");
  assert.ok(!codes(conConsulta).includes("MOTION_NO_REDUCED_MOTION"));
  // Sin movimiento no hay nada que reducir.
  assert.ok(!codes(page("a{color:#0645ad}")).includes("MOTION_NO_REDUCED_MOTION"));
});

test("MOTION_DURATION_OUT_OF_RANGE: ni imperceptible ni lenta", () => {
  assert.ok(codes(page("a{transition:opacity 40ms}")).includes("MOTION_DURATION_OUT_OF_RANGE"));
  assert.ok(codes(page("a{transition:opacity 1.2s}")).includes("MOTION_DURATION_OUT_OF_RANGE"));
  assert.ok(!codes(page("a{transition:opacity .3s}")).includes("MOTION_DURATION_OUT_OF_RANGE"));
});

test("toMs lee segundos y milisegundos, y rechaza lo que no es una duracion", () => {
  assert.equal(toMs("0.3s"), 300);
  assert.equal(toMs("300ms"), 300);
  assert.equal(toMs("1.5s"), 1500);
  assert.equal(toMs("rapido"), null);
  assert.equal(toMs("300"), null);
});

test("el sitio real del renderer no dispara las reglas nuevas", () => {
  // Si el renderer introdujera una animacion de layout o quitara el anillo de
  // foco, esto lo detecta antes de que llegue a un cliente.
  const html = renderPage(SAMPLE, "p_home");
  const c = codes(html);
  for (const code of ["A11Y_NO_VISIBLE_FOCUS", "MOTION_LAYOUT_ANIMATION", "MOTION_NO_REDUCED_MOTION", "MOTION_DURATION_OUT_OF_RANGE"]) {
    assert.ok(!c.includes(code), `${code} en el sitio de muestra: ${c.join(",")}`);
  }
});
