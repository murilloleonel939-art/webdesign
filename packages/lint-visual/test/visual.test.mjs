import { test } from "node:test";
import assert from "node:assert/strict";
import { lintHtml, needsOwnerConfirmation } from "../dist/index.js";

// Spec 6.5: "cada regla nueva lleva su codigo, severidad, prueba y entrada en
// esta tabla". Cada regla tiene aqui un caso positivo (debe disparar) y uno
// negativo (no debe disparar), para que el linter no se convierta en ruido.

const page = (body, css = "") =>
  `<!DOCTYPE html><html lang="es"><head><style>:root{--ground:#ffffff;--ink:#111111;--accent:#0b5fff;--radius:8px;--margin:16px;--gap:48px}body{margin:0;background:var(--ground);color:var(--ink);font-family:Inter,sans-serif;font-size:16px}h1{font-size:2.6rem}h2{font-size:1.8rem}${css}</style></head><body>${body}</body></html>`;

const codes = (html, opts) => lintHtml(html, "p1", opts).map((f) => f.code);

test("devuelve el contrato LintFinding", () => {
  const [f] = lintHtml(page("<h1>x</h1><h3>y</h3>"), "p1");
  assert.ok(f);
  assert.equal(typeof f.code, "string");
  assert.ok(["error", "warning", "info"].includes(f.severity));
  assert.equal(typeof f.autofixable, "boolean");
  assert.equal(f.pageId, "p1");
});

test("SLOP_HEADING_SKIP: h1->h3 dispara, h1->h2 no", () => {
  assert.ok(codes(page("<h1>a</h1><h3>b</h3>")).includes("SLOP_HEADING_SKIP"));
  assert.ok(!codes(page("<h1>a</h1><h2>b</h2><h3>c</h3>")).includes("SLOP_HEADING_SKIP"));
});

test("SLOP_HEADING_SKIP: es error y exige confirmacion", () => {
  const f = lintHtml(page("<h1>a</h1><h3>b</h3>")).find((x) => x.code === "SLOP_HEADING_SKIP");
  assert.equal(f.severity, "error");
  assert.equal(needsOwnerConfirmation([f]), true);
});

test("SLOP_LOW_CONTRAST_TEXT_ON_COLOR: bajo dispara, alto no", () => {
  const low = page('<section><p style="color:#cccccc">hola</p></section>',
    "section{background:#ffffff}");
  const high = page('<section><p style="color:#111111">hola</p></section>',
    "section{background:#ffffff}");
  assert.ok(codes(low).includes("SLOP_LOW_CONTRAST_TEXT_ON_COLOR"));
  assert.ok(!codes(high).includes("SLOP_LOW_CONTRAST_TEXT_ON_COLOR"));
});

test("SLOP_GENERIC_GRADIENT: violeta-azul dispara, otro par no", () => {
  const generic = page('<section><h1>a</h1></section>',
    "section{background:linear-gradient(90deg,#7c3aed,#2563eb)}");
  // Verde a naranja: fuera del rango violeta-azul, sin discusion.
  const other = page('<section><h1>a</h1></section>',
    "section{background:linear-gradient(90deg,#15803d,#ea580c)}");
  assert.ok(codes(generic).includes("SLOP_GENERIC_GRADIENT"));
  assert.ok(!codes(other).includes("SLOP_GENERIC_GRADIENT"));
});

test("SLOP_GENERIC_GRADIENT: no avisa si el degradado usa el acento del tema", () => {
  // La identidad del negocio puede ser violeta: eso no es plantilla.
  const own = page('<section><h1>a</h1></section>',
    "section{background:linear-gradient(90deg,#7c3aed,#2563eb)}")
    .replace("--accent:#0b5fff", "--accent:#7c3aed");
  assert.ok(!codes(own).includes("SLOP_GENERIC_GRADIENT"));
});

test("SLOP_FONT_MONOCULTURE: solo avisa si la entrada definia pairing", () => {
  const html = page("<h1>a</h1><p>b</p>", "h1,p{font-family:serif}");
  assert.ok(codes(html, { pairingExpected: true }).includes("SLOP_FONT_MONOCULTURE"));
  assert.ok(!codes(html).includes("SLOP_FONT_MONOCULTURE"));
});

test("SLOP_NO_VISUAL_HIERARCHY: iguales dispara, escala correcta no", () => {
  const flat = page("<h1>a</h1><h2>b</h2>", "h1,h2{font-size:1rem}");
  assert.ok(codes(flat).includes("SLOP_NO_VISUAL_HIERARCHY"));
  assert.ok(!codes(page("<h1>a</h1><h2>b</h2>")).includes("SLOP_NO_VISUAL_HIERARCHY"));
});

test("SLOP_PLACEHOLDER_TEXT: lorem dispara", () => {
  assert.ok(codes(page("<h1>a</h1><p>Lorem ipsum dolor</p>")).includes("SLOP_PLACEHOLDER_TEXT"));
  assert.ok(!codes(page("<h1>a</h1><p>Fontaneria en Madrid</p>")).includes("SLOP_PLACEHOLDER_TEXT"));
});

test("SLOP_PLACEHOLDER_TEXT no bloquea: es warning", () => {
  const f = lintHtml(page("<p>pendiente de confirmar</p>")).find((x) => x.code === "SLOP_PLACEHOLDER_TEXT");
  assert.equal(f.severity, "warning");
  assert.equal(needsOwnerConfirmation([f]), false);
});

