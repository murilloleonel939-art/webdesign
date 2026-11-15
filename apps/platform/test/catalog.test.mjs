// Pruebas del catalogo inicial (Fase 1b).
// Comprueban lo que puede romperse sin que nadie mire: que los presets
// produzcan documentos validos y que no se inventen datos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStyleToDocument } from "../dist/catalog.js";
import { siteDocumentSchema } from "@webdesign/site-schema";

const baseDoc = () => ({
  schemaVersion: 1,
  meta: { name: "Mi sitio", lang: "es" },
  design: { brief: "", idea: "", presetId: "editorial", dials: { variance: 3, motion: 2, density: 5 } },
  theme: {
    colors: { ground: "#f7f7f2", ink: "#172033", accent: "#3b82f6" },
    typography: { family: "Inter", scale: "normal" },
    spacing: { margin: 64, sectionGap: 72 },
    radius: "rounded",
  },
  pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "x", noindex: true }, sections: [{ id: "s1", type: "hero", props: { headline: "Hola" } }] }],
  assets: [],
});

const style = (id, extra) => ({
  id,
  name: id,
  summary: "",
  colors: { ground: "#ffffff", ink: "#111111", accent: "#0b5fff" },
  typography: { family: "Inter", scale: "normal" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  dials: { variance: 4, motion: 2, density: 4 },
  sections: [{ type: "hero" }],
  ...extra,
});

test("cada preset produce un documento que pasa el esquema", () => {
  const cases = [
    ["hero", "text", "features", "testimonial", "cta"],
    ["hero", "features", "pricing", "faq", "cta"],
    ["hero", "features", "gallery", "cta", "contact"],
    ["hero", "text", "gallery", "testimonial", "contact"],
    ["hero", "gallery", "text", "testimonial", "contact"],
    ["hero", "features", "testimonial", "pricing", "contact"],
    ["hero", "text", "gallery", "pricing", "contact"],
    ["hero", "features", "gallery", "cta", "contact"],
  ];
  cases.forEach((types, i) => {
    const s = style(`p${i}`, { sections: types.map((type) => ({ type })) });
    const { doc } = applyStyleToDocument(baseDoc(), s);
    const parsed = siteDocumentSchema.safeParse(doc);
    assert.equal(parsed.success, true, `preset ${i} invalido: ${JSON.stringify(parsed.error?.issues?.slice(0, 2))}`);
  });
});

test("aplicar un preset cambia tema y dials, no el resto del documento", () => {
  const s = style("tech", {
    colors: { ground: "#0e1117", ink: "#e8edf5", accent: "#24c8a5" },
    radius: "square",
    dials: { variance: 9, motion: 7, density: 8 },
    sections: [{ type: "hero" }, { type: "text" }],
  });
  const before = baseDoc();
  const { doc } = applyStyleToDocument(before, s);

  assert.equal(doc.design.presetId, "tech");
  assert.deepEqual(doc.theme.colors, s.colors);
  assert.equal(doc.theme.radius, "square");
  assert.deepEqual(doc.design.dials, s.dials);
  // Lo que no debe tocarse: meta, assets e identidad de la pagina.
  assert.equal(doc.meta.name, before.meta.name);
  assert.equal(doc.assets.length, before.assets.length);
  assert.equal(doc.pages[0].id, "p_home");
});

test("un testimonio nunca se rellena con datos inventados", () => {
  const s = style("with-testimonial", { sections: [{ type: "hero" }, { type: "testimonial" }] });
  const { doc } = applyStyleToDocument(baseDoc(), s);
  const types = doc.pages[0].sections.map((x) => x.type);
  // `testimonial` no tiene props por defecto a proposito: se degrada a `text`.
  assert.equal(types.includes("testimonial"), false, "no se siembra un testimonio falso");
  assert.equal(types.includes("text"), true, "se sustituye por un bloque de texto");
  assert.equal(siteDocumentSchema.safeParse(doc).success, true);
});

test("los presets aplicados conservan las paginas adicionales", () => {
  const before = baseDoc();
  before.pages.push({ id: "p_about", slug: "/sobre-nosotros", seo: { title: "Sobre", description: "x", noindex: true }, sections: [{ id: "a1", type: "text", props: { body: "Historia real del negocio." } }] });
  const { doc } = applyStyleToDocument(before, style("minimal"));
  assert.equal(doc.pages.length, 2, "no se pierde la pagina secundaria");
  assert.equal(doc.pages[1].sections[0].props.body, "Historia real del negocio.");
});
