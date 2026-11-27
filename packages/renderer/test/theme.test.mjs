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
    const css = sinComentarios(themeCss(preset));
    const movil = css.slice(css.indexOf("@media (max-width:719px)"));
    assert.ok(movil.includes(".hero--graphic"), `${id}: sin reglas de movil para el hero grafico`);
  }
});

// ---------------------------------------------------------------------------
// T-023: el cierre, el radio, el hero, los pasos, el formulario y la tipografia.
// Cada prueba fija un defecto medido en produccion.
// ---------------------------------------------------------------------------

const HEX = /(^|[^-\w])#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;


/** Declaraciones de la regla cuyo selector es exactamente `sel`. Los comentarios
 *  de la hoja contienen comas y parentesis: sin quitarlos, el preludio de la
 *  regla llega con el comentario pegado y la comparacion exacta nunca casa. */
function declsOf(css, sel) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const chunk of clean.split("}")) {
    const open = chunk.indexOf("{");
    if (open === -1) continue;
    const sels = chunk.slice(0, open).split(",").map((s) => s.trim());
    if (sels.includes(sel)) return chunk.slice(open + 1);
  }
  return undefined;
}

/** La hoja lleva comentarios con selectores dentro (`\`.features li\``). Un test
 *  que busca selectores en el texto crudo los encuentra en la prosa y miente. */
function sinComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("T-023: el cierre no lleva ni un color literal, solo tokens del tema", () => {
  // El final de la pagina estaba escrito a mano (`#0b0b14`, `#7c3aed`,
  // `#06b6d4`, `#f5a524`) y por eso los ocho presets acababan identicos justo
  // en el bloque que la gente recuerda.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    for (const needle of [".cta-block", ".site-footer"]) {
      for (const { selector, decls } of blocks(css, needle)) {
        assert.equal(HEX.test(decls), false, `${id}: hex literal en ${selector}`);
        assert.equal(RGB.test(decls), false, `${id}: rgb literal en ${selector}`);
        assert.equal(/gradient/i.test(decls), false, `${id}: degradado en ${selector}`);
        // `inherit` y `currentColor` no inventan un color: heredan el del
        // token. Lo que se prohibe es un literal.
        if (/(^|;)\s*(color|background|border)/.test(decls) && !/(color|color-decoration):(inherit|currentcolor)/i.test(decls.replace(/\s+/g, ""))) {
          assert.match(decls, /var\(--(accent|ink|ground)\)|currentColor/, `${id}: ${selector} pinta sin token`);
        }
      }
    }
  }
});

test("T-023: el cierre cierra a sangre, no como una tarjeta flotante", () => {
  // `section{max-width:1140px;margin-inline:auto}` tambien alcanzaba al pie: la
  // banda oscura medía 1140 px con 150 px de crema a cada lado.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    for (const needle of [".cta-block", ".site-footer"]) {
      const base = declsOf(css, needle);
      assert.ok(base, `${id}: falta la regla base ${needle}`);
      assert.match(base, /background:var\(/, `${id}: ${needle} sin fondo del tema`);
      assert.match(base, /max-width:\s*none/, `${id}: ${needle} no ocupa el ancho`);
      assert.match(base, /margin-inline:\s*0/, `${id}: ${needle} sigue centrado`);
    }
  }
});

