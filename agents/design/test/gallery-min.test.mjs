import { test } from "node:test";
import assert from "node:assert/strict";
import { draftSite, normalizeBrief } from "../dist/index.js";

// Galería con las fotos justas del banco (T-020).
//
// POR QUÉ EXISTE: el banco local tiene 3 fotos cuadradas por sector en seis de
// los siete sectores (solo hosteleria tiene 4). `draftSite` exige `GALLERY_MIN`
// fotos para pintar la galería; si ese mínimo fuera 4, la galería se omitiría
// entera en casi todos los sectores. Hoy `GALLERY_MIN` es 3, y estas pruebas
// fijan que 3 fotos bastan y que con 2 no se pinta una galería a medias.
//
// El brief es de forma `landing` a propósito: en la forma `site` (cuatro
// páginas, T-003.3) la composición de páginas no incluye galería todavía, y eso
// es una decisión de contrato anterior a T-020, no el mínimo de fotos. Aquí se
// prueba lo que este cambio puede romper: el mínimo.

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "gallery" }],
};

/** Brief de oferta única: forma landing, que es donde el preset manda. */
const BRIEF = {
  businessType: "curso de inglés online",
  name: "Curso Aurora",
  city: "Cali",
  service: "clases en vivo",
  contact: "300 000 0000",
  description: "lanzamiento de un curso online de inglés",
};

/** Fotos tal como llegan del `fetchPhotos` real. */
const photo = (n) => ({ assetId: `asset-${n}`, alt: `Foto ${n}` });

test("tres fotos de galería pintan la sección (el mínimo del banco)", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET, undefined, {
    hero: photo(1),
    gallery: [photo(2), photo(3), photo(4)],
  });

  const gallery = doc.pages[0].sections.find((s) => s.type === "gallery");
  assert.ok(gallery !== undefined, "la sección gallery existe con 3 fotos");
  assert.equal(gallery.props.assetIds.length, 3, "lleva las 3 fotos");
  assert.deepEqual(gallery.props.assetIds, ["asset-2", "asset-3", "asset-4"]);
});

test("con dos fotos la galería se omite: el mínimo es 3", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET, undefined, {
    hero: photo(1),
    gallery: [photo(2), photo(3)],
  });
  const gallery = doc.pages[0].sections.find((s) => s.type === "gallery");
  assert.equal(gallery, undefined, "2 fotos no son una galería");
});

test("sin fotos el sitio sigue saliendo, sin galería", () => {
  const doc = draftSite(normalizeBrief(BRIEF), PRESET);
  const gallery = doc.pages[0].sections.find((s) => s.type === "gallery");
  assert.equal(gallery, undefined);
  assert.ok(doc.pages[0].sections.length > 0, "el sitio se pinta igual");
});
