import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShape, normalizeBrief } from "../dist/index.js";

// Clasificador de forma del sitio (spec T-003.3).
//
// Determinista y sin modelo: decide entre landing y sitio de varias paginas a
// partir del brief. Estas pruebas fijan las dos reglas de senal, el valor por
// defecto y, sobre todo, que la coincidencia es por palabra completa.

/** Clasifica un brief escrito como en la entrada real del agente. */
const shapeOf = (input) => classifyShape(normalizeBrief(input));

test("regla 1: una senal de oferta unica da landing", () => {
  assert.equal(shapeOf({ description: "vendo un curso de inglés online" }), "landing");
});

test("regla 2: una senal de negocio con areas da site", () => {
  assert.equal(shapeOf({ businessType: "clínica dental", city: "Bogotá" }), "site");
});

test("regla 2: restaurante da site", () => {
  assert.equal(shapeOf({ businessType: "restaurante" }), "site");
});

test("regla 3: sin ninguna senal se asume landing", () => {
  assert.equal(shapeOf({}), "landing");
});

test("regla 2: asesoria es una senal de negocio con areas", () => {
  assert.equal(shapeOf({ businessType: "asesoría fiscal para autónomos" }), "site");
});

test("regla 1: lanzamiento y ebook son senales de oferta unica", () => {
  assert.equal(shapeOf({ description: "lanzamiento de mi nuevo ebook" }), "landing");
});

test("palabra completa: bar casa como senal, no dentro de barrio", () => {
  assert.equal(shapeOf({ businessType: "tienda de barrio" }), "site");
  // Protege contra la coincidencia por subcadena: «barrio» no es «bar».
  assert.equal(shapeOf({ description: "somos de barrio" }), "landing");
});

test("palabra completa: curso no casa dentro de recursos", () => {
  // Protege contra la coincidencia por subcadena: «recursos» no es «curso».
  assert.equal(shapeOf({ description: "recursos humanos para pymes" }), "landing");
});

test("palabra completa: bar no casa dentro de baratos", () => {
  // Protege contra la coincidencia por subcadena: «baratos» no es «bar».
  assert.equal(shapeOf({ description: "precios baratos" }), "landing");
});

test("raiz abogad: casa abogados y sus variantes", () => {
  assert.equal(shapeOf({ businessType: "abogados en Madrid" }), "site");
});

test("palabra completa: la senal puede ir entre otras palabras", () => {
  assert.equal(shapeOf({ businessType: "un bar en el centro" }), "site");
});

test("normalizacion: mayusculas y acentos no evitan la senal", () => {
  assert.equal(shapeOf({ businessType: "CLÍNICA DENTAL" }), "site");
});
