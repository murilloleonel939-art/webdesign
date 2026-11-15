import { test } from "node:test";
import assert from "node:assert/strict";
import { themeCss } from "../dist/theme-css.js";

const theme = {
  colors: { ground: "#FFFFFF", ink: "#111111", accent: "#0055FF" },
  typography: { family: "Inter", scale: "normal" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
};


test("las familias serif conservan su caracter y las sans no lo pierden", () => {
  // El respaldo evita que el texto quede sin tipografia, pero eso mismo
  // escondia el fallo: una familia serif ausente caia a la pila sans y el
  // diseno elegido dejaba de respetarse sin avisar.
  const serif = themeCss({ ...theme, typography: { family: "Fraunces", scale: "normal" } });
  const serifFamily = /font-family:([^;}]+)/.exec(serif)[1];
  assert.ok(serifFamily.includes("Georgia"), `Fraunces deberia ser serif: ${serifFamily}`);

  for (const f of ["Inter", "Instrument Sans", "Libre Franklin", "Archivo", "Space Grotesk", "Nunito"]) {
    const fam = /font-family:([^;}]+)/.exec(themeCss({ ...theme, typography: { family: f, scale: "normal" } }))[1];
    assert.equal(fam.includes("Georgia"), false, `${f} no deberia ser serif`);
  }
  for (const f of ["Source Serif 4", "Merriweather", "Serif"]) {
    const fam = /font-family:([^;}]+)/.exec(themeCss({ ...theme, typography: { family: f, scale: "normal" } }))[1];
    assert.ok(fam.includes("Georgia"), `${f} deberia ser serif`);
  }
});
