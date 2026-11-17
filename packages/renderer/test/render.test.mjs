import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, escapeHtml } from "../dist/index.js";

const doc = () => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [{
    id: "p_home", slug: "/", seo: { title: "Inicio", description: "desc", noindex: false },
    sections: [
      { id: "s_hero", type: "hero", props: { headline: "Hola", cta: { label: "Ir", href: "https://x.com" } } },
      { id: "s_img", type: "image", props: { assetId: "a1" } },
    ],
  }],
  assets: [{ id: "a1", alt: "Foto" }],
});

test("escapes user text", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  const d = doc();
  d.pages[0].sections[0].props.headline = "<img src=x onerror=alert(1)>";
  const html = renderPage(d, "p_home");
  assert.ok(!html.includes("<img src=x onerror"));
});

test("renders title, description, CSP and lang", () => {
  const html = renderPage(doc(), "p_home");
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="es">/);
  assert.match(html, /<title>Inicio<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'none'/);
});

test("external links carry rel noopener", () => {
  assert.match(renderPage(doc(), "p_home"), /rel="noopener noreferrer"/);
});

test("asset resolver supplies src", () => {
  const html = renderPage(doc(), "p_home", (id) => (id === "a1" ? { src: "/a/1.webp", alt: "Foto" } : undefined));
  assert.match(html, /src="\/a\/1.webp"/);
});

test("unknown page throws", () => {
  assert.throws(() => renderPage(doc(), "nope"), /page not found/);
});

test("an unverified testimonial never reaches the published HTML", () => {
  const d = doc();
  d.pages[0].sections = [{ id: "s_t", type: "testimonial", props: { quote: "cita inventada", author: "X" } }];
  const html = renderPage(d, "p_home");
  assert.ok(!html.includes("cita inventada"));
  assert.ok(!html.includes("<blockquote"));
  const ok = structuredClone(d);
  ok.pages[0].sections[0].props.ownerProvided = true;
  assert.match(renderPage(ok, "p_home"), /cita inventada/);
});

test("el sitio publicado lleva el CSS de su tema y el formulario", () => {
  const doc = {
    schemaVersion: 1,
    meta: { name: "Luna", lang: "es" },
    design: { brief: "", idea: "", presetId: "tech", dials: { variance: 3, motion: 2, density: 5 } },
    theme: {
      colors: { ground: "#0e1117", ink: "#e8eef7", accent: "#7dd3fc" },
      typography: { family: "Inter", scale: "normal" },
      spacing: { margin: 48, sectionGap: 64 },
      radius: "rounded",
    },
    pages: [{ id: "p_home", slug: "/", seo: { title: "Luna", description: "", noindex: true },
      sections: [{ id: "s1", type: "contact", props: { email: "ana@ejemplo.com" } }] }],
    assets: [],
  };
  const html = renderPage(doc, "p_home");
  // Regresion: antes el renderer no emitia CSS y el sitio salia sin tema.
  assert.ok(html.includes("<style>"), "debe incluir la hoja del tema");
  assert.ok(html.includes("#0e1117"), "debe usar el color del documento");
  assert.ok(html.includes("/_f/lead"), "el formulario apunta al endpoint");
  // Sin fuentes externas: cargarlas revelaria el sitio del cliente a un tercero.
  assert.equal(/fonts\.googleapis|fonts\.gstatic/.test(html), false);
});

// Regresion: React 19 serializa `maxLength`/`autoComplete` en camelCase y los
// booleanos como `required=""`. El navegador lo toleraba, pero el HTML dejaba de
// ser valido y `@webdesign/quality` lo detecto en CI. Se normaliza en el
// renderer para que ningun componente tenga que saberlo.
test("los atributos salen en minusculas y los booleanos sin valor", () => {
  const d = doc();
  d.pages[0].sections = [{ id: "s_c", type: "contact", props: { email: "a@b.example", phone: "600000000" } }];
  const html = renderPage(d, "p_home");
  assert.ok(!/maxLength|autoComplete|readOnly/.test(html), html.slice(0, 400));
  assert.ok(!/required=""/.test(html));
  assert.match(html, /<input[^>]*maxlength="\d+"/);
  // El valor de un atributo no se toca: solo el nombre.
  const img = renderPage(doc(), "p_home", (id) => (id === "a1" ? { src: "/a1.png", alt: "Taza de Café XL" } : undefined));
  assert.match(img, /alt="Taza de Café XL"/);
});
