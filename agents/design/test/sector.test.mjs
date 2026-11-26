import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBrief, sectorForBrief } from "../dist/index.js";

// Sector de la biblioteca de fotos (T-020).
//
// Determinista y sin modelo, igual que `classifyShape`: el sector sale de las
// palabras del brief, con `\b` por palabra, sin acentos y sin distinguir
// mayusculas. Si no hay senal, `neutro`, que es el sector que no promete nada.

/** Sector de un brief escrito como en la entrada real del agente. */
const sectorOf = (input) => sectorForBrief(normalizeBrief(input));

test("despacho: «buffet de abogados» (error de escritura incluido)", () => {
  assert.equal(sectorOf({ businessType: "buffet de abogados" }), "despacho");
});

test("salud: «clínica dental»", () => {
  assert.equal(sectorOf({ businessType: "clínica dental" }), "salud");
});

test("belleza: «peluquería»", () => {
  assert.equal(sectorOf({ businessType: "peluquería" }), "belleza");
});

test("hosteleria: «restaurante»", () => {
  assert.equal(sectorOf({ businessType: "restaurante" }), "hosteleria");
});

test("comercio: «tienda de ropa»", () => {
  assert.equal(sectorOf({ businessType: "tienda de ropa" }), "comercio");
});

test("taller: «taller mecánico»", () => {
  assert.equal(sectorOf({ businessType: "taller mecánico" }), "taller");
});

test("brief vacío da neutro", () => {
  assert.equal(sectorOf({}), "neutro");
});

test("palabra completa: «bar» no casa dentro de «barrio»", () => {
  assert.equal(sectorOf({ businessType: "tienda de barrio" }), "comercio");
  // «barrio» contiene «bar», pero no es la palabra «bar».
  assert.equal(sectorOf({ name: "Barrio Norte" }), "neutro");
});

test("la primera senal que coincide manda: despacho gana a hosteleria", () => {
  // «buffet» es despacho aunque la frase hable de comida.
  assert.equal(sectorOf({ businessType: "buffet de abogados", description: "comida para clientes" }), "despacho");
});

test("brief de producción: buffet de abogados en Barranquilla", () => {
  const sentence = "quiero una pagina web para un buffet de abogados en barranquilla";
  assert.equal(sectorOf({ description: sentence }), "despacho");
});

test("el marcador pendiente no inventa sector", () => {
  assert.equal(sectorOf({ businessType: "pendiente de confirmar", service: "pendiente de confirmar" }), "neutro");
});
