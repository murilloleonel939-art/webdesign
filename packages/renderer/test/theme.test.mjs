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

test("cada seccion tiene maquetacion, no solo el tema", () => {
  // El sitio publicado salia como un documento corrido porque el CSS solo
  // definia colores y tipografia: ninguna seccion tenia rejilla ni tarjetas.
  const css = themeCss(theme);
  for (const sel of [".hero h1", ".features ul", ".pricing__plan", ".gallery img",
    ".image img", ".text", ".testimonial blockquote", ".faq summary", ".cta-block"]) {
    assert.ok(css.includes(sel), `falta maquetacion para ${sel}`);
  }
  assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length, "CSS desbalanceado");
});

test("la imagen suelta se acota al ancho de lectura", () => {
  // object-fit no hace nada sin dimensiones: la imagen salia a su tamano
  // natural (1280 px) y desbordaba la columna.
  const css = themeCss(theme);
  const regla = css.match(/\.image img\{([^}]*)\}/)?.[1] ?? "";
  assert.match(regla, /width:100%/);
  assert.match(regla, /height:auto/);
});

// Los ocho presets de `packages/db/migrations/0009_design_catalog.sql`. El hero
// grafico tiene que funcionar con todos, no con el que se miro al disenarlo.
const PRESETS = {
  editorial: { colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" }, typography: { family: "Source Serif 4", scale: "large" }, spacing: { margin: 64, sectionGap: 72 }, radius: "rounded" },
  minimal: { colors: { ground: "#ffffff", ink: "#111111", accent: "#0b5fff" }, typography: { family: "Inter", scale: "normal" }, spacing: { margin: 80, sectionGap: 96 }, radius: "square" },
  warm: { colors: { ground: "#fdf6ee", ink: "#2b1d17", accent: "#b8451f" }, typography: { family: "Fraunces", scale: "large" }, spacing: { margin: 56, sectionGap: 64 }, radius: "pill" },
  tech: { colors: { ground: "#0e1117", ink: "#e8edf5", accent: "#24c8a5" }, typography: { family: "Inter", scale: "normal" }, spacing: { margin: 48, sectionGap: 56 }, radius: "rounded" },
  studio: { colors: { ground: "#f4f4f6", ink: "#1c1b22", accent: "#5b3df5" }, typography: { family: "Space Grotesk", scale: "large" }, spacing: { margin: 72, sectionGap: 88 }, radius: "rounded" },
  trust: { colors: { ground: "#f8fafc", ink: "#0f172a", accent: "#1d4ed8" }, typography: { family: "Merriweather", scale: "normal" }, spacing: { margin: 60, sectionGap: 72 }, radius: "rounded" },
  fresh: { colors: { ground: "#ffffff", ink: "#14342b", accent: "#0f7b52" }, typography: { family: "Nunito", scale: "normal" }, spacing: { margin: 64, sectionGap: 80 }, radius: "pill" },
  bold: { colors: { ground: "#121212", ink: "#fafafa", accent: "#f5a524" }, typography: { family: "Archivo", scale: "xlarge" }, spacing: { margin: 52, sectionGap: 64 }, radius: "square" },
};

/** Bloques de la hoja cuyo selector contiene `needle`, con sus declaraciones. */
function blocks(css, needle) {
  const out = [];
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{");
    if (open === -1) continue;
    if (!chunk.slice(0, open).includes(needle)) continue;
    out.push({ selector: chunk.slice(0, open).trim(), decls: chunk.slice(open + 1) });
  }
  return out;
}

test("el hero sin foto trae su propia composicion en los ocho presets", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    assert.ok(blocks(css, ".hero--graphic").length > 0, `${id}: falta .hero--graphic`);
    // El titular grande con clamp es el recurso principal del hero sin foto.
    const h1 = blocks(css, ".hero--graphic h1").find((b) => b.decls.includes("clamp("));
    assert.ok(h1, `${id}: el titular del hero grafico deberia usar clamp()`);
    assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length, `${id}: CSS desbalanceado`);
  }
});

test("el hero grafico no inventa colores ni acentos nuevos", () => {
  // Un solo acento por pagina: todo color del hero grafico sale de los tokens.
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const { selector, decls } of blocks(themeCss(preset), ".hero--graphic")) {
      assert.equal(/(^|[^-\w])#[0-9a-fA-F]{3,8}\b/.test(decls), false, `${id}: color literal en ${selector}`);
      assert.equal(/rgba?\(/.test(decls), false, `${id}: color literal en ${selector}`);
      // Lo que pinta algo (color, fondo o borde) tiene que salir del tema.
      if (/(^|;)\s*(color|background|border)/.test(decls)) {
        assert.match(decls, /var\(--(accent|ink|ground)\)/, `${id}: ${selector} pinta sin token`);
      }
    }
  }
});

test("el hero grafico no anima nada de layout", () => {
  // Sin animacion no hay MOTION_LAYOUT_ANIMATION que corregir. Si algun dia se
  // anade, solo puede tocar transform u opacity.
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const { selector, decls } of blocks(themeCss(preset), ".hero--graphic")) {
      const motion = /(^|;)\s*(transition|animation)(-[a-z]+)?\s*:/.exec(decls);
      assert.equal(motion, null, `${id}: ${selector} declara ${motion?.[2]}`);
      assert.match(decls + ";", /;/, "declaraciones ilegibles");
    }
  }
});

test("el hero grafico tiene ajuste para movil", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    const movil = css.slice(css.indexOf("@media (max-width:719px)"));
    assert.ok(movil.includes(".hero--graphic"), `${id}: sin reglas de movil para el hero grafico`);
  }
});
