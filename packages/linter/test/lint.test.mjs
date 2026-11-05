import { test } from "node:test";
import assert from "node:assert/strict";
import { lintSite, blocksPublication, contrastRatio } from "../dist/index.js";

const base = {
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "large-display" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [
    { id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: false },
      sections: [{ id: "s_hero", type: "hero", props: { headline: "Hola", cta: { label: "Ir", href: "https://x.com" } } }] },
  ],
  assets: [],
};

const codes = (f) => f.map((x) => x.code);

test("a clean document has no blocking findings", () => {
  const f = lintSite(structuredClone(base));
  assert.equal(blocksPublication(f), false, JSON.stringify(f));
});

test("missing title and empty page block", () => {
  const d = structuredClone(base);
  d.pages[0].seo.title = "";
  d.pages[0].sections = [];
  const f = lintSite(d);
  assert.ok(codes(f).includes("MISSING_TITLE"));
  assert.ok(codes(f).includes("EMPTY_PAGE"));
  assert.equal(blocksPublication(f), true);
});

test("javascript: URL is rejected", () => {
  const d = structuredClone(base);
  d.pages[0].sections[0].props.cta.href = "javascript:alert(1)";
  assert.ok(codes(lintSite(d)).includes("UNSAFE_URL"));
});

test("raw HTML in text is an error", () => {
  const d = structuredClone(base);
  d.pages[0].sections[0].props.headline = "<script>x</script>";
  assert.ok(codes(lintSite(d)).includes("RAW_HTML"));
});

test("unknown section type fails schema", () => {
  const d = structuredClone(base);
  d.pages[0].sections[0].type = "raw_html";
  assert.ok(codes(lintSite(d)).includes("SCHEMA_INVALID"));
});

test("unverified testimonial and unlicensed image block", () => {
  const d = structuredClone(base);
  d.assets = [{ id: "asset_1", alt: "foto" }];
  d.pages[0].sections = [
    { id: "s_t", type: "testimonial", props: { quote: "q", author: "a" } },
    { id: "s_i", type: "image", props: { assetId: "asset_1" } },
  ];
  const f = lintSite(d);
  assert.ok(codes(f).includes("TESTIMONIAL_UNVERIFIED"));
  assert.ok(codes(f).includes("IMAGE_LICENSE_MISSING"));
  assert.equal(blocksPublication(f), true);
});

test("font outside the hosted list is an error", () => {
  const d = structuredClone(base);
  d.theme.typography.family = "Comic Sans";
  assert.ok(codes(lintSite(d)).includes("FONT_NOT_HOSTED"));
});

test("duplicate slug is an error", () => {
  const d = structuredClone(base);
  d.pages.push(structuredClone(d.pages[0]));
  assert.ok(codes(lintSite(d)).includes("DUPLICATE_SLUG"));
});

test("contrast helper matches WCAG for black on white", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(Math.round(contrastRatio("#ffffff", "#ffffff")), 1);
});

test("heavy page blocks, long text only informs", () => {
  const d = structuredClone(base);
  d.pages[0].sections.push({ id: "s_t", type: "text", props: { body: "x".repeat(3000) } });
  const f = lintSite(d, { pageBytes: { p_home: 21 * 1024 * 1024 } });
  assert.ok(codes(f).includes("PAGE_TOO_HEAVY"));
  assert.ok(codes(f).includes("LONG_TEXT"));
  assert.equal(f.find((x) => x.code === "LONG_TEXT").severity, "info");
});

test("an agent-written testimonial is TESTIMONIAL_UNVERIFIED, not a schema error", () => {
  const d = structuredClone(base);
  d.pages[0].sections = [{ id: "s_t", type: "testimonial", props: { quote: "q", author: "a", ownerProvided: false } }];
  const f = lintSite(d);
  assert.ok(codes(f).includes("TESTIMONIAL_UNVERIFIED"));
  assert.ok(!codes(f).includes("SCHEMA_INVALID"));
  assert.equal(blocksPublication(f), true);
});
