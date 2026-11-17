import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "@webdesign/renderer";
import { SAMPLE } from "@webdesign/quality/test/fixtures.mjs";
import { lintHtml } from "../dist/index.js";

// Ampliacion ui-skills (ver NOTICE): nombres accesibles, etiquetas de campo,
// texto de enlace, semantica de lista, escala de z-index y acento unico.
//
// Una prueba positiva y una negativa por regla: la positiva demuestra que el
// defecto se ve, la negativa que no se inventa donde no lo hay. Las ideas vienen
// de ibelick/ui-skills (MIT), reimplementadas sin dependencia ni runtime; sus
// reglas de Tailwind, motion/react, `h-dvh` o `backdrop-filter` no aplican a
// nuestro renderer y se descartan a proposito.

const page = (body, css = "") =>
  `<!DOCTYPE html><html lang="es"><head><style>:root{--ground:#ffffff;--ink:#111111;--accent:#0b5fff}body{margin:0;background:var(--ground);color:var(--ink)}${css}</style></head><body>${body}</body></html>`;

const findings = (html) => lintHtml(html, "p1");
const codes = (html) => findings(html).map((f) => f.code);
const only = (html, code) => findings(html).find((f) => f.code === code);

// --- 1. A11Y_CONTROL_NO_ACCESSIBLE_NAME ------------------------------------

test("A11Y_CONTROL_NO_ACCESSIBLE_NAME: un boton solo con icono y sin nombre dispara", () => {
  // Un <svg> dentro no es nombre: sin <title> es decoracion.
  const html = page('<section data-section-id="s1"><button><svg viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg></button></section>');
  const f = only(html, "A11Y_CONTROL_NO_ACCESSIBLE_NAME");
  assert.ok(f);
  assert.equal(f.severity, "error");
  assert.equal(f.sectionId, "s1");
});

test("A11Y_CONTROL_NO_ACCESSIBLE_NAME: no dispara con texto, aria-label, aria-labelledby ni title", () => {
  assert.ok(!codes(page("<button>Enviar</button>")).includes("A11Y_CONTROL_NO_ACCESSIBLE_NAME"));
  assert.ok(!codes(page('<button aria-label="Cerrar"><svg></svg></button>')).includes("A11Y_CONTROL_NO_ACCESSIBLE_NAME"));
  assert.ok(!codes(page('<h2 id="t">Menú</h2><button aria-labelledby="t"><svg></svg></button>')).includes("A11Y_CONTROL_NO_ACCESSIBLE_NAME"));
  assert.ok(!codes(page('<a href="#x" title="Ir al inicio"><svg></svg></a>')).includes("A11Y_CONTROL_NO_ACCESSIBLE_NAME"));
  // Un control oculto no llega a quien usa lector: no se reporta.
  assert.ok(!codes(page('<button aria-hidden="true"><svg></svg></button>')).includes("A11Y_CONTROL_NO_ACCESSIBLE_NAME"));
});

// --- 2. A11Y_FIELD_UNLABELED ----------------------------------------------

test("A11Y_FIELD_UNLABELED: un input sin label asociado dispara", () => {
  const f = only(page('<section data-section-id="s2"><input type="email" name="e"></section>'), "A11Y_FIELD_UNLABELED");
  assert.ok(f);
  assert.equal(f.severity, "error");
  assert.equal(f.sectionId, "s2");
});

test("A11Y_FIELD_UNLABELED: no dispara con for/id, label envolvente, aria-label ni tipos excluidos", () => {
  assert.ok(!codes(page('<label for="n">Nombre</label><input id="n" type="text">')).includes("A11Y_FIELD_UNLABELED"));
  assert.ok(!codes(page("<label>Correo <input type=\"email\"></label>")).includes("A11Y_FIELD_UNLABELED"));
  assert.ok(!codes(page('<textarea aria-label="Mensaje"></textarea>')).includes("A11Y_FIELD_UNLABELED"));
  assert.ok(!codes(page('<input type="hidden" name="t"><input type="submit" value="Ir">')).includes("A11Y_FIELD_UNLABELED"));
});

// --- 3. A11Y_LINK_VAGUE_TEXT ----------------------------------------------

test("A11Y_LINK_VAGUE_TEXT: vacio y 'click here' disparan", () => {
  const vacio = only(page('<a href="#x"></a>'), "A11Y_LINK_VAGUE_TEXT");
  assert.ok(vacio);
  assert.equal(vacio.severity, "warning");
  // Se compara recortado y en minusculas, con y sin tilde.
  assert.ok(codes(page('<a href="#x">  Click Here </a>')).includes("A11Y_LINK_VAGUE_TEXT"));
  assert.ok(codes(page('<a href="#x">leer más</a>')).includes("A11Y_LINK_VAGUE_TEXT"));
});

test("A11Y_LINK_VAGUE_TEXT: no dispara con texto propio ni con una imagen de alt util", () => {
  assert.ok(!codes(page('<a href="#carta">Ver la carta</a>')).includes("A11Y_LINK_VAGUE_TEXT"));
  // El alt es el texto accesible: no es vago, aunque no haya texto visible.
  assert.ok(!codes(page('<a href="#x"><img src="/a.png" alt="Fachada del local"></a>')).includes("A11Y_LINK_VAGUE_TEXT"));
});

