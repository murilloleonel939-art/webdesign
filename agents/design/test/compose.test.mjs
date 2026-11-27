import { test } from "node:test";
import assert from "node:assert/strict";
import { siteDocumentSchema } from "@webdesign/site-schema";
import { lintSite } from "@webdesign/linter";
import { renderPage } from "@webdesign/renderer";
import { draftSite, normalizeBrief, planSections } from "../dist/index.js";
import { FALLBACK_PATTERN_ID, patternFor, productForBrief } from "../dist/product.js";

// T-025: la portada de un sitio se compone desde el patrón del producto, no
// desde una tabla fija; testimonios, precios y cifras solo con datos del dueño.

const PRESET = {
  id: "editorial", name: "Editorial", summary: "Clásico",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 }, radius: "rounded",
  sections: [{ type: "hero" }],
};
const DENTAL = { businessType: "clínica dental", name: "Clínica Sonrisa", city: "Sevilla", service: "implantes", contact: "600 111 222" };
const RESTAURANTE = { businessType: "restaurante", name: "Casa Lola", city: "Madrid", service: "cocina de mercado", contact: "600 111 222" };
const RARO = { businessType: "taller de cerámica artesanal", name: "Barro Vivo", city: "Toledo" };
const PROOF = {
  testimonials: [
    { quote: "Me quitaron el miedo al dentista.", name: "Ana Pérez", role: "Paciente" },
    { quote: "Puntuales y claros con el presupuesto.", name: "Luis Gómez", role: "Paciente" },
    { quote: "Mis hijos vienen contentos.", name: "Marta Ruiz" },
  ],
  metrics: [
    { value: "15 años", label: "abiertos en Sevilla" },
    { value: "4,9 de 5", label: "valoración en Google" },
    { value: "+120", label: "pacientes al mes" },
  ],
  plans: [
    { name: "Revisión", price: "40 €", features: ["Exploración", "Limpieza"] },
    { name: "Familia", price: "90 €", features: ["Cuatro revisiones", "Radiografía"], highlighted: true },
  ],
};

const home = (doc) => doc.pages.find((p) => p.slug === "/");
const types = (page) => page.sections.map((s) => s.type);
const ids = (page) => page.sections.map((s) => s.id);

test("producto y patrón: clínica dental → hero-testimonials-cta; restaurante → hero-centric-design", () => {
  const dental = productForBrief(normalizeBrief(DENTAL));
  assert.equal(dental?.id, "dental-practice");
  assert.equal(patternFor(dental).pattern.id, "hero-testimonials-cta");
  assert.equal(patternFor(dental).match, "exacto");
  const rest = productForBrief(normalizeBrief(RESTAURANTE));
  assert.equal(rest?.id, "restaurant-food-service");
  // «Hero-Centric Design + Conversion» no es label ni alias: resuelve por su
  // primera parte, que sí es un patrón.
  assert.equal(patternFor(rest).pattern.id, "hero-centric-design");
  assert.equal(patternFor(rest).match, "parcial");
});

test("1) clínica dental: más y distintas secciones que un restaurante, con lo que su patrón pide", () => {
  const dental = home(draftSite(normalizeBrief(DENTAL), PRESET));
  const rest = home(draftSite(normalizeBrief(RESTAURANTE), PRESET));
  assert.ok(dental.sections.length > rest.sections.length, `${ids(dental)} vs ${ids(rest)}`);
  assert.notDeepEqual(types(dental), types(rest));
  // Patrón dental: hero, problem→text, solution→features, (testimonials), cta;
  // y de la ficha, «Insurance»→faq y «Online booking»→contact.
  for (const t of ["hero", "text", "features", "faq", "contact", "cta"]) assert.ok(types(dental).includes(t), `dental sin ${t}`);
  // Patrón restaurante: hero, value-prop→text, benefits→features, cta; «Reservation»→contact.
  for (const t of ["hero", "text", "features", "contact", "cta"]) assert.ok(types(rest).includes(t), `restaurante sin ${t}`);
  assert.equal(types(rest).includes("faq"), false, "su patrón no pide FAQ");
  // La tabla fija ya no manda: ninguna de las dos es hero, features, faq, cta.
  assert.notDeepEqual(types(dental), ["hero", "features", "faq", "cta"]);
  assert.notDeepEqual(types(rest), ["hero", "features", "faq", "cta"]);
});

test("2) clínica con testimonios del dueño: la portada los lleva, verificados y sin foto", () => {
  const brief = normalizeBrief({ ...DENTAL, testimonials: PROOF.testimonials });
  const doc = draftSite(brief, PRESET);
  const t = home(doc).sections.find((s) => s.type === "testimonials");
  assert.ok(t, `portada: ${ids(home(doc))}`);
  assert.deepEqual(t.props.items, PROOF.testimonials, "el texto del dueño, tal cual");
  assert.equal(t.props.ownerProvided, true);
  // Va después de hero y antes del cierre.
  assert.equal(home(doc).sections[0].type, "hero");
  assert.ok(ids(home(doc)).indexOf(t.id) < ids(home(doc)).indexOf("s_cta"));
  const html = renderPage(doc, "p_home");
  assert.match(html, /Me quitaron el miedo al dentista\./);
  assert.match(html, /Ana Pérez/);
  const block = html.slice(html.indexOf('class="testimonials"'), html.indexOf("</section>", html.indexOf('class="testimonials"')));
  assert.doesNotMatch(block, /<img/, "sin avatar: no tenemos retratos");
  assert.deepEqual(lintSite(doc).filter((f) => f.code === "TESTIMONIAL_UNVERIFIED"), []);
});

