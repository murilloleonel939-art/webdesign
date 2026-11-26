import { test } from "node:test";
import assert from "node:assert/strict";
import { draftSite, normalizeBrief, planSections } from "../dist/index.js";

// T-022: en forma `site` las 4 fotos (1 hero + 3 galería) se ven y ninguna se repite.
const PRESET = {
  id: "editorial", name: "Editorial", summary: "Clásico",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 }, radius: "rounded",
  sections: [{ type: "hero" }, { type: "gallery" }],
};
const SITE = { businessType: "clínica dental", name: "Sonrisa Clara", city: "Medellín", contact: "300 000 0000" };
const LANDING = { businessType: "curso de inglés online", name: "Curso Aurora", city: "Cali", service: "clases en vivo", contact: "300 000 0000", description: "lanzamiento de un curso online de inglés" };
const photo = (n) => ({ assetId: `asset-${n}`, alt: `Foto ${n}` });
const PHOTOS = { hero: photo(1), gallery: [photo(2), photo(3), photo(4)] };

const imgsOf = (page) => page.sections.flatMap((s) =>
  s.type === "hero" ? (s.props.image ? [s.props.image] : []) : s.type === "gallery" ? s.props.assetIds : []);

test("site: 4 imágenes en total (1 en / y 3 en /servicios), sin repetir", () => {
  const doc = draftSite(normalizeBrief(SITE), PRESET, undefined, PHOTOS);
  assert.equal(doc.pages.length, 4);
  const per = Object.fromEntries(doc.pages.map((p) => [p.slug, imgsOf(p)]));
  assert.deepEqual(per["/"], ["asset-1"]);
  assert.deepEqual(per["/servicios"], ["asset-2", "asset-3", "asset-4"]);
  assert.deepEqual(per["/sobre-nosotros"], []);
  assert.deepEqual(per["/contacto"], []);
  const all = Object.values(per).flat();
  assert.equal(all.length, 4);
  assert.equal(new Set(all).size, 4, "ningún assetId se repite");
  assert.deepEqual(doc.assets.map((a) => a.id).sort(), ["asset-1", "asset-2", "asset-3", "asset-4"]);
});

test("site: solo el hero de la portada lleva image", () => {
  const doc = draftSite(normalizeBrief(SITE), PRESET, undefined, PHOTOS);
  const heroes = doc.pages.map((p) => p.sections.find((s) => s.type === "hero"));
  assert.ok(heroes.every(Boolean));
  assert.deepEqual(heroes.map((h) => "image" in h.props), [true, false, false, false]);
});

test("site: plan.pages y doc.pages coinciden y la galería lleva su motivo", () => {
  const brief = normalizeBrief(SITE);
  const plan = planSections(brief, PRESET, undefined, PHOTOS);
  const doc = draftSite(brief, PRESET, undefined, PHOTOS);
  assert.equal(plan.pages.length, doc.pages.length);
  plan.pages.forEach((p, i) => assert.equal(p.sections.length, doc.pages[i].sections.length, p.slug));
  const g = plan.pages[1].sections.find((s) => s.as === "gallery");
  assert.equal(g.reason, "fotos_de_la_busqueda");
  assert.equal(g.origin, undefined);
});

test("site con 2 fotos de galería: /servicios sin galería, plan y doc coinciden", () => {
  const brief = normalizeBrief(SITE);
  const few = { hero: photo(1), gallery: [photo(2), photo(3)] };
  const plan = planSections(brief, PRESET, undefined, few);
  const doc = draftSite(brief, PRESET, undefined, few);
  assert.equal(doc.pages[1].sections.some((s) => s.type === "gallery"), false);
  plan.pages.forEach((p, i) => assert.equal(p.sections.length, doc.pages[i].sections.length, p.slug));
  assert.deepEqual(doc.assets.map((a) => a.id), ["asset-1"]);
});

test("landing sin cambios: una página, hero con foto y galería del preset", () => {
  const doc = draftSite(normalizeBrief(LANDING), PRESET, undefined, PHOTOS);
  assert.equal(doc.pages.length, 1);
  assert.deepEqual(imgsOf(doc.pages[0]), ["asset-1", "asset-2", "asset-3", "asset-4"]);
});
