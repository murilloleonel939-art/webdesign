import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEditorAssetPath } from "../dist/config.js";

test("la ruta de un asset es absoluta para el lienzo", () => {
  // El lienzo de Puck es un iframe con srcDoc: su origen es about:blank y una
  // ruta relativa no carga. La imagen se veia en el sitio pero no en el editor.
  // En el navegador existe location; en Node hay que simularlo.
  globalThis.location = { origin: "https://panel.test" };
  const p = resolveEditorAssetPath("/assets/abc/image/f.jpg");
  assert.equal(p.startsWith("/"), false, `deberia ser absoluta: ${p}`);
  assert.ok(p.endsWith("/assets/abc/image/f.jpg"));
});
