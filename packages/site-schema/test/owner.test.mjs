import { test } from "node:test";
import assert from "node:assert/strict";
import { markOwnerEdits, mergeOwnerContent, validateSiteDocument } from "../dist/index.js";

// Propiedad del contenido (T-027). Dos piezas y un solo criterio:
//
//   markOwnerEdits     marca, al guardar el dueño, qué props escribió él;
//   mergeOwnerContent  fusiona un rediseño SIN pisar esa marca.
//
// Se prueban con documentos completos (no fragmentos) porque la fusión depende a
// la vez de páginas, tipos y props: un fragmento escondería justo los fallos que
// importan (perder una sección, moverla de sitio, dejar el documento inválido).

const theme = {
  colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
  typography: { family: "Inter", scale: "s" },
  spacing: { margin: 24, sectionGap: 160 },
  radius: "square",
};

const page = (sections, over = {}) => ({
  id: "p_home",
  slug: "/",
  seo: { title: "Café Aurora", description: "Café de especialidad", noindex: false },
  sections,
  ...over,
});

const doc = (sections, over = {}) => ({
  schemaVersion: 1,
  meta: { name: "Café Aurora", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme,
  pages: [page(sections)],
  assets: [],
  ...over,
});

const hero = (headline, extra = {}) => ({ id: "s_hero", type: "hero", props: { headline, ...extra } });

const contact = (props = {}) => ({
  id: "s_contact",
  type: "contact",
  props: { email: "hola@cafeaurora.test", cta: { label: "Escribir", href: "#contacto" }, ...props },
});

/** Los tres bloques que solo existen con datos del dueño (T-025). */
const testimonials = () => ({
  id: "s_testimonials",
  type: "testimonials",
  props: { heading: "Opiniones", ownerProvided: true, items: [{ quote: "Trato exquisito", name: "Marta" }] },
});
const pricing = () => ({
  id: "s_pricing",
  type: "pricing",
  props: { heading: "Precios", plans: [{ name: "Menú", price: "18 €", features: ["Primero y segundo"] }] },
});
const metrics = () => ({
  id: "s_metrics",
  type: "metrics",
  props: { heading: "En cifras", items: [{ value: "12", label: "años" }, { value: "900", label: "clientes" }, { value: "4,9", label: "de 5" }] },
});

const ownerData = () => [testimonials(), pricing(), metrics(), contact()];

const cta = () => ({ id: "s_cta", type: "cta", props: { headline: "Ven", cta: { label: "Ir", href: "#contacto" } } });

/** El rediseño: estructura nueva, textos nuevos y, sin datos del dueño, sin sus bloques. */
const redesign = () =>
  doc([
    hero("Café de especialidad en Valencia", { subline: "Tueste propio" }),
    { id: "s_features", type: "features", props: { heading: "Qué hacemos", items: [{ title: "Tueste", body: "Propio" }] } },
    { id: "s_contact", type: "contact", props: { cta: { label: "Escribir", href: "#contacto" } } },
    cta(),
  ]);

const typesOf = (d, i = 0) => d.pages[i].sections.map((s) => s.type);
const sectionOf = (d, type, i = 0) => d.pages[i].sections.find((s) => s.type === type);

// --- markOwnerEdits ---------------------------------------------------------

test("una prop que el dueño cambia queda marcada", () => {
  const marked = markOwnerEdits(doc([hero("Café de barrio")]), doc([hero("Café Aurora, tu café")]));
  assert.deepEqual(marked.pages[0].sections[0].ownerEdited, ["headline"]);
  // Se marca, no se reescribe: el valor es el que guardó el dueño.
  assert.equal(marked.pages[0].sections[0].props.headline, "Café Aurora, tu café");
});

test("un guardado sin cambios no marca nada", () => {
  const before = doc([hero("Café de barrio"), ...ownerData()]);
  const marked = markOwnerEdits(before, structuredClone(before));
  for (const s of marked.pages[0].sections) assert.equal(s.ownerEdited, undefined);
});

test("una sección que el dueño añade se marca entera", () => {
  const marked = markOwnerEdits(
    doc([hero("Café de barrio")]),
    doc([hero("Café de barrio"), { id: "testimonials-1", type: "testimonials", props: { items: [{ quote: "Bien", name: "Ana" }] } }]),
  );
  assert.deepEqual(marked.pages[0].sections[1].ownerEdited, ["items"]);
});

test("las marcas anteriores sobreviven aunque el cliente no las mande", () => {
  // Puck reenvía la página con lo que tiene: si las marcas vivieran solo en el
  // cliente, el primer guardado del editor las borraría.
  const marked = markOwnerEdits(
    doc([{ ...hero("Café de barrio"), ownerEdited: ["headline"] }]),
    doc([hero("Café de barrio", { subline: "De siempre" })]),
  );
  assert.deepEqual(marked.pages[0].sections[0].ownerEdited, ["headline", "subline"]);
});

test("cambiar el orden de las secciones no marca sus props", () => {
  const marked = markOwnerEdits(doc([hero("Café"), cta()]), doc([cta(), hero("Café")]));
  for (const s of marked.pages[0].sections) assert.equal(s.ownerEdited, undefined);
});

test("un documento anterior ilegible no inventa marcas", () => {
  const after = doc([hero("Café")]);
  assert.deepEqual(markOwnerEdits({ basura: true }, after), after);
  assert.deepEqual(markOwnerEdits(undefined, after), after);
  assert.deepEqual(markOwnerEdits("texto", after), after);
});

test("un documento nuevo ilegible se devuelve intacto, sin lanzar", () => {
  // La marca es una mejora del guardado: si el documento no se puede recorrer,
  // se guarda tal cual en vez de romper el guardado del dueño.
  assert.equal(markOwnerEdits(doc([hero("Café")]), null), null);
  assert.equal(markOwnerEdits(doc([hero("Café")]), "texto"), "texto");
});

// --- mergeOwnerContent ------------------------------------------------------

test("un rediseño conserva testimonios, precios y cifras del dueño", () => {
  const merged = mergeOwnerContent(doc(ownerData()), redesign());
  for (const t of ["testimonials", "pricing", "metrics"]) assert.ok(typesOf(merged).includes(t), `${t} desapareció`);
  assert.equal(sectionOf(merged, "testimonials").props.items[0].name, "Marta");
  assert.equal(sectionOf(merged, "testimonials").props.ownerProvided, true);
  assert.equal(sectionOf(merged, "pricing").props.plans[0].price, "18 €");
  assert.equal(sectionOf(merged, "metrics").props.items.length, 3);
});

test("un rediseño conserva el contacto del dueño aunque el brief nuevo no lo traiga", () => {
  const merged = mergeOwnerContent(doc(ownerData()), redesign());
  assert.equal(sectionOf(merged, "contact").props.email, "hola@cafeaurora.test");
});

test("el teléfono del dueño también sobrevive cuando el contacto es un teléfono", () => {
  const previous = doc([{ id: "s_contact", type: "contact", props: { phone: "600 123 123", cta: { label: "Llamar", href: "#contacto" } } }]);
  const merged = mergeOwnerContent(previous, redesign());
  assert.equal(sectionOf(merged, "contact").props.phone, "600 123 123");
  // El CTA del rediseño sí manda: el dueño no lo tocó.
  assert.equal(sectionOf(merged, "contact").props.cta.label, "Escribir");
});

test("el titular escrito a mano sobrevive al rediseño", () => {
  const previous = doc([{ ...hero("Café Aurora, tostado en casa"), ownerEdited: ["headline"] }]);
  const merged = mergeOwnerContent(previous, doc([hero("Café de especialidad en Valencia", { subline: "Nuevo subtítulo" })]));
  assert.equal(sectionOf(merged, "hero").props.headline, "Café Aurora, tostado en casa");
  // Lo que nadie tocó sí cambia: el subtítulo es del agente.
  assert.equal(sectionOf(merged, "hero").props.subline, "Nuevo subtítulo");
});

test("los textos que nadie tocó los cambia el rediseño", () => {
  const merged = mergeOwnerContent(doc([hero("Café de barrio")]), doc([hero("Café de especialidad en Valencia")]));
  assert.equal(sectionOf(merged, "hero").props.headline, "Café de especialidad en Valencia");
});

test("el estilo y la estructura los pone el rediseño", () => {
  const next = doc([hero("Nuevo"), { id: "s_faq", type: "faq", props: { items: [{ q: "¿Abre?", a: "Sí" }] } }], {
    theme: { ...theme, radius: "pill" },
  });
  const merged = mergeOwnerContent(doc([{ ...hero("Viejo"), ownerEdited: ["headline"] }]), next);
  assert.equal(merged.theme.radius, "pill");
  assert.deepEqual(typesOf(merged), ["hero", "faq"]);
  assert.equal(sectionOf(merged, "hero").props.headline, "Viejo");
});

test("un cambio pedido en el chat se aplica aunque el dueño lo hubiera editado antes", () => {
  const merged = mergeOwnerContent(
    doc([{ ...hero("Café Aurora, tostado en casa"), ownerEdited: ["headline"] }]),
    doc([hero("Café de especialidad en Valencia")]),
    { changeRequest: true },
  );
  assert.equal(sectionOf(merged, "hero").props.headline, "Café de especialidad en Valencia");
  // La marca caduca: ese texto ya no es del dueño, es del rediseño.
  assert.equal(sectionOf(merged, "hero").ownerEdited, undefined);
});

test("un cambio pedido en el chat no se lleva por delante cifras, precios ni contacto", () => {
  const merged = mergeOwnerContent(doc(ownerData()), redesign(), { changeRequest: true });
  for (const t of ["testimonials", "pricing", "metrics"]) assert.ok(typesOf(merged).includes(t), `${t} desapareció`);
  assert.equal(sectionOf(merged, "contact").props.email, "hola@cafeaurora.test");
});

test("un documento sin datos del dueño se regenera entero, como antes", () => {
  const next = redesign();
  assert.deepEqual(mergeOwnerContent(doc([hero("Café de barrio"), cta()]), next), next);
});

test("sin documento anterior el rediseño pasa tal cual", () => {
  const next = redesign();
  assert.deepEqual(mergeOwnerContent(undefined, next), next);
});

test("un documento anterior inválido no rompe el rediseño", () => {
  const next = redesign();
  assert.deepEqual(mergeOwnerContent({ schemaVersion: 1 }, next), next);
});

test("las secciones del dueño quedan delante del contacto y del cierre", () => {
  const merged = mergeOwnerContent(doc(ownerData()), redesign());
  const types = typesOf(merged);
  const last = Math.min(types.indexOf("contact"), types.indexOf("cta"));
  for (const t of ["testimonials", "pricing", "metrics"]) assert.ok(types.indexOf(t) < last, `${t} quedó detrás del contacto`);
});

test("las marcas conservadas siguen marcadas para el siguiente rediseño", () => {
  const first = mergeOwnerContent(doc([{ ...hero("Mío"), ownerEdited: ["headline"] }]), doc([hero("Del agente")]));
  assert.deepEqual(sectionOf(first, "hero").ownerEdited, ["headline"]);
  const second = mergeOwnerContent(first, doc([hero("Otro rediseño")]));
  assert.equal(sectionOf(second, "hero").props.headline, "Mío");
});

test("los bloques del dueño de una página que el rediseño ya no tiene no se pierden", () => {
  // El rediseño pasa de sitio de cuatro páginas a landing: la portada baja del
  // dueño no puede evaporarse con las páginas que ya no existen.
  const previous = doc([hero("Café")], {
    pages: [
      page([hero("Café"), testimonials(), contact()]),
      page([hero("Contacto"), pricing()], { id: "p_contacto", slug: "/contacto" }),
    ],
  });
  const merged = mergeOwnerContent(previous, redesign());
  assert.ok(typesOf(merged).includes("pricing"), "el precio de /contacto se perdió");
  assert.ok(typesOf(merged).includes("testimonials"));
  assert.equal(merged.pages.length, 1);
});

test("la fusión no repite un bloque que el rediseño ya trae", () => {
  const next = doc([hero("Nuevo"), testimonials(), contact()]);
  const merged = mergeOwnerContent(doc([testimonials(), contact()]), next);
  assert.equal(typesOf(merged).filter((t) => t === "testimonials").length, 1);
});

test("el resultado de la fusión sigue validando contra el esquema", () => {
  const merged = mergeOwnerContent(doc([{ ...hero("Mío"), ownerEdited: ["headline"] }, ...ownerData()]), redesign());
  const check = validateSiteDocument(merged);
  assert.equal(check.ok, true, check.ok ? "" : check.errors.join("; "));
});

test("un documento con marcas guardadas sigue validando (compatibilidad)", () => {
  const check = validateSiteDocument(doc([{ ...hero("Mío"), ownerEdited: ["headline", "subline"] }]));
  assert.equal(check.ok, true, check.ok ? "" : check.errors.join("; "));
});
