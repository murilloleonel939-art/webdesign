import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterPhoto,
  filterBatch,
  altFor,
  REJECT_REASONS,
  PEOPLE_TERMS,
  BRAND_TERMS,
  SECTOR_TERMS,
} from "../dist/photo-filter.js";

// Filtro de fotos por metadatos: 7 reglas, sin red y sin disco.
//
// Todo lo que se prueba aqui es logica pura: la foto entra como objeto y sale un
// veredicto. Ninguna prueba abre una conexion ni escribe un fichero.

function foto(extra = {}) {
  return {
    id: "abc-123",
    width: 1600,
    height: 900,
    alt: "An office with shelves and a desk",
    url: "https://unsplash.com/photos/abc-123",
    downloadLocation: "https://api.unsplash.com/photos/abc-123/download",
    photographer: "Fotografo",
    photographerUrl: "https://unsplash.com/@fotografo",
    sourceUrl: "https://unsplash.com/photos/abc-123",
    regularUrl: "https://images.unsplash.com/photo-1?w=1600&h=900",
    ...extra,
  };
}

function entrada(extra = {}) {
  return {
    photo: foto(),
    sector: "despacho",
    orientation: "landscape",
    knownIds: new Set(),
    ...extra,
  };
}

// --- 1. Una por regla: el rechazo y su motivo exacto -----------------------

test("regla 1 duplicate: el id ya esta en el banco", () => {
  const r = filterPhoto(entrada({ knownIds: new Set(["abc-123"]) }));
  assert.deepEqual(r, { accepted: false, reason: "duplicate" });
});

test("regla 2 too_small: landscape por debajo de 1600 de ancho", () => {
  const r = filterPhoto(entrada({ photo: foto({ width: 1599 }) }));
  assert.deepEqual(r, { accepted: false, reason: "too_small" });
});

test("regla 3 no_description: alt vacio", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "" }) }));
  assert.deepEqual(r, { accepted: false, reason: "no_description" });
});

test("regla 3 no_description: alt de menos de 12 caracteres", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "Nice desk" }) }));
  assert.deepEqual(r, { accepted: false, reason: "no_description" });
});

test("regla 3 no_description: frase generica de Unsplash", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "a close up of a person" }) }));
  assert.deepEqual(r, { accepted: false, reason: "no_description" });
});

test("regla 4 portrait_or_people: retrato en el alt", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Portrait of a smiling woman at a desk" }) }),
  );
  assert.deepEqual(r, { accepted: false, reason: "portrait_or_people" });
});

test("regla 5 brand: marca visible en el alt", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "An office desk with an Apple laptop" }) }));
  assert.deepEqual(r, { accepted: false, reason: "brand" });
});

test("regla 6 aspect_mismatch: landscape demasiado cuadrado", () => {
  const r = filterPhoto(entrada({ photo: foto({ width: 1600, height: 1200 }) }));
  assert.deepEqual(r, { accepted: false, reason: "aspect_mismatch" });
});

test("regla 7 off_topic: el alt no nombra nada del sector", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "A sunny beach with palm trees" }) }));
  assert.deepEqual(r, { accepted: false, reason: "off_topic" });
});

// --- Orden: gana el primer rechazo ----------------------------------------

test("orden: duplicate gana a too_small", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ id: "abc-123", width: 100 }), knownIds: new Set(["abc-123"]) }),
  );
  assert.equal(r.reason, "duplicate");
});

test("orden: too_small gana a no_description", () => {
  const r = filterPhoto(entrada({ photo: foto({ width: 800, alt: "" }) }));
  assert.equal(r.reason, "too_small");
});

test("orden: no_description gana a portrait_or_people", () => {
  const r = filterPhoto(entrada({ photo: foto({ alt: "a close up of a person" }) }));
  assert.equal(r.reason, "no_description");
});

test("orden: brand gana a off_topic", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "A Nike shoe on a shelf" }), sector: "despacho" }),
  );
  assert.equal(r.reason, "brand");
});

// --- 2. Falsos positivos: tienen que pasar --------------------------------