test("SLOP_UNRESPONSIVE_GRID: 3 columnas fijas dispara, auto-fit no", () => {
  const fixed = page('<section><div class="g"><i></i></div></section>',
    ".g{display:grid;grid-template-columns:repeat(3,200px)}");
  const auto = page('<section><div class="g"><i></i></div></section>',
    ".g{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}");
  assert.ok(codes(fixed).includes("SLOP_UNRESPONSIVE_GRID"));
  assert.ok(!codes(auto).includes("SLOP_UNRESPONSIVE_GRID"));
});

test("SLOP_FIXED_WIDTH_OVERFLOW: 900px dispara, con max-width no", () => {
  const wide = page('<section><div class="w">a</div></section>', ".w{width:900px}");
  const safe = page('<section><div class="w">a</div></section>', ".w{width:900px;max-width:100%}");
  assert.ok(codes(wide).includes("SLOP_FIXED_WIDTH_OVERFLOW"));
  assert.ok(!codes(safe).includes("SLOP_FIXED_WIDTH_OVERFLOW"));
});

test("SLOP_SHADOW_ON_EVERYTHING: todos con sombra dispara", () => {
  const all = page("<section><div>a</div><div>b</div><div>c</div><div>d</div><div>e</div></section>",
    "section div{box-shadow:0 2px 4px #0003}");
  assert.ok(codes(all).includes("SLOP_SHADOW_ON_EVERYTHING"));
  assert.ok(!codes(page("<section><div>a</div><div>b</div><div>c</div><div>d</div><div>e</div></section>"))
    .includes("SLOP_SHADOW_ON_EVERYTHING"));
});

test("SLOP_NESTED_CARDS: tres niveles dispara, uno no", () => {
  const deep = page('<section><div class="c"><div class="c"><div class="c">x</div></div></div></section>',
    ".c{background:#fff;border:1px solid #ddd}");
  assert.ok(codes(deep).includes("SLOP_NESTED_CARDS"));
  assert.ok(!codes(page('<section><div class="c">x</div></section>',
    ".c{background:#fff;border:1px solid #ddd}")).includes("SLOP_NESTED_CARDS"));
});

test("SLOP_CENTERED_EVERYTHING: todo centrado dispara", () => {
  const centered = page("<section><h1>a</h1><h2>b</h2><p>c</p><p>d</p></section>",
    "section h1,section h2,section p{text-align:center}");
  assert.ok(codes(centered).includes("SLOP_CENTERED_EVERYTHING"));
  assert.ok(!codes(page("<section><h1>a</h1><h2>b</h2><p>c</p><p>d</p></section>"))
    .includes("SLOP_CENTERED_EVERYTHING"));
});

test("SLOP_SAME_CARD_RADIUS: no avisa cuando el radio viene de var()", () => {
  // El tema del catalogo usa `var(--radius)` en todo: es decision del sistema
  // de diseno, no plantilla repetida.
  const themed = page("<section><div>a</div><div>b</div><div>c</div><div>d</div></section>",
    "section div{border-radius:var(--radius)}");
  assert.ok(!codes(themed).includes("SLOP_SAME_CARD_RADIUS"));
});

test("SLOP_TOUCH_TARGET_SMALL: enlace diminuto dispara", () => {
  const small = page('<section><a href="/x" class="t">ir</a></section>',
    ".t{font-size:10px;padding:2px}");
  assert.ok(codes(small).includes("SLOP_TOUCH_TARGET_SMALL"));
  const big = page('<section><a href="/x" class="t">ir</a></section>',
    ".t{font-size:16px;padding:14px 20px;min-height:44px}");
  assert.ok(!codes(big).includes("SLOP_TOUCH_TARGET_SMALL"));
});

test("SLOP_PADDING_CRAMPED: solo con ritmo declarado", () => {
  const html = page('<section><div class="p">a</div></section>', ".p{padding:4px}");
  assert.ok(codes(html, { rhythmPx: 48 }).includes("SLOP_PADDING_CRAMPED"));
  assert.ok(!codes(html).includes("SLOP_PADDING_CRAMPED"));
});

test("ningun codigo fuera de la tabla de 6.5", () => {
  const allowed = new Set(["SLOP_FONT_MONOCULTURE","SLOP_GENERIC_GRADIENT","SLOP_NESTED_CARDS",
    "SLOP_ICON_TILE_ABOVE_EVERY_HEADING","SLOP_LOW_CONTRAST_TEXT_ON_COLOR","SLOP_HEADING_SKIP",
    "SLOP_PADDING_CRAMPED","SLOP_CENTERED_EVERYTHING","SLOP_SAME_CARD_RADIUS",
    "SLOP_SHADOW_ON_EVERYTHING","SLOP_NO_VISUAL_HIERARCHY","SLOP_UNRESPONSIVE_GRID",
    "SLOP_FIXED_WIDTH_OVERFLOW","SLOP_TOUCH_TARGET_SMALL","SLOP_PLACEHOLDER_TEXT"]);
  const messy = page('<section><h1>a</h1><h3>b</h3><p style="color:#eee">Lorem ipsum</p></section>',
    "section{background:linear-gradient(90deg,#7c3aed,#2563eb)}h1,h2{font-size:1rem}");
  for (const c of codes(messy, { pairingExpected: true, rhythmPx: 48 })) {
    assert.ok(allowed.has(c), `codigo no declarado en 6.5: ${c}`);
  }
});

test("no ejecuta scripts del HTML analizado", () => {
  const html = page('<section><h1>a</h1><script>globalThis.__pwned=1</script></section>');
  lintHtml(html);
  assert.equal(globalThis.__pwned, undefined);
});

test("HTML vacio o invalido no revienta", () => {
  assert.deepEqual(lintHtml(""), []);
  assert.deepEqual(lintHtml(null), []);
  assert.doesNotThrow(() => lintHtml("<html><body><p>"));
});
