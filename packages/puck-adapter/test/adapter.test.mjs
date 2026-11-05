import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSiteDocument } from "@webdesign/site-schema";
import { documentToPuck, puckToDocument, mergeEditedPage, guardOwnerOnlyFields } from "../dist/index.js";

const site = () => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [
    { id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: false },
      sections: [
        { id: "s_hero", type: "hero", variant: "image-dominant", props: { headline: "Hola", cta: { label: "Ir", href: "https://x.com" } } },
        { id: "s_faq", type: "faq", props: { items: [{ q: "¿?", a: "!" }] } },
      ] },
    { id: "p_prices", slug: "/precios", seo: { title: "Precios", description: "d", noindex: false },
      sections: [{ id: "s_pricing", type: "pricing", props: { plans: [{ name: "Básico", price: "9€", features: ["a"] }] } }] },
  ],
  assets: [{ id: "asset_1", alt: "Foto" }],
});

test("schema -> puck -> schema is identical for every page", () => {
  const doc = site();
  for (const page of doc.pages) {
    const puck = documentToPuck(doc, page.id);
    const back = puckToDocument(puck, page.id);
    assert.deepEqual(back.pages[0], page, page.id);
    const validated = validateSiteDocument(back);
    assert.equal(validated.ok, true, validated.ok ? "" : validated.errors.join("; "));
  }
});

test("merging an edited page keeps the other pages intact", () => {
  const doc = site();
  const puck = documentToPuck(doc, "p_home");
  puck.content[0].props.headline = "Nuevo";
  const merged = mergeEditedPage(doc, puckToDocument(puck, "p_home"));
  assert.equal(merged.pages.length, 2);
  assert.equal(merged.pages[0].sections[0].props.headline, "Nuevo");
  assert.deepEqual(merged.pages[1], doc.pages[1]);
});

test("an agent cannot mark a testimonial as owner-provided", () => {
  const doc = site();
  doc.pages[0].sections.push({ id: "s_t", type: "testimonial", props: { quote: "q", author: "a", ownerProvided: true } });
  const next = structuredClone(doc);
  next.pages[0].sections.at(-1).props.ownerProvided = true;
  // Un agente intenta crear uno nuevo ya verificado.
  const attempted = structuredClone(doc);
  attempted.pages[0].sections.push({ id: "s_new", type: "testimonial", props: { quote: "q", author: "a", ownerProvided: true } });
  const guarded = guardOwnerOnlyFields(doc, attempted, "agent");
  const added = guarded.pages[0].sections.at(-1);
  assert.equal(added.props.ownerProvided, false);
  // El que ya existia conserva lo que fijo el dueno.
  const kept = guardOwnerOnlyFields(doc, next, "agent");
  const existing = kept.pages[0].sections.find((s) => s.id === "s_t");
  assert.equal(existing.props.ownerProvided, true);
  // El dueno si puede fijarlo.
  assert.equal(guardOwnerOnlyFields(doc, attempted, "user").pages[0].sections.at(-1).props.ownerProvided, true);
});

test("a guarded agent document still validates and is caught by the linter", async () => {
  const { lintSite } = await import("@webdesign/linter");
  const doc = site();
  const attempted = structuredClone(doc);
  attempted.pages[0].sections.push({ id: "s_new", type: "testimonial", props: { quote: "q", author: "a", ownerProvided: true } });
  const guarded = guardOwnerOnlyFields(doc, attempted, "agent");
  assert.equal(validateSiteDocument(guarded).ok, true);
  assert.ok(lintSite(guarded).some((f) => f.code === "TESTIMONIAL_UNVERIFIED"));
});
