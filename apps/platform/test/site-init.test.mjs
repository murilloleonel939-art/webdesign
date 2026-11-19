import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSiteDocument } from "@webdesign/site-schema";
import { cutWords, initialDoc } from "../dist/api.js";

// Reparacion del fallo de produccion: un prompt largo como nombre no debe
// romper el esquema (meta.name<=80, pages.0.seo.title<=70) ni dejar un sitio
// sin borrador.

test("cutWords no supera el limite ni deja espacio final", () => {
  const s = cutWords("palabra ".repeat(30), 60);
  assert.ok(s.length <= 60);
  assert.notEqual(s.slice(-1), " ");
});

test("cutWords corta en seco si ni la primera palabra cabe", () => {
  const s = cutWords("a".repeat(100), 10);
  assert.equal(s.length, 10);
});

test("initialDoc con nombre de 200 caracteres valida contra el esquema", () => {
  const nombreLargo = "Panaderia artesanal del barrio con pan de masa madre y repostería fina para eventos y bodas en toda la ciudad y alrededores ".repeat(2);
  const { doc } = initialDoc(nombreLargo);
  assert.ok(doc.meta.name.length <= 80);
  assert.ok(doc.pages[0].seo.title.length <= 70);
  const r = validateSiteDocument(doc);
  assert.equal(r.ok, true, r.ok ? "" : r.errors.join(", "));
});

test("initialDoc usa 'Mi sitio' si el nombre queda vacio tras limpiar", () => {
  const { doc, siteName } = initialDoc("   ");
  assert.equal(siteName, "Mi sitio");
  assert.equal(validateSiteDocument(doc).ok, true);
});

test("initialDoc pone la idea recortada a 500 en design.idea y valida", () => {
  const idea = "a".repeat(600);
  const { doc } = initialDoc("Mi sitio", idea);
  assert.equal(doc.design.idea.length, 500);
  assert.equal(validateSiteDocument(doc).ok, true);
});

test("initialDoc sin idea deja design.idea vacio", () => {
  const { doc } = initialDoc("Mi sitio");
  assert.equal(doc.design.idea, "");
  assert.equal(validateSiteDocument(doc).ok, true);
});
