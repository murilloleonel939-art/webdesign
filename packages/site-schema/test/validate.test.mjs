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

// T-003.4 (Fix 2): solo se admite UN segmento vacío y solo al final.
test("isSafeUrl: un vacío en medio de la ruta se rechaza", () => {
  assert.equal(isSafeUrl("/a//b"), false, "vacío en medio");
});

test("isSafeUrl: varios vacíos en medio se rechazan", () => {
  assert.equal(isSafeUrl("/a///b"), false, "dos vacíos en medio");
});

test("isSafeUrl: dos vacíos al final se rechazan", () => {
  assert.equal(isSafeUrl("/a//"), false, "dos barras finales");
});

test("isSafeUrl: un vacío al final sigue valiendo", () => {
  assert.equal(isSafeUrl("/servicios/"), true, "una barra final");
});

test("isSafeUrl: '//' se rechaza por la guarda de ruta relativa al protocolo", () => {
  assert.equal(isSafeUrl("//"), false, "//");
});

// T-003.4 (Fix 3): la frontera es 199, no 200.
test("isSafeUrl: 199 caracteres se aceptan y 200 se rechazan", () => {
  assert.equal(isSafeUrl("/" + "a".repeat(198)), true, "199 chars");
  assert.equal(isSafeUrl("/" + "a".repeat(199)), false, "200 chars");
});

// T-003.4 (Fix 1): la validación es lineal, sin retroceso cuadrático.
test("isSafeUrl: 1000 rutas de 199 caracteres se validan en menos de 100 ms", () => {
  const value = "/" + "a-".repeat(99);
  assert.equal(value.length, 199);
  const start = performance.now();
  for (let i = 0; i < 1000; i++) isSafeUrl(value);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 100, `1000 llamadas tardaron ${elapsed.toFixed(1)} ms`);
});

// T-003.4 (Fix 1): el recorte no relajó nada de lo que ya se rechazaba.
test("isSafeUrl: sigue rechazando mayúsculas, '_', '.', 'ñ' y demás", () => {
  assert.equal(isSafeUrl("/Mayusculas"), false, "mayúsculas");
  assert.equal(isSafeUrl("/a_b"), false, "guion bajo");
  assert.equal(isSafeUrl("/a.b"), false, "punto");
  assert.equal(isSafeUrl("/año"), false, "eñe");
  assert.equal(isSafeUrl("/a b"), false, "espacio");
  assert.equal(isSafeUrl("/a<b"), false, "menor que");
  assert.equal(isSafeUrl("/a>b"), false, "mayor que");
  assert.equal(isSafeUrl("/a`b"), false, "backtick");
  assert.equal(isSafeUrl('/a"b'), false, "comilla");
  assert.equal(isSafeUrl("javascript:alert(1)"), false, "javascript:");
  assert.equal(isSafeUrl("data:text/html,x"), false, "data:");
  assert.equal(isSafeUrl("//evil.com"), false, "//evil.com");
  assert.equal(isSafeUrl("/\\evil.com"), false, "/\\evil.com");
  assert.equal(isSafeUrl("/../x"), false, "/../x");
  assert.equal(isSafeUrl("/%2e%2e/x"), false, "/%2e%2e/x");
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
