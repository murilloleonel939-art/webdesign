import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { samplePage } from "./fixtures.mjs";

// Accesibilidad critica (spec 12): axe-core sobre el DOM renderizado. Bloquea solo
// hallazgos `critical`; `serious` se reporta sin bloquear hasta revisarlos.
const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

for (const pageId of ["p_home", "p_precios"]) {
  test(`${pageId} no tiene fallos criticos de accesibilidad`, async () => {
    const dom = new JSDOM(samplePage(pageId), { runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.eval(axeSource);
    const results = await dom.window.eval(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })`);
    // axe.run devuelve una promesa dentro de jsdom; se espera el resultado real.
    const critical = Array.from((await Promise.resolve(results)).violations)
      .filter((v) => v.impact === "critical")
      // Se copia a strings planos: los objetos de jsdom viven en otro realm.
      .map((v) => `${v.id}: ${v.help}`);
    assert.deepEqual(critical, []);
  });
}