// --- 4. A11Y_LIST_NOT_SEMANTIC --------------------------------------------

test("A11Y_LIST_NOT_SEMANTIC: un li fuera de lista dispara", () => {
  const f = only(page('<section data-section-id="s4"><div><li>Uno</li></div></section>'), "A11Y_LIST_NOT_SEMANTIC");
  assert.ok(f);
  assert.equal(f.severity, "warning");
  assert.equal(f.sectionId, "s4");
  // Una lista pintada con div y guiones tambien.
  assert.ok(codes(page("<section><div>- Uno\n- Dos</div></section>")).includes("A11Y_LIST_NOT_SEMANTIC"));
});

test("A11Y_LIST_NOT_SEMANTIC: no dispara con ul, ol, menu ni role=list", () => {
  assert.ok(!codes(page("<ul><li>Uno</li><li>Dos</li></ul>")).includes("A11Y_LIST_NOT_SEMANTIC"));
  assert.ok(!codes(page("<ol><li>Uno</li></ol>")).includes("A11Y_LIST_NOT_SEMANTIC"));
  assert.ok(!codes(page("<menu><li>Uno</li></menu>")).includes("A11Y_LIST_NOT_SEMANTIC"));
  assert.ok(!codes(page('<div role="list"><li>Uno</li></div>')).includes("A11Y_LIST_NOT_SEMANTIC"));
});

// --- 5. SLOP_Z_INDEX_ARBITRARY --------------------------------------------

test("SLOP_Z_INDEX_ARBITRARY: z-index 9999 dispara y se lee de ctx.styles", () => {
  const f = only(page('<section data-section-id="s5"><div class="top">x</div></section>', ".top{z-index:9999}"), "SLOP_Z_INDEX_ARBITRARY");
  assert.ok(f);
  assert.equal(f.severity, "warning");
  assert.equal(f.sectionId, "s5");
  // Tambien cuando viene por `style=`, que el CSS crudo no contiene.
  assert.ok(codes(page('<div style="z-index:100">x</div>')).includes("SLOP_Z_INDEX_ARBITRARY"));
});

test("SLOP_Z_INDEX_ARBITRARY: la escala y el valor inicial no disparan", () => {
  const escala = page('<div class="a">x</div>', ".a{z-index:30}");
  assert.ok(!codes(escala).includes("SLOP_Z_INDEX_ARBITRARY"));
  assert.ok(!codes(page('<div class="b">x</div>', ".b{z-index:-10}")).includes("SLOP_Z_INDEX_ARBITRARY"));
  assert.ok(!codes(page('<div class="c">x</div>', ".c{z-index:auto}")).includes("SLOP_Z_INDEX_ARBITRARY"));
  assert.ok(!codes(page("<div>x</div>")).includes("SLOP_Z_INDEX_ARBITRARY"));
});

// --- 6. SLOP_MULTIPLE_ACCENTS ---------------------------------------------

test("SLOP_MULTIPLE_ACCENTS: dos acentos distintos en la pagina disparan", () => {
  const html = page(
    '<section data-section-id="s6"><a href="#x" class="uno">Ir</a><button class="dos">Enviar</button></section>',
    ".uno{color:#0b5fff}.dos{background:#d93025}",
  );
  const f = only(html, "SLOP_MULTIPLE_ACCENTS");
  assert.ok(f);
  assert.equal(f.severity, "info");
});

test("SLOP_MULTIPLE_ACCENTS: un solo acento, cero acentos o colores no computables no disparan", () => {
  // Un unico acento, repetido en enlace y boton: es el sistema de diseno.
  assert.ok(!codes(page(
    '<a href="#x" class="u">Ir</a><button class="d">Enviar</button>',
    ".u{color:#0b5fff}.d{background:#0b5fff}",
  )).includes("SLOP_MULTIPLE_ACCENTS"));
  // Sin botones ni enlaces no hay acento que contar.
  assert.ok(!codes(page("<p>Solo texto</p>")).includes("SLOP_MULTIPLE_ACCENTS"));
  // `transparent`, `inherit` y `currentcolor` no son colores de acento.
  assert.ok(!codes(page(
    '<a href="#x" class="u">Ir</a><button class="d">Enviar</button>',
    ".u{color:currentcolor}.d{background:transparent}",
  )).includes("SLOP_MULTIPLE_ACCENTS"));
});

// --- Contra el HTML que genera el renderer --------------------------------

test("el sitio del renderer no dispara ninguna de las seis reglas nuevas", () => {
  // Si alguna saltara en todos los sitios, el aviso dejaria de leerse. Esta
  // prueba lo detecta antes de que llegue a un cliente.
  const nuevas = [
    "A11Y_CONTROL_NO_ACCESSIBLE_NAME",
    "A11Y_FIELD_UNLABELED",
    "A11Y_LINK_VAGUE_TEXT",
    "A11Y_LIST_NOT_SEMANTIC",
    "SLOP_Z_INDEX_ARBITRARY",
    "SLOP_MULTIPLE_ACCENTS",
  ];
  for (const pid of ["p_home", "p_precios"]) {
    const c = codes(renderPage(SAMPLE, pid));
    for (const code of nuevas) assert.ok(!c.includes(code), `${code} en ${pid}: ${c.join(",")}`);
  }
});
