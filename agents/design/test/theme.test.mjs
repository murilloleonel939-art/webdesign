import { test } from "node:test";
import assert from "node:assert/strict";
import { siteDocumentSchema, validateSiteDocument } from "@webdesign/site-schema";
import { contrastRatio } from "@webdesign/linter";
import { renderPage } from "@webdesign/renderer";
import { draftSite, normalizeBrief, planSections, productForBrief, themeForProduct, themeTrace } from "../dist/index.js";
import { allPalettes, allStyles, colorsFromPalette, radiusForStyle, spacingForStyle, MIN_CONTRAST } from "../dist/theme.js";

// T-029: el tema sale del producto del catálogo, no de 8 presets fijos.

const PRESET = {
  id: "editorial", name: "Editorial", summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 }, radius: "rounded",
  sections: [{ type: "hero" }, { type: "text" }, { type: "features" }, { type: "cta" }],
};

const CLINICA = normalizeBrief({ businessType: "clínica dental", name: "Clínica Sonrisa", city: "Madrid", service: "implantes y ortodoncia", contact: "hola@sonrisa.test" });
const RESTAURANTE = normalizeBrief({ businessType: "restaurante", name: "Casa Marta", city: "Sevilla", service: "cocina andaluza de mercado", contact: "reservas@casamarta.test" });

test("tema: clínica dental y restaurante producen temas distintos (valores reales)", () => {
  const c = themeForProduct(productForBrief(CLINICA));
  const r = themeForProduct(productForBrief(RESTAURANTE));
  assert.equal(productForBrief(CLINICA).id, "dental-practice");
  assert.equal(productForBrief(RESTAURANTE).id, "restaurant-food-service");
  assert.deepEqual(c, {
    colors: { ground: "#f0f9ff", ink: "#0c4a6e", accent: "#0a77a8" },
    radius: "rounded",
    spacing: { margin: 57, sectionGap: 67 },
    // T-030a: "Soft UI Evolution" no encaja en ninguna categoría explícita →
    // respaldo determinista "moderna".
    typography: { scale: "normal", family: "moderna" },
  });
  assert.deepEqual(r, {
    colors: { ground: "#fef2f2", ink: "#450a0a", accent: "#a16207" },
    radius: "pill",
    spacing: { margin: 71, sectionGap: 85 },
    // T-030a: "Vibrant & Block-based" es bold/playful → "rotunda".
    typography: { scale: "large", family: "rotunda" },
  });
  assert.notEqual(c.colors.accent, r.colors.accent);
  assert.notEqual(c.radius, r.radius);
  assert.notEqual(c.typography.family, r.typography.family);
});

test("tema: las 194 paletas cumplen AA en ink/ground y accent/ground tras corregir", () => {
  const palettes = allPalettes();
  assert.equal(palettes.length, 194);
  let worst = { ratio: Infinity, id: "", pair: "" };
  for (const p of palettes) {
    const { colors } = colorsFromPalette(p);
    for (const [pair, ratio] of [["ink/ground", contrastRatio(colors.ink, colors.ground)], ["accent/ground", contrastRatio(colors.accent, colors.ground)]]) {
      assert.ok(ratio >= MIN_CONTRAST, `${p.id} ${pair} ${ratio}`);
      if (ratio < worst.ratio) worst = { ratio, id: p.id, pair };
    }
  }
  // Peor par medido: invoice-billing-tool accent/ground ≈ 4.50.
  assert.equal(worst.id, "invoice-billing-tool");
  assert.equal(worst.pair, "accent/ground");
  assert.ok(worst.ratio >= 4.5 && worst.ratio < 4.6);
});

test("tema: cada uno de los 89 estilos mapea a radio y espaciado válidos", () => {
  const styles = allStyles();
  assert.equal(styles.length, 89);
  for (const s of styles) {
    const { radius } = radiusForStyle(s);
    const { spacing } = spacingForStyle(s);
    assert.ok(["square", "rounded", "pill"].includes(radius), s.id);
    assert.ok(Number.isInteger(spacing.margin) && spacing.margin >= 48 && spacing.margin <= 80, `${s.id} margin ${spacing.margin}`);
    assert.ok(Number.isInteger(spacing.sectionGap) && spacing.sectionGap >= 56 && spacing.sectionGap <= 96, `${s.id} gap ${spacing.sectionGap}`);
  }
  // Los que dicen un número se respetan.
  const by = (id) => styles.find((s) => s.id === id);
  assert.equal(radiusForStyle(by("minimalism-swiss-style")).radius, "square");
  assert.equal(radiusForStyle(by("soft-ui-evolution")).radius, "rounded");
});

test("tema: sin producto cae al respaldo por sector y es válido", () => {
  const neutro = themeTrace(undefined);
  const salud = themeTrace(undefined, "salud");
  assert.equal(neutro.trace.fallback, true);
  assert.equal(neutro.trace.productId, "b2b-service");
  assert.equal(salud.trace.productId, "medical-clinic");
  assert.notDeepEqual(neutro.theme, salud.theme, "el respaldo no es siempre el mismo");
  for (const t of [neutro.theme, salud.theme]) {
    const parsed = siteDocumentSchema.shape.theme.safeParse(t);
    assert.equal(parsed.success, true);
  }
  // Un brief que no casa con ningún producto también da un tema válido.
  const raro = normalizeBrief({ businessType: "zzzz", name: "Qwerty", city: "Lugo", service: "xyz", contact: "a@b.test" });
  const doc = draftSite(raro, PRESET);
  assert.equal(validateSiteDocument(doc).ok, true);
});

test("tema: documento con el tema nuevo valida, renderiza y plan/doc cuadran", () => {
  for (const brief of [CLINICA, RESTAURANTE]) {
    const doc = draftSite(brief, PRESET);
    assert.equal(validateSiteDocument(doc).ok, true);
    assert.deepEqual(doc.theme, themeForProduct(productForBrief(brief)));
    assert.equal(doc.design.presetId, "editorial", "el preset se guarda para trazabilidad");
    const plan = planSections(brief, PRESET);
    assert.equal(plan.pages.length, doc.pages.length);
    for (const page of doc.pages) {
      const html = renderPage(doc, page.id);
      assert.ok(html.includes(doc.theme.colors.accent));
    }
  }
});