test("falso positivo: 'human resources office' no es un retrato", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Human resources office with two chairs" }) }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("falso positivo: 'happiness at work' no es la marca hp", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Happiness at work in a bright office" }) }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("falso positivo: 'management meeting' no es un hombre", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Management meeting in a small office" }) }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("falso positivo: 'fireman' tampoco es 'man'", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "A fireman helmet on a workbench" }), sector: "taller" }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("falso positivo: una tarta de manzana no es la marca Apple", () => {
  const r = filterPhoto(
    entrada({
      photo: foto({ alt: "Apple pie on a wooden table in a cafe" }),
      sector: "hosteleria",
    }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("falso positivo: 'canon law' no es la marca Canon", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "A book about canon law on a desk" }) }),
  );
  assert.deepEqual(r, { accepted: true });
});

// --- 3. Lote mixto de 10 ---------------------------------------------------

test("lote mixto de 10: counts cuadra y aceptadas + rechazadas = 10", () => {
  const lote = [
    entrada({ photo: foto({ id: "a1" }) }),
    entrada({ photo: foto({ id: "a2", alt: "A bright meeting room with chairs" }) }),
    entrada({ photo: foto({ id: "a3", alt: "A quiet workspace with books" }) }),
    entrada({ photo: foto({ id: "d1" }), knownIds: new Set(["d1"]) }),
    entrada({ photo: foto({ id: "s1", width: 900 }) }),
    entrada({ photo: foto({ id: "s2", width: 1000, alt: "" }) }),
    entrada({ photo: foto({ id: "n1", alt: "" }) }),
    entrada({ photo: foto({ id: "p1", alt: "Candid portrait of a man at a desk" }) }),
    entrada({ photo: foto({ id: "b1", alt: "A desk with an iPhone and a notebook" }) }),
    entrada({ photo: foto({ id: "f1", alt: "A sunny beach with palm trees" }) }),
  ];
  const r = filterBatch(lote);
  assert.equal(r.accepted.length + r.rejected.length, 10);
  assert.equal(r.accepted.length, 3);
  assert.equal(r.rejected.length, 7);
  // `counts` cuenta SOLO rechazos: su suma tiene que ser la de rechazadas, y
  // aceptadas + rechazadas, el tamano del lote.
  assert.equal(
    Object.values(r.counts).reduce((a, b) => a + b, 0),
    r.rejected.length,
  );
  assert.equal(r.accepted.length + r.rejected.length, 10);
  assert.equal(r.counts.duplicate, 1);
  assert.equal(r.counts.too_small, 2);
  assert.equal(r.counts.no_description, 1);
  assert.equal(r.counts.portrait_or_people, 1);
  assert.equal(r.counts.brand, 1);
  assert.equal(r.counts.aspect_mismatch, 0);
  assert.equal(r.counts.off_topic, 1);
});

test("lote vacio: los 7 contadores existen y valen 0", () => {
  const r = filterBatch([]);
  assert.deepEqual(r.accepted, []);
  assert.deepEqual(r.rejected, []);
  for (const reason of REJECT_REASONS) assert.equal(r.counts[reason], 0);
  assert.equal(Object.keys(r.counts).length, 7);
});

// --- 4. knownIds -----------------------------------------------------------

test("knownIds: id presente en el conjunto -> duplicate", () => {
  const conocidos = new Set(["otra-1", "abc-123", "otra-2"]);
  const r = filterPhoto(entrada({ knownIds: conocidos }));
  assert.deepEqual(r, { accepted: false, reason: "duplicate" });
});

test("knownIds: id ausente del conjunto -> no es duplicate", () => {
  const r = filterPhoto(entrada({ knownIds: new Set(["otra-1"]) }));
  assert.equal(r.accepted, true);
});

// --- 5. Proporcion ---------------------------------------------------------

test("1600x900 (16:9) se acepta como landscape", () => {
  const r = filterPhoto(entrada({ photo: foto({ width: 1600, height: 900 }) }));
  assert.deepEqual(r, { accepted: true });
});

test("1600x1600 se rechaza como landscape por proporcion", () => {
  const r = filterPhoto(entrada({ photo: foto({ width: 1600, height: 1600 }) }));
  assert.deepEqual(r, { accepted: false, reason: "aspect_mismatch" });
});

test("landscape en los bordes 1.5 y 2.0 se acepta; fuera, no", () => {
  assert.equal(filterPhoto(entrada({ photo: foto({ width: 1600, height: 1066 }) })).accepted, true);
  assert.equal(filterPhoto(entrada({ photo: foto({ width: 2000, height: 1000 }) })).accepted, true);
  assert.equal(
    filterPhoto(entrada({ photo: foto({ width: 1600, height: 1100 }) })).reason,
    "aspect_mismatch",
  );
  assert.equal(
    filterPhoto(entrada({ photo: foto({ width: 2010, height: 1000 }) })).reason,
    "aspect_mismatch",
  );
});