test("3) sin datos del dueño no hay testimonios, precios ni cifras, y se avisa", () => {
  for (const b of [DENTAL, RESTAURANTE, RARO, { businessType: "abogado", name: "Despacho Romero" }]) {
    const brief = normalizeBrief(b);
    const doc = draftSite(brief, PRESET);
    const all = doc.pages.flatMap((p) => p.sections.map((s) => s.type));
    for (const t of ["testimonials", "testimonial", "pricing", "metrics"]) assert.equal(all.includes(t), false, `${b.businessType}: ${t}`);
    const json = JSON.stringify(doc);
    assert.doesNotMatch(json, /\d+\s?€|€\s?\d+|\d+ años|de 5\b/, "ninguna cifra ni precio inventado");
  }
  // El patrón dental pide testimonios: el plan lo dice en `warnings`.
  const plan = planSections(normalizeBrief(DENTAL), PRESET);
  assert.ok(plan.warnings.some((w) => /testimonials/.test(w) && /sin inventar/.test(w)), plan.warnings.join(" | "));
});

test("3b) testimonios con el marcador no cuentan como dato del dueño", () => {
  const brief = normalizeBrief({ ...DENTAL, testimonials: [{ quote: "pendiente de confirmar", name: "Ana" }] });
  assert.equal(brief.proof, undefined);
  assert.equal(types(home(draftSite(brief, PRESET))).includes("testimonials"), false);
});

test("4) las tres secciones nuevas validan contra siteSchema y salen en el HTML", () => {
  const brief = normalizeBrief({ ...DENTAL, ...PROOF });
  const doc = draftSite(brief, PRESET);
  assert.equal(siteDocumentSchema.safeParse(doc).success, true);
  const t = types(home(doc));
  for (const n of ["testimonials", "metrics", "pricing"]) assert.ok(t.includes(n), `falta ${n}: ${t}`);
  const html = renderPage(doc, "p_home");
  assert.match(html, /class="testimonials"/);
  assert.match(html, /class="metrics"/);
  assert.match(html, /4,9 de 5/);
  assert.match(html, /class="pricing"/);
  assert.match(html, /pricing__plan pricing__plan--featured/);
  assert.match(html, /90 €/);
  // plan y documento cuadran página a página.
  const plan = planSections(brief, PRESET);
  plan.pages.forEach((p, i) => assert.equal(p.sections.length, doc.pages[i].sections.length, p.slug));
  // Origen honesto en el plan.
  for (const n of ["testimonials", "metrics", "pricing"]) {
    assert.equal(plan.pages[0].sections.find((s) => s.type === n).origin, "datos_del_dueno");
  }
});

test("5) un negocio sin producto cae al respaldo y no rompe", () => {
  const brief = normalizeBrief(RARO);
  assert.equal(productForBrief(brief), undefined);
  const plan = planSections(brief, PRESET);
  assert.equal(plan.composition.patternId, FALLBACK_PATTERN_ID);
  assert.equal(plan.composition.match, "respaldo");
  assert.ok(plan.warnings.some((w) => /respaldo/.test(w)));
  const doc = draftSite(brief, PRESET);
  assert.equal(siteDocumentSchema.safeParse(doc).success, true);
  assert.equal(home(doc).sections[0].type, "hero");
  assert.equal(home(doc).sections.at(-1).type, "cta");
  assert.ok(types(home(doc)).includes("features"));
  plan.pages.forEach((p, i) => assert.equal(p.sections.length, doc.pages[i].sections.length, p.slug));
});

test("páginas interiores conservan su estructura y plan/doc cuadran en todas", () => {
  for (const b of [DENTAL, RESTAURANTE, RARO, { ...DENTAL, ...PROOF }]) {
    const brief = normalizeBrief(b);
    const photos = { hero: { assetId: "a1", alt: "" }, gallery: [{ assetId: "a2", alt: "" }, { assetId: "a3", alt: "" }, { assetId: "a4", alt: "" }] };
    const plan = planSections(brief, PRESET, undefined, photos);
    const doc = draftSite(brief, PRESET, undefined, photos);
    assert.deepEqual(doc.pages.map((p) => p.slug), ["/", "/servicios", "/sobre-nosotros", "/contacto"]);
    plan.pages.forEach((p, i) => assert.equal(p.sections.length, doc.pages[i].sections.length, `${b.businessType} ${p.slug}`));
    assert.deepEqual(types(doc.pages[1]), ["hero", "features", "features", "gallery", "cta"]);
    assert.deepEqual(types(doc.pages[3]), ["hero", "contact"]);
    // La galería sigue en /servicios, no en la portada (T-022).
    assert.equal(types(home(doc)).includes("gallery"), false);
  }
});

test("una landing no cambia: sigue saliendo del preset", () => {
  const brief = normalizeBrief({ businessType: "curso de inglés online", name: "Curso Aurora", description: "lanzamiento de un curso online" });
  const plan = planSections(brief, PRESET);
  assert.equal(plan.shape, "landing");
  assert.equal(plan.composition, undefined);
  assert.deepEqual(plan.warnings, []);
});