test("T-023: con el radio en pill, ni fotos, ni tarjetas ni el cierre se vuelven elipses", () => {
  // Un solo token mandaba en botones, fotos, tarjetas y en el bloque de cierre.
  // Con `pill` el hero media `border-radius:1009px` (una elipse) y el cierre era
  // un estadio de 1140x429.
  const techo = (decls) => {
    const m = /border-radius:\s*min\(\s*(\d+)px/.exec(decls);
    return m ? Number(m[1]) : undefined;
  };
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = sinComentarios(themeCss(preset));
    for (const needle of [".hero img", ".gallery img", ".image img", ".features li", ".pricing__plan"]) {
      // Solo el contenedor: `.pricing__plan li::before` es la vineta de 8 px.
      const found = blocks(css, needle)
        .filter((b) => b.selector.split(",").map((x) => x.trim()).includes(needle))
        .filter((b) => /border-radius:/.test(b.decls));
      assert.ok(found.length > 0, `${id}: ${needle} sin radio declarado`);
      for (const b of found) {
        const px = techo(b.decls);
        assert.ok(px !== undefined && px <= 12, `${id}: ${needle} pasa de 12px -> ${b.decls}`);
      }
    }
    const cierre = blocks(css, ".cta-block").find((b) => /border-radius:/.test(b.decls));
    assert.ok(cierre, `${id}: el cierre no declara radio`);
    assert.match(cierre.decls, /border-radius:\s*0/, `${id}: el cierre conserva el radio del boton`);
    // El boton si conserva el radio del preset: es donde el token tiene sentido.
    const boton = blocks(css, ".btn").find((b) => /border-radius:/.test(b.decls));
    assert.match(boton.decls, /border-radius:var\(--radius\)/, `${id}: el boton pierde su radio`);
  }
});

test("T-023: el h1 de movil tiene un solo tamano, no dos compitiendo", () => {
  // El @media declaraba `h1{1.9rem}` y `.hero h1{2.1rem}`: dos valores para el
  // mismo titular y el segundo siempre ganaba por especificidad.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = sinComentarios(themeCss(preset));
    const movil = css.slice(css.indexOf("@media (max-width:719px)"));
    // Selectores que declaran el tamaño del h1 dentro del bloque de movil.
    const reglas = [...movil.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const conTamano = reglas
      .map((m) => ({ sel: m[1].trim().replace(/^[\s,]+/, ""), decls: m[2] }))
      .filter((r) => r.sel.endsWith("h1") && /font-size/.test(r.decls));
    // El hero sin foto es otra variante y conserva su tamaño de cartel.
    const delHeroConFoto = conTamano.filter((r) => !r.sel.includes(".hero--graphic"));
    assert.equal(delHeroConFoto.length, 1, `${id}: ${delHeroConFoto.length} tamanos de h1 en movil: ${JSON.stringify(delHeroConFoto.map((r) => r.sel))}`);
    assert.equal(delHeroConFoto[0].sel, ".hero h1", `${id}: el unico tamano de movil deberia ser .hero h1 -> ${delHeroConFoto[0].sel}`);
    // Y ningun `h1` suelto compitiendo: seria letra muerta por especificidad.
    const sueltos = reglas.map((m) => m[1].trim()).filter((sel) => sel === "h1");
    assert.equal(sueltos.length, 0, `${id}: hay un h1 suelto en movil`);
  }
});

test("T-023: los pasos se numeran y el adorno de features no los toca", () => {
  // `.features li:nth-child(6n+2)::before` (0,2,2) ganaba a
  // `.features--steps li::before` (0,1,2): los pasos 02 y 03 salian como un
  // circulo y un cuadrado. El adorno hay que excluir la variante, no repetirlo.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = sinComentarios(themeCss(preset));
    const suelto = /(^|[\s,}])\.features li(:first-child|:nth-child)/.test(css);
    assert.equal(suelto, false, `${id}: hay un adorno de .features que alcanza .features--steps`);
    assert.match(css, /\.features:not\(\.features--steps\) li:first-child/, `${id}: falta el adorno acotado`);
    assert.match(css, /\.features--steps li::before\{[^}]*counter\(step/, `${id}: los pasos no se numeran`);
    assert.equal(/\.features--steps li:first-child\{[^}]*grid-column:\s*span/.test(css), false, `${id}: el primer paso vuelve a ocupar la rejilla entera`);
  }
});

