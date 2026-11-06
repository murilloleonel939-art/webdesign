import { test } from "node:test";
import assert from "node:assert/strict";
import { HtmlValidate } from "html-validate";
import { samplePage } from "./fixtures.mjs";

// HTML valido (spec 12, aceptacion de Fase 1): cada pagina del sitio de muestra
// debe pasar html-validate sin errores.
const validator = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    // El renderer usa <section> con clase y id de seccion: es intencionado.
    "no-inline-style": "off",
    "prefer-native-element": "off",
    // Ambas formas (<meta> y <img/>) son HTML5 valido; la regla solo mide estilo.
    "void-style": "off",
  },
});

for (const pageId of ["p_home", "p_precios"]) {
  test(`${pageId} es HTML valido`, async () => {
    const report = await validator.validateString(samplePage(pageId));
    const errors = report.results.flatMap((r) => r.messages.filter((m) => m.severity === 2));
    assert.deepEqual(errors.map((e) => `${e.ruleId}: ${e.message}`), []);
  });
}
