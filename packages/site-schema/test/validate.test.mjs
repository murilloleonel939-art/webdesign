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

// T-003.2: rutas internas aceptadas
test("isSafeUrl: rutas internas válidas se aceptan", () => {
  assert.equal(isSafeUrl("/"), true, "/");
  assert.equal(isSafeUrl("/servicios"), true, "/servicios");
  assert.equal(isSafeUrl("/servicios/talleres"), true, "/servicios/talleres");
  assert.equal(isSafeUrl("/servicios/"), true, "/servicios/ (barra final)");
});

// T-003.2: rutas internas rechazadas
test("isSafeUrl: rutas internas peligrosas se rechazan", () => {
  assert.equal(isSafeUrl("//evil.com"), false, "relativa al protocolo");
  assert.equal(isSafeUrl("/\\evil.com"), false, "barra invertida");
  assert.equal(isSafeUrl("/.."), false, "travesía raíz");
  assert.equal(isSafeUrl("/../etc/passwd"), false, "travesía etc");
  assert.equal(isSafeUrl("/a/../b"), false, "travesía intermedia");
  assert.equal(isSafeUrl("/a/../../b"), false, "travesía doble");
  assert.equal(isSafeUrl("/./x"), false, "punto simple");
  assert.equal(isSafeUrl("/%2e%2e/x"), false, "travesía codificada %2e%2e");
  assert.equal(isSafeUrl("/..%2f"), false, "travesía codificada %2f");
  assert.equal(isSafeUrl("/a b"), false, "espacio");
  assert.equal(isSafeUrl('/a"b'), false, "comilla doble");
  assert.equal(isSafeUrl("/a'b"), false, "comilla simple");
  assert.equal(isSafeUrl("/a<b"), false, "menor que");
  assert.equal(isSafeUrl("/a>b"), false, "mayor que");
  assert.equal(isSafeUrl("/a`b"), false, "backtick");
  assert.equal(isSafeUrl("/" + "a".repeat(201)), false, "más de 200 chars");
});

test("isSafeUrl: javascript y data siguen rechazándose", () => {
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("data:text/html,x"), false);
  assert.equal(isSafeUrl("vbscript:x"), false);
  assert.equal(isSafeUrl("file:///etc/passwd"), false);
});

test("T-003.2: documento con cta href='/servicios' valida", () => {
  const d = doc();
  d.pages[0].sections[0].props = { headline: "h", cta: { label: "Ver", href: "/servicios" } };
  const r = validateSiteDocument(d);
  assert.equal(r.ok, true, r.ok ? "" : r.errors.join("; "));
});

test("T-003.2: documento con cta href='//evil.com' no valida", () => {
  const d = doc();
  d.pages[0].sections[0].props = { headline: "h", cta: { label: "x", href: "//evil.com" } };
  assert.equal(validateSiteDocument(d).ok, false);
});