test("T-023: cada seccion abre con la raya de acento del eyebrow", () => {
  // `.section-eyebrow` existia en la hoja y no se usaba nunca. El esquema no
  // tiene campo de etiqueta y no se inventa copy, asi que el abridor se dibuja.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = sinComentarios(themeCss(preset));
    assert.match(css, /\.section-eyebrow\{/, `${id}: desaparece .section-eyebrow`);
    const abridor = blocks(css, "section[data-section-id]>h2::before");
    assert.ok(abridor.length > 0, `${id}: ninguna seccion abre con raya`);
    assert.match(abridor[0].decls, /background:var\(--accent\)/, `${id}: la raya no usa el acento`);
  }
});

test("T-023: el ritmo vertical tiene dos escalones, no seis secciones iguales", () => {
  const ritmo = (css, needle) => {
    const b = blocks(css, needle).find((x) => /padding-block:calc\(var\(--gap\)\s*\*/.test(x.decls));
    return b ? /padding-block:calc\(var\(--gap\)\s*\*\s*([\d.]+)\)/.exec(b.decls)?.[1] : undefined;
  };
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = sinComentarios(themeCss(preset));
    const denso = ritmo(css, ".features");
    const suelto = ritmo(css, ".faq");
    assert.ok(denso !== undefined, `${id}: .features sin escalon propio`);
    assert.ok(suelto !== undefined, `${id}: .faq sin escalon propio`);
    assert.notEqual(denso, suelto, `${id}: los dos escalones valen lo mismo`);
  }
});

test("T-023: la tipografia no promete familias que no van a llegar", () => {
  // Sin @font-face y con `default-src 'self'`, `document.fonts` estaba vacio en
  // produccion: Fraunces caia a Times. La pila no puede fingir.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    assert.equal(/@font-face/.test(css), false, `${id}: @font-face sin archivo que servir`);
    assert.equal(/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"')]*\.woff/i.test(css), false, `${id}: fuente de terceros`);
    const fam = /font-family:([^;}]+)/.exec(css)[1];
    assert.match(fam, /(serif|sans-serif|monospace)\s*$/, `${id}: la pila no cierra en un generico: ${fam}`);
    // La comercial va primera: si el dueno la tiene, manda.
    assert.ok(fam.trim().startsWith(preset.typography.family.replace(/"/g, "")) || fam.trim().startsWith(`"${preset.typography.family}"`), `${id}: ${preset.typography.family} no abre su pila`);
  }
  // Las serif llevan al menos una serif real de sistema antes del generico: si
  // no, en Linux el titular cae en un serif de pantalla y deja de ser lo elegido.
  for (const f of ["Fraunces", "Source Serif 4", "Merriweather"]) {
    const fam = /font-family:([^;}]+)/.exec(themeCss({ ...theme, typography: { family: f, scale: "normal" } }))[1];
    assert.match(fam, /"(Iowan Old Style|Bitstream Charter|Charter|Palatino|Georgia)"/, `${f} no ofrece una serif real: ${fam}`);
  }
});

test("T-023: el formulario hereda tipografia y se maqueta en rejilla", () => {
  // Los inputs salian a Arial 13.33px y el textarea a monospace 13.33px dentro
  // de un cuerpo de 18.24px, con borde nativo y radio 0.
  for (const [id, preset] of Object.entries(PRESETS)) {
    const css = themeCss(preset);
    const form = blocks(css, ".lead-form").find((b) => /grid-template-columns/.test(b.decls));
    assert.ok(form, `${id}: el formulario no es una rejilla`);
    const campo = blocks(css, ".lead-form input").find((b) => /font:inherit/.test(b.decls));
    assert.ok(campo, `${id}: los campos no heredan la tipografia`);
    assert.match(campo.decls, /border-radius:min\(\s*\d+px/, `${id}: los campos no llevan el radio del tema`);
    const etiqueta = blocks(css, ".lead-form label").find((b) => /display:grid|display:block/.test(b.decls));
    assert.ok(etiqueta, `${id}: la etiqueta no se separa del campo`);
  }
});