test("square: 1200x1200 vale, y 1200x1600 no", () => {
  const ok = filterPhoto(entrada({ photo: foto({ width: 1200, height: 1200 }), orientation: "square" }));
  assert.deepEqual(ok, { accepted: true });
  const alto = filterPhoto(
    entrada({ photo: foto({ width: 1200, height: 1600 }), orientation: "square" }),
  );
  assert.deepEqual(alto, { accepted: false, reason: "aspect_mismatch" });
});

test("square pide 1200 de ancho: 1199 es too_small", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ width: 1199, height: 1199 }), orientation: "square" }),
  );
  assert.deepEqual(r, { accepted: false, reason: "too_small" });
});

// --- 6. altFor -------------------------------------------------------------

function sinPersonasNiMarcas(texto) {
  const bajo = texto.toLowerCase();
  for (const term of PEOPLE_TERMS) {
    const re = new RegExp(`(?:^|[^a-z0-9])${term}(?=$|[^a-z0-9])`, "i");
    assert.equal(re.test(bajo), false, `menciona persona: "${term}" en "${texto}"`);
  }
  for (const brand of BRAND_TERMS) {
    const re = new RegExp(`(?:^|[^a-z0-9])${brand}(?=$|[^a-z0-9])`, "i");
    assert.equal(re.test(bajo), false, `menciona marca: "${brand}" en "${texto}"`);
  }
}

test("altFor nunca devuelve cadena vacia, ni habla de personas o marcas", () => {
  const alts = [
    "",
    "   ",
    "a close up of a person",
    "Portrait of a smiling woman",
    "An office desk with an Apple laptop and a can of Coca-Cola",
    "Happiness at work",
    "A blurry image",
    "An office with shelves and a plant",
    "Coffee shop counter with a menu",
    "Wooden workbench with tools",
    "Hair salon with mirrors and chairs",
    "Store shelves with clothing on display",
    "Clinic reception with medical equipment",
    "Laptop and notebook on a desk",
    "A sunny beach with palm trees",
  ];
  const sectores = ["despacho", "hosteleria", "comercio", "salud", "taller", "belleza", "neutro"];
  for (const sector of sectores) {
    for (const alt of alts) {
      const salida = altFor(foto({ alt }), sector);
      assert.equal(typeof salida, "string");
      assert.notEqual(salida.trim(), "", `altFor vacio (${sector} / "${alt}")`);
      sinPersonasNiMarcas(salida);
    }
  }
});

test("altFor traduce solo lo que dice el original", () => {
  assert.equal(
    altFor(foto({ alt: "An office with shelves and a plant" }), "despacho"),
    "Espacio de trabajo con estanterías y plantas",
  );
  assert.equal(altFor(foto({ alt: "Coffee shop counter with a menu" }), "hosteleria"), "Interior de una cafetería");
  assert.equal(altFor(foto({ alt: "Wooden workbench with tools" }), "taller"), "Taller con herramientas");
});

test("altFor cae en la frase generica cuando no hay nada seguro", () => {
  assert.equal(altFor(foto({ alt: "" }), "despacho"), "Espacio de trabajo");
  assert.equal(altFor(foto({ alt: "" }), "comercio"), "Interior de un negocio");
  assert.equal(altFor(foto({ alt: "Portrait of a smiling woman" }), "belleza"), "Interior de un negocio");
  assert.equal(altFor(foto({ alt: "A desk with an iPhone" }), "despacho"), "Espacio de trabajo");
  // Ni el sector inventado rompe nada: cae en neutro.
  assert.equal(altFor(foto({ alt: "" }), "inventado"), "Espacio de trabajo");
});

test("altFor no afirma el tipo de negocio si el alt no lo dice", () => {
  const salida = altFor(foto({ alt: "A shelf with books" }), "comercio");
  assert.equal(salida.includes("librería"), false);
  assert.equal(salida.includes("tienda"), false);
});

// --- 7. Los 7 sectores, con un alt tipico ---------------------------------

