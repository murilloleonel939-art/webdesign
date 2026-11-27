import { test } from "node:test";
import assert from "node:assert/strict";
import { draftSite, normalizeBrief } from "../dist/index.js";

// Garantías que hacen la página vendible (T-005).
//
// POR QUÉ EXISTEN: el dueño recibió un borrador con «Mi sitio» de titular y con
// su propia instrucción («tengo un negocio de consultoría tributaria hazme una
// landing page») publicada como encabezado y como SEO. Las tres garantías de
// abajo son las que impiden volver a entregar eso:
//
//   1. la instrucción del cliente NUNCA se publica;
//   2. un nombre de relleno NO es un nombre;
//   3. titular y SEO empiezan en mayúscula.
//
// Se comprueban recorriendo el DOCUMENTO GENERADO, no el campo que se espera: el
// fallo original se colaba por `businessType`, que acababa en el hero, en el
// `seo.title`, en el `meta.name` y en el encabezado de la sección de texto. Un
// test que mirase un solo campo habría dejado pasar los otros.

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "features" }, { type: "text" }, { type: "faq" }, { type: "cta" }],
};

/**
 * Todo el texto PUBLICADO del documento (páginas y nombre del sitio), en una
 * sola cadena. `design.ownerPrompt` queda FUERA a propósito: es la burbuja del
 * dueño en el chat del panel (documentado en `draft.ts`, `designBrief`/
 * `ownerPrompt`), no una página publicada, y ahí SÍ debe verse lo que escribió
 * tal cual. Lo que no puede aparecer es en el sitio que ve una visita: páginas,
 * SEO y el nombre del sitio.
 */
function todoElTexto(doc) {
  return JSON.stringify({ meta: doc.meta, pages: doc.pages });
}

/** Encabezados y titulares de todas las secciones de todas las páginas. */
function encabezados(doc) {
  const out = [];
  for (const page of doc.pages) {
    for (const section of page.sections) {
      const props = section.props ?? {};
      for (const key of ["headline", "heading", "subline", "q"]) {
        if (typeof props[key] === "string") out.push(props[key]);
      }
    }
  }
  return out;
}

/** El documento de una landing a partir de la frase del dueño. */
function documento(frase) {
  const brief = normalizeBrief({ description: frase });
  return draftSite(brief, PRESET);
}

// ---------------------------------------------------------------------------
// 1. La instrucción del cliente no se publica
// ---------------------------------------------------------------------------

test("la instrucción del cliente no aparece en titular, SEO ni encabezados", () => {
  const frase = "tengo un negocio de consultoria tributaria hazme una landing page";
  const doc = documento(frase);
  const home = doc.pages[0];

  // Recorrido completo del documento: si la frase se cuela por cualquier campo
  // (incluido uno que hoy no existe), esto falla.
  const completo = todoElTexto(doc).toLowerCase();
  for (const prohibido of ["hazme", "landing page", "tengo un negocio"]) {
    assert.equal(completo.includes(prohibido), false, `«${prohibido}» no debe aparecer en el documento`);
  }

  // Y el titular y el SEO hablan del negocio de verdad.
  assert.match(home.seo.title, /Consultor[íi]a tributaria/i);
  assert.equal(home.seo.title.toLowerCase().includes("landing"), false);
  assert.match(home.seo.description.toLowerCase(), /consultor/i);

  const headline = home.sections.find((s) => s.type === "hero")?.props.headline ?? "";
  assert.match(headline, /Consultor[íi]a tributaria/i);
  assert.equal(headline.toLowerCase().includes("hazme"), false);

  // Ningún encabezado repite la instrucción.
  for (const texto of encabezados(doc)) {
    assert.equal(/hazme|landing page|tengo un negocio/i.test(texto), false, `encabezado con la instrucción: ${texto}`);
  }
});

test("una frase que solo es encargo no deja datos publicables", () => {
  // Control negativo del anterior: sin negocio que extraer no se inventa nada y,
  // sobre todo, no se publica el encargo.
  const doc = documento("hazme una landing page");
  const completo = todoElTexto(doc).toLowerCase();
  assert.equal(completo.includes("hazme"), false);
  assert.equal(completo.includes("landing page"), false);
});

// ---------------------------------------------------------------------------
// 2. Un nombre de relleno no es un nombre
// ---------------------------------------------------------------------------

test("«Mi sitio» no se publica como nombre, titular ni SEO", () => {
  // Ruta real: el panel manda `name: "Mi sitio"` cuando el dueño no escribe uno.
  const brief = normalizeBrief({
    name: "Mi sitio",
    businessType: "consultoría tributaria",
    city: "Getafe",
  });
  // El nombre de relleno se trata como hueco: se le pide al dueño.
  assert.equal(brief.pending.includes("name"), true, "el nombre queda pendiente, no dado");

  const doc = draftSite(brief, PRESET);
  const home = doc.pages[0];

  assert.notEqual(doc.meta.name, "Mi sitio");
  assert.equal(todoElTexto(doc).toLowerCase().includes("mi sitio"), false, "«Mi sitio» no aparece en el documento");

  const headline = home.sections.find((s) => s.type === "hero")?.props.headline ?? "";
  assert.notEqual(headline, "Mi sitio");
  assert.match(headline, /Consultor[íi]a tributaria en Getafe/);
  assert.notEqual(home.seo.title, "Mi sitio");
  assert.match(home.seo.title, /Consultor[íi]a tributaria en Getafe/);

  // Un nombre de verdad SÍ se publica: la garantía es contra el relleno, no
  // contra los nombres.
  const conNombre = draftSite(normalizeBrief({ name: "Aurora Gestión", businessType: "consultoría tributaria" }), PRESET);
  assert.equal(conNombre.meta.name, "Aurora Gestión");
  assert.equal(conNombre.pages[0].sections.find((s) => s.type === "hero")?.props.headline, "Aurora Gestión");
});

// ---------------------------------------------------------------------------
// 3. Titular, SEO y nombre del sitio empiezan en mayúscula
// ---------------------------------------------------------------------------

test("titular, seo.title y meta.name empiezan en mayúscula", () => {
  // El tipo sale del texto del dueño, que lo escribe en minúsculas.
  const doc = documento("somos una peluquería en Getafe");
  const home = doc.pages[0];
  const headline = home.sections.find((s) => s.type === "hero")?.props.headline ?? "";

  assert.equal(headline, "Peluquería en Getafe");
  assert.equal(home.seo.title, "Peluquería en Getafe");
  assert.equal(doc.meta.name, "Peluquería en Getafe");

  // Y sin ciudad: solo el tipo, también en mayúscula.
  const sinCiudad = documento("tengo un negocio de consultoria tributaria");
  const headSinCiudad = sinCiudad.pages[0].sections.find((s) => s.type === "hero")?.props.headline ?? "";
  assert.equal(headSinCiudad, "Consultoria tributaria");
  assert.equal(sinCiudad.pages[0].seo.title, "Consultoria tributaria");
});
