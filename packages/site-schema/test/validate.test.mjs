import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSiteDocument, isSafeUrl } from "../dist/index.js";

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
  pages: [{ id: "p_home", slug: "/", seo: { title: "t", description: "d", noindex: false },
    sections: [{ id: "s1", type: "hero", props: { headline: "h" } }] }],
  assets: [],
});

test("valid document passes", () => {
  const r = validateSiteDocument(doc());
  assert.equal(r.ok, true, r.ok ? "" : r.errors.join("; "));
});

test("unknown section type is rejected", () => {
  const d = doc();
  d.pages[0].sections[0].type = "raw_html";
  assert.equal(validateSiteDocument(d).ok, false);
});

test("unsafe URL is rejected", () => {
  const d = doc();
  d.pages[0].sections[0].props = { headline: "h", cta: { label: "x", href: "javascript:alert(1)" } };
  assert.equal(validateSiteDocument(d).ok, false);
});

test("bad slug is rejected", () => {
  for (const slug of ["/Mayus", "/..", "//x", "a"]) {
    const d = doc();
    d.pages[0].slug = slug;
    assert.equal(validateSiteDocument(d).ok, false, slug);
  }
});

test("invalid color is rejected", () => {
  const d = doc();
  d.theme.colors.ink = "negro";
  assert.equal(validateSiteDocument(d).ok, false);
});

test("safe url helper", () => {
  assert.equal(isSafeUrl("#ancla"), true);
  assert.equal(isSafeUrl("https://x.com"), true);
  assert.equal(isSafeUrl("mailto:a@b.co"), true);
  assert.equal(isSafeUrl("data:text/html,x"), false);
});