test("los 7 sectores aceptan un alt tipico suyo", () => {
  const casos = [
    ["despacho", "An office with a desk and shelves"],
    ["hosteleria", "Coffee shop counter with pastries and a menu"],
    ["comercio", "Store shelves with clothing on display"],
    ["salud", "Clinic reception with medical equipment"],
    ["taller", "Wooden workbench with tools in a workshop"],
    ["belleza", "Hair salon with mirrors and chairs"],
    ["neutro", "Laptop and notebook on a desk with a plant"],
  ];
  for (const [sector, alt] of casos) {
    const r = filterPhoto(entrada({ photo: foto({ id: `s-${sector}`, alt }), sector }));
    assert.deepEqual(r, { accepted: true }, `sector ${sector}: "${alt}"`);
    assert.ok(SECTOR_TERMS[sector].length > 0);
  }
});

test("un alt de otro sector cae en off_topic", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Hair salon with mirrors and chairs" }), sector: "taller" }),
  );
  assert.deepEqual(r, { accepted: false, reason: "off_topic" });
});

// --- tags, solo si vienen --------------------------------------------------

test("tags si vienen: una etiqueta de persona rechaza", () => {
  const r = filterPhoto(
    entrada({
      photo: foto({
        alt: "An office with a desk and shelves",
        tags: [{ title: "Man" }, { title: "Office" }],
      }),
    }),
  );
  assert.deepEqual(r, { accepted: false, reason: "portrait_or_people" });
});

test("tags si vienen: una etiqueta de marca rechaza", () => {
  const r = filterPhoto(
    entrada({
      photo: foto({
        alt: "An office with a desk and shelves",
        tags: ["Office", "Nike"],
      }),
    }),
  );
  assert.deepEqual(r, { accepted: false, reason: "brand" });
});

test("sin tags el filtro funciona igual (no se inventan campos)", () => {
  const r = filterPhoto(entrada({ photo: foto() }));
  assert.deepEqual(r, { accepted: true });
  assert.equal("tags" in foto(), false);
});

// --- Entradas raras: no lanza ---------------------------------------------

test("entradas incompletas no lanzan", () => {
  assert.equal(typeof filterPhoto(entrada()).accepted, "boolean");
  assert.equal(typeof filterPhoto({ photo: null }).accepted, "boolean");
  assert.equal(typeof filterPhoto({}).accepted, "boolean");
  assert.equal(typeof filterBatch([]).counts.off_topic, "number");
});

// --- Tolerancia de integracion ---------------------------------------------

test("'squarish' (como lo llama Unsplash) se trata como square", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ width: 1200, height: 1200 }), orientation: "squarish" }),
  );
  assert.deepEqual(r, { accepted: true });
  const alto = filterPhoto(
    entrada({ photo: foto({ width: 1200, height: 1600 }), orientation: "squarish" }),
  );
  assert.deepEqual(alto, { accepted: false, reason: "aspect_mismatch" });
});

test("texto raro no rompe el filtro", () => {
  const raros = [
    "----------",
    "   .   ",
    "AN  OFFICE   WITH\nA DESK AND SHELVES",
    "office ".repeat(200),
    "A desk with shelves \u0000 and a plant",
  ];
  for (const alt of raros) {
    const r = filterPhoto(entrada({ photo: foto({ alt }) }));
    assert.equal(typeof r.accepted, "boolean");
    const salida = altFor(foto({ alt }), "despacho");
    assert.notEqual(salida.trim(), "");
  }
});

test("campos con tipo equivocado no lanzan", () => {
  const r = filterPhoto(
    entrada({ photo: { id: 7, width: "1600", height: null, alt: 42 }, knownIds: [] }),
  );
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "too_small");
});

// --- Casos concretos que el probe encontro --------------------------------

test("off_topic: 'a bar of soap' no es un bar", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "A bar of soap wrapped in paper" }), sector: "hosteleria" }),
  );
  assert.deepEqual(r, { accepted: false, reason: "off_topic" });
});

test("el bar como local si cuenta", () => {
  const r = filterPhoto(
    entrada({ photo: foto({ alt: "Bar counter with bottles on a shelf" }), sector: "hosteleria" }),
  );
  assert.deepEqual(r, { accepted: true });
});

test("altFor no repite el sujeto en plural: nada de 'Mesa con mesas'", () => {
  assert.equal(altFor(foto({ alt: "Wooden table with a bowl of fruit" }), "taller"), "Mesa");
  assert.equal(altFor(foto({ alt: "A chair in an empty hall" }), "despacho"), "Silla");
  assert.equal(altFor(foto({ alt: "Tables in a bright dining room" }), "hosteleria"), "Interior de un restaurante con mesas");
});
