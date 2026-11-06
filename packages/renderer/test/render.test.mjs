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
