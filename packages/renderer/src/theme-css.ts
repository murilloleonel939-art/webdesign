// Hoja de estilos del sitio publicado (Fase 2, sistema visual de Fase 6).
// Hasta la Fase 2 el renderer emitia HTML sin CSS: cualquier sitio publicado
// salia sin tema. El tema vive en el documento (`theme`), asi que el CSS se
// genera a partir de el y no hay hoja compartida que se pueda quedar desfasada.
//
// Regla de oro: los nombres de variable y de clase son contrato. El editor
// (`apps/platform/ui/panel.tsx`) reutiliza esta misma hoja y las secciones de
// `@webdesign/ui-components` dependen de cada selector de aqui. Se puede
// reescribir el valor de cada regla; renombrar un selector rompe el editor.

import type { SiteDocument } from "@webdesign/site-schema";

type Theme = SiteDocument["theme"];

// Directorio con los .ttf de las cinco direcciones, resuelto desde el propio
// modulo compilado (`dist/theme-css.js` -> `fonts/`). Lo usa `publish` para
// hardlinkear a la release solo los archivos que el tema pide: la ruta la
// conoce quien tiene las fuentes, no quien publica.
// Sin `node:url` a proposito: `apps/platform/ui/panel.tsx` importa `themeCss`
// de este mismo paquete y lo empaqueta para el navegador, donde un builtin de
// Node no resuelve. `pathname` basta porque el despliegue es Linux.
export const FONTS_DIR = decodeURIComponent(new URL("../fonts/", import.meta.url).pathname);

// Pilas del sistema, usadas como cola de respaldo detras de las fuentes
// propias y por las familias del catalogo antiguo que no tienen archivo
// (quedan documentadas mas abajo, en FAMILY_FALLBACK).
const SANS = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Cola serif. Cada pila serif termina exactamente en esta cadena.
const SERIF = 'ui-serif, Georgia, "Times New Roman", Times, serif';
// Candidatas serif reales por plataforma, antes de la cola: macOS trae Iowan
// Old Style y Palatino, Windows Palatino Linotype, Book Antiqua y Georgia,
// Linux Liberation Serif, DejaVu Serif y Noto Serif. Sin ellas, todas las serif
// caian en el mismo Times.
const BOOK_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua"';
const LINUX_SERIF = '"Liberation Serif", "DejaVu Serif", "Noto Serif"';
const CHARTER = 'Charter, "Bitstream Charter"';

// Cinco direcciones tipograficas (T-030a). Cada una trae su propio archivo en
// `packages/renderer/fonts/`, servido desde el dominio del sitio (sin
// font-src de terceros: `default-src 'self'` ya cubre /fonts/*.ttf). El
// nombre comercial de la fuente propia va primero porque @font-face la
// declara bajo ese mismo nombre; despues va una pila real del sistema por si
// el .ttf no llegase a cargar (conexion lenta, bloqueo de recursos).
//
// titular -> cuerpo:
//   editorial: Gloock -> Crimson Pro
//   clasica:   Libre Baskerville -> Instrument Sans
//   calida:    Lora -> Instrument Sans
//   moderna:   Instrument Sans -> Instrument Sans
//   rotunda:   YoungSerif -> Outfit
const HEADLINE_FAMILY: Record<string, string> = {
  editorial: `Gloock, ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  clasica: `"Libre Baskerville", ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  calida: `Lora, ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  moderna: `"Instrument Sans", ${SANS}`,
  rotunda: `"YoungSerif", ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
};
const BODY_FAMILY: Record<string, string> = {
  editorial: `"Crimson Pro", ${SERIF}`,
  clasica: `"Instrument Sans", ${SANS}`,
  calida: `"Instrument Sans", ${SANS}`,
  moderna: `"Instrument Sans", ${SANS}`,
  rotunda: `Outfit, ${SANS}`,
};
// Direcciones cuyo titular es serif: la regla de cabecera se emite antes del
// cuerpo (ver nota sobre `theme.test.mjs` mas abajo).
const DIRECTION_SERIF_HEADLINE = new Set(["editorial", "clasica", "calida", "rotunda"]);
export const TYPOGRAPHY_DIRECTIONS = new Set(Object.keys(HEADLINE_FAMILY));

// Catalogo antiguo (T-029, presets anteriores a las 5 direcciones): sin
// archivo propio, pila del sistema tal cual. Se conserva para no romper temas
// ya guardados que todavia usen estos nombres.
const FAMILY_FALLBACK: Record<string, string> = {
  Inter: `Inter, ${SANS}`,
  "Instrument Sans": `"Instrument Sans", ${SANS}`,
  "Libre Franklin": `"Libre Franklin", ${SANS}`,
  Archivo: `Archivo, ${SANS}`,
  "Space Grotesk": `"Space Grotesk", ${SANS}`,
  Nunito: `Nunito, ${SANS}`,
  // Las serif nunca bajan al cuerpo: se reservan a los titulares.
  Serif: `${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  "Source Serif 4": `"Source Serif 4", ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  Fraunces: `Fraunces, ${BOOK_SERIF}, ${CHARTER}, ${LINUX_SERIF}, ${SERIF}`,
  Merriweather: `Merriweather, ${BOOK_SERIF}, ${LINUX_SERIF}, ${SERIF}`,
  Mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

// Familias serif del catalogo antiguo. Lista explicita y no una comprobacion
// sobre el nombre: "Fraunces" y "Merriweather" no terminan en "Serif" y
// "Space Grotesk" no es una serif que se pueda deducir leyendo el texto.
const SERIF_FAMILIES = new Set(["Serif", "Source Serif 4", "Fraunces", "Merriweather"]);

function isDirection(name: string): boolean {
  return TYPOGRAPHY_DIRECTIONS.has(name);
}

function isSerif(name: string): boolean {
  if (isDirection(name)) return DIRECTION_SERIF_HEADLINE.has(name);
  return SERIF_FAMILIES.has(name);
}

// Pila de titulares: una direccion nueva resuelve a su fuente propia; el
// catalogo antiguo sigue resolviendo a su pila de sistema.
function headlineFamily(name: string): string {
  if (isDirection(name)) return HEADLINE_FAMILY[name]!;
  return FAMILY_FALLBACK[name] ?? SANS;
}

// Pila de cuerpo: una direccion nueva trae su propia fuente de cuerpo; el
// catalogo antiguo usa la misma pila que antes (sans si el titular era serif,
// si no la pila de la familia).
function bodyFamilyFor(name: string): string {
  if (isDirection(name)) return BODY_FAMILY[name]!;
  return isSerif(name) ? SANS : (FAMILY_FALLBACK[name] ?? SANS);
}

// `@font-face` de las cinco direcciones. `font-display: swap` evita el texto
// invisible mientras carga el .ttf; el origen es siempre el dominio del
// sitio (`/fonts/<archivo>.ttf`), copiado ahi por el release.
const FONT_FACES = `@font-face{font-family:"Gloock";src:url("/fonts/Gloock-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Crimson Pro";src:url("/fonts/CrimsonPro-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Crimson Pro";src:url("/fonts/CrimsonPro-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"Libre Baskerville";src:url("/fonts/LibreBaskerville-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Instrument Sans";src:url("/fonts/InstrumentSans-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Instrument Sans";src:url("/fonts/InstrumentSans-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"Lora";src:url("/fonts/Lora-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Lora";src:url("/fonts/Lora-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"YoungSerif";src:url("/fonts/YoungSerif-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Outfit";src:url("/fonts/Outfit-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Outfit";src:url("/fonts/Outfit-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap}
`;

// Archivos .ttf que sirve cada direccion (T-030b). Misma tabla que `FONT_FACES`:
// una direccion lleva el archivo de su titular y los de su cuerpo, incluido el
// Bold cuando la hoja lo declara con `font-weight:700` — si falta, el navegador
// sintetiza la negrita y la fuente pesa mas que la real. El catalogo antiguo
// (T-029) no aparece: no tiene archivo y se sirve con la pila del sistema.
const DIRECTION_FONTS: Record<string, readonly string[]> = {
  editorial: ["Gloock-Regular.ttf", "CrimsonPro-Regular.ttf", "CrimsonPro-Bold.ttf"],
  clasica: ["LibreBaskerville-Regular.ttf", "InstrumentSans-Regular.ttf", "InstrumentSans-Bold.ttf"],
  calida: ["Lora-Regular.ttf", "Lora-Bold.ttf", "InstrumentSans-Regular.ttf", "InstrumentSans-Bold.ttf"],
  moderna: ["InstrumentSans-Regular.ttf", "InstrumentSans-Bold.ttf"],
  rotunda: ["YoungSerif-Regular.ttf", "Outfit-Regular.ttf", "Outfit-Bold.ttf"],
};

/**
 * Archivos .ttf que hay que servir para este tema (T-030b).
 *
 * Lista vacia cuando el tema usa una familia del catalogo antiguo: ese sitio no
 * promete `@font-face`, asi que su release no lleva `fonts/` y sigue funcionando.
 * Es la unica fuente de verdad: `publish` no duplica la tabla.
 */
export function fontsForTheme(theme: Theme): string[] {
  const direction = theme.typography.family;
  if (!isDirection(direction)) return [];
  return [...DIRECTION_FONTS[direction]!];
}

// El radio afecta a bordes de tarjetas, campos y botones: se centraliza.
function radiusValue(radius: Theme["radius"]): string {
  if (radius === "square") return "0";
  if (radius === "pill") return "999px";
  return "12px";
}

// Escala tipografica: multiplica el tamano base sin inventar familias.
// `xlarge` lo usa el preset `bold` (0009_design_catalog.sql): sin entrada aqui
// caia a 1 y el preset mas contundente se pintaba como uno normal.
function scaleValue(scale: string): number {
  const map: Record<string, number> = { compact: 0.94, normal: 1, comfortable: 1.06, large: 1.14, xlarge: 1.24 };
  return map[scale] ?? 1;
}

export function themeCss(theme: Theme): string {
  const r = radiusValue(theme.radius);
  const s = scaleValue(theme.typography.scale);
  // Margenes y separacion vienen del documento y estan acotados por el esquema.
  const margin = theme.spacing.margin;
  const gap = theme.spacing.sectionGap;
  const direction = theme.typography.family;
  const serifHeadings = isSerif(direction);
  const headlineStack = headlineFamily(direction);
  const bodyFamily = bodyFamilyFor(direction);
  // Cuando el preset empareja serif + sans, la regla de titulares se emite
  // ANTES del cuerpo. No es capricho: `theme.test.mjs` decide si una familia es
  // serif leyendo la PRIMERA declaracion `font-family:` de la hoja.
  const headline = serifHeadings ? `h1,h2,h3,blockquote{font-family:${headlineStack}}\n` : "";
  // Las cinco direcciones nuevas traen sus .ttf: el @font-face solo se emite
  // cuando el tema usa una de ellas. El catalogo antiguo (T-029) no tiene
  // archivo propio y sigue prometiendo solo su pila de sistema: emitirle un
  // @font-face sin fuente servida repetiria el fallo de `document.fonts` vacio.
  const faces = isDirection(direction) ? FONT_FACES : "";
  return `${faces}:root{

--ground:${theme.colors.ground};
--ink:${theme.colors.ink};
--accent:${theme.colors.accent};
--radius:${r};
--margin:${margin}px;
--gap:${gap}px;
}
*{box-sizing:border-box}
${headline}body{margin:0;background:var(--ground);color:var(--ink);font-family:${bodyFamily};font-size:calc(16px * ${s});line-height:1.6;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
/* Escala de display: el titular manda y el resto acompana. Con clamp() el
   tamano deja de depender del ancho de escritorio y el movil no se rompe. */
h1,h2,h3{line-height:1.1;margin:0 0 .5em;text-wrap:balance}
h1{font-size:calc(clamp(2.4rem,4.6vw,3.6rem) * ${s});letter-spacing:-.03em;font-weight:800}
h2{font-size:calc(clamp(1.8rem,3.4vw,2.8rem) * ${s});letter-spacing:-.025em;font-weight:750}
h3{font-size:calc(1.2rem * ${s});letter-spacing:-.01em;font-weight:700}
p{margin:0 0 1em;max-width:68ch;text-wrap:pretty}
a{color:var(--accent);text-decoration-thickness:.08em;text-underline-offset:.15em}
img{max-width:100%;height:auto}
/* Foco visible en todo el sitio: quien navega con teclado necesita saber
   donde esta. Es una regla, no un detalle de un boton concreto. */
a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}
section{padding:var(--gap) var(--margin);max-width:1140px;margin-inline:auto}

/* Dos escalones de ritmo. Antes las ocho secciones compartian el mismo
   \`padding\` y la pagina se apilaba con un unico tempo durante 4300 px: ni un
   respiro corto, ni una seccion a sangre, nada que marcase el compas. Las
   secciones de contenido respiran al doble y las de servicio a la mitad. */
.features,.gallery,.pricing{padding-block:calc(var(--gap) * 1.5)}
.faq,.contact{padding-block:calc(var(--gap) * .7)}

/* Etiqueta de seccion: el hilo conductor del ritmo editorial. */
.section-eyebrow{display:block;text-transform:uppercase;letter-spacing:.18em;font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:.9rem}
/* Abridor de seccion. El esquema del sitio no tiene campo de etiqueta y aqui no
   se inventa copy, asi que el eyebrow se dibuja: una raya de acento del mismo
   ancho en las nueve secciones que abren con titular. Es el recurso que
   sustituye al h2 pelado que arrancaba cada bloque a peso igual. */
section[data-section-id]>h2::before{content:"";display:block;width:clamp(28px,4vw,44px);height:.22rem;margin:0 0 1.1rem;border-radius:min(2px,var(--radius));background:var(--accent)}
.cta-block>h2::before{margin-inline:auto;background:var(--ground)}

/* Cta pinta un <a class="cta">, no un enlace dentro de .cta: el selector
   .cta a nunca casaba y los botones salian como enlace subrayado. Se conserva
   la forma antigua por si algun preset envuelve el boton. */
.btn,.cta a,.cta,button[type=submit]{display:inline-flex;align-items:center;gap:.6em;background:var(--accent);color:var(--ground);padding:.85em 1.5em;border:0;border-radius:var(--radius);font:inherit;font-weight:650;letter-spacing:-.01em;text-decoration:none;cursor:pointer;transition:transform 160ms ease,opacity 160ms ease}
.btn:hover,.cta a:hover,.cta:hover,button[type=submit]:hover{transform:translateY(-1px);opacity:.92}
/* La flecha es la pista de que aquello se pulsa. content y no un icono: la
   CSP no admite data: y no se sirven imagenes decorativas. */
.cta a::after,.cta::after{content:"\\2192";font-weight:400;transition:transform 160ms ease}
.cta a:hover::after,.cta:hover::after{transform:translateX(3px)}
` + themeLayoutCss(theme);
}

// ---------------------------------------------------------------------------
// Maquetacion de secciones. Se mantiene aparte para que el bloque de arriba
// quede legible; \`themeCss\` (unico export que usan el renderer y el editor)
// concatena esta parte al final.
// ---------------------------------------------------------------------------
function themeLayoutCss(theme: Theme): string {
  const s = scaleValue(theme.typography.scale);
  return `/* Hero: se compone con los tokens del tema, sin imagenes. Con foto manda la
   foto; sin foto manda la tipografia y el acento dibuja el resto (ver
   \`.hero--graphic\`). */
.hero{position:relative;min-height:78vh;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;gap:0;padding-top:calc(var(--gap) * 1.6);padding-bottom:calc(var(--gap) * 1.2);background-color:var(--ground)}
.hero > *{position:relative;z-index:10}
.hero h1{font-size:calc(clamp(2.6rem,4.4vw,4rem) * ${s});letter-spacing:-.03em;line-height:1.02;font-weight:800;max-width:24ch;margin-bottom:.3em}
.hero p{font-size:calc(1.25rem * ${s});opacity:.75;max-width:52ch;margin-bottom:0}
.hero .cta,.cta-block .cta{margin-top:2.2rem}
.hero--center{text-align:center;align-items:center}
.hero--center h1,.hero--center p{margin-inline:auto}
/* Si el hero lleva imagen, el texto manda y la foto acompana: 1.4 contra .6.
   Con \`1.1fr .9fr\` el titular se quedaba en 548 px y un titular de 54
   caracteres rompia en cinco lineas de dos palabras. La foto baja de 448 a
   ~300 px y el titular baja a tres lineas. */
.hero--image{display:grid;grid-template-columns:1.4fr .6fr;align-items:center;gap:calc(var(--gap) * .5)}
/* El radio del preset es para botones y tarjetas, no para la fotografia: con
   \`pill\` el hero medía border-radius:1009px y la foto salia como un huevo. */
.hero img{width:100%;height:auto;border-radius:min(12px,var(--radius));box-shadow:0 30px 60px -30px color-mix(in srgb,var(--ink) 45%,transparent);object-fit:cover}
.hero--full{min-height:92vh}

/* Hero SIN foto. El defecto no era el fondo liso: era que un titular suelto
   sobre un lienzo vacio se lee como pagina a medias. La respuesta es una
   composicion de pliego, no un adorno: reticula de filetes que ordena, barra
   de acento que abre el texto y un circulo grande recortado por el borde.
   Todo sale de --accent, --ink y --ground: ni un color nuevo, ni una imagen,
   ni un SVG. Los filetes de la reticula van al 12 % de tinta y el velo del
   circulo al 12 % de acento, sobre el fondo del tema: el par titular/fondo no
   cambia y el contraste AA que ya cumple el preset se mantiene intacto. */
.hero--graphic{min-height:82vh;overflow:hidden}
.hero--graphic::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background-image:repeating-linear-gradient(90deg,color-mix(in srgb,var(--ink) 12%,transparent) 0 1px,transparent 1px 25%)}
/* El circulo es el unico gesto grande: media luna hundida en la esquina
   inferior derecha, comida por el borde. Su arco pasa por el aire que queda
   bajo el titular; cuando un titular muy largo llega hasta ahi, el velo del
   12 % lo deja legible y la superposicion se lee como portada, no como error. */
.hero--graphic::after{content:"";position:absolute;z-index:0;pointer-events:none;bottom:-22%;right:calc(var(--margin) * -.45);width:min(62vw,560px);aspect-ratio:1;border-radius:50%;border:1px solid color-mix(in srgb,var(--accent) 60%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
/* La barra de acento abre el bloque de texto: un gesto de portada impresa que
   no depende de ninguna foto y que respeta el radio del preset. */
.hero--graphic > div::before{content:"";display:block;width:clamp(56px,8vw,112px);height:.55rem;margin-bottom:1.4rem;border-radius:min(var(--radius),3px);background:var(--accent)}
.hero--graphic h1{font-size:calc(clamp(2.7rem,6.6vw,5.6rem) * ${s});max-width:17ch}
.hero--graphic.hero--center > div::before{margin-inline:auto}
/* Centrado: el circulo se sube al borde superior, detras del aire, y el texto
   respira debajo. Nunca queda debajo del titular, que es lo que bajaria el
   contraste. */
.hero--graphic.hero--center::after{top:-40%;bottom:auto;right:auto;left:50%;transform:translateX(-50%);width:min(72vw,460px)}

/* Ventajas en bento: seis columnas, la primera pieza ocupa cuatro y el resto
   dos. No es una rejilla uniforme de tarjetas iguales, que es el tic que hace
   que todos los sitios parezcan el mismo.
   El adorno se acota con \`:not(.features--steps)\` a proposito: antes
   \`.features li:nth-child(6n+2)::before\` (especificidad 0,2,2) ganaba a
   \`.features--steps li::before\` (0,1,2) y los pasos 02 y 03 se pintaban como un
   circulo y un cuadrado en vez de numerarse. */
.features ul,.features>ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,1fr);gap:calc(var(--gap) * .3)}
.features li{grid-column:span 2;position:relative;display:flex;flex-direction:column;padding:1.7rem;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:min(12px,var(--radius));background:color-mix(in srgb,var(--ink) 3%,var(--ground));transition:transform 180ms ease,opacity 180ms ease}
.features:not(.features--steps) li:first-child{grid-column:span 4;grid-row:span 2;justify-content:flex-end;padding:2.2rem;background:color-mix(in srgb,var(--accent) 10%,var(--ground));border-color:color-mix(in srgb,var(--accent) 32%,transparent)}
.features:not(.features--steps) li:first-child h3{font-size:calc(1.7rem * ${s})}
.features li:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
/* Icono dibujado con CSS: cuadro redondeado tintado y un glifo por tarjeta.
   Ni SVG en linea ni data URI: la CSP solo permite self y https:. */
.features:not(.features--steps) li::before{content:"\\25C6";display:grid;place-items:center;width:44px;height:44px;margin-bottom:1.1rem;border-radius:14px;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-size:1.05rem;line-height:1}
.features:not(.features--steps) li:nth-child(6n+2)::before{content:"\\25CF";border-radius:50%}
.features:not(.features--steps) li:nth-child(6n+3)::before{content:"\\25A0";border-radius:8px}
.features:not(.features--steps) li:nth-child(6n+4)::before{content:"\\25B2";border-radius:6px}
.features:not(.features--steps) li:nth-child(6n+5)::before{content:"\\25C7";border-radius:14px}
.features:not(.features--steps) li:nth-child(6n+6)::before{content:"\\25CB";border-radius:50%}
.features h3{font-size:calc(1.15rem * ${s});margin-bottom:.45em}
.features p{margin:0;opacity:.78;font-size:.95em;max-width:46ch}

/* Pasos numerados: el mismo componente con la clase features--steps cuando el
   id de la seccion dice que es un proceso. Los numeros son texto de CSS, no
   HTML: asi el lector de pantalla no lee "01" antes de cada titular. */
.features--steps ul{counter-reset:step;grid-template-columns:repeat(3,1fr);gap:calc(var(--gap) * .34)}
/* Reset completo: sin \`grid-column\` heredado, sin fondo de tarjeta y sin radio
   de 999px, que con \`pill\` dibujaba un arco suelto encima de cada paso. */
.features--steps li{grid-column:auto;grid-row:auto;counter-increment:step;border:0;border-top:1px solid color-mix(in srgb,var(--ink) 18%,transparent);border-radius:0;background:none;padding:1.2rem 0 0}
.features--steps li::before{content:counter(step,decimal-leading-zero);display:block;width:auto;height:auto;background:none;background-image:linear-gradient(120deg,var(--accent),color-mix(in srgb,var(--accent) 45%,var(--ink)));-webkit-background-clip:text;background-clip:text;color:transparent;border-radius:0;place-items:initial;margin-bottom:.6rem;font-size:calc(2.6rem * ${s});font-weight:800;letter-spacing:-.04em;line-height:1}
.features--steps li:hover{transform:none;border-color:color-mix(in srgb,var(--accent) 60%,transparent);border-radius:0}
.features--steps h3{font-size:calc(1.25rem * ${s})}

/* Precios: las tarjetas se igualan en alto y el precio manda. */
.pricing{display:grid;gap:calc(var(--gap) * .42);grid-template-columns:repeat(auto-fit,minmax(250px,1fr));align-items:stretch}
.pricing__plan{display:flex;flex-direction:column;padding:1.9rem;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:min(12px,var(--radius));background:var(--ground)}
.pricing__plan h3{font-size:calc(1.05rem * ${s});text-transform:uppercase;letter-spacing:.08em;opacity:.7;margin-bottom:.6em}
.pricing__price{font-size:calc(2.4rem * ${s});font-weight:700;line-height:1;margin:0 0 1.2em}
.pricing__plan ul{list-style:none;margin:0;padding:0;display:grid;gap:.55em;font-size:.95em}
.pricing__plan li{padding-left:1.5em;position:relative}
.pricing__plan li::before{content:"";position:absolute;left:0;top:.55em;width:.5em;height:.5em;border-radius:50%;background:var(--accent)}
.pricing__plan--featured{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--ground))}
.pricing__plan--featured h3{opacity:1;color:var(--accent)}

/* Testimonios (T-025): tarjetas de cita con nombre y rol, sin foto. Todo sale
   de --ink, --accent y --ground: ningun color propio. */
.testimonials{padding-block:calc(var(--gap) * 1.2)}
.testimonials ul{list-style:none;margin:0;padding:0;display:grid;gap:calc(var(--gap) * .3);grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.testimonials li{display:flex;padding:1.7rem;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:min(12px,var(--radius));background:color-mix(in srgb,var(--ink) 3%,var(--ground))}
.testimonials figure{margin:0;display:flex;flex-direction:column;justify-content:space-between;gap:1.2rem}
.testimonials blockquote{margin:0;font-size:calc(1.08rem * ${s});line-height:1.55}
.testimonials blockquote::before{content:"\\201C";display:block;color:var(--accent);font-size:2.4em;line-height:.6;margin-bottom:.2em}
.testimonials figcaption{display:grid;gap:.15rem;font-size:.92em}
.testimonials__name{font-weight:700}
.testimonials__role{opacity:.65}

/* Cifras (T-025): la cifra manda y la etiqueta va debajo. \`dt\` va antes en
   el marcado para que el lector de pantalla lea etiqueta y valor en orden. */
.metrics{padding-block:calc(var(--gap) * .9)}
.metrics dl{margin:0;display:grid;gap:calc(var(--gap) * .3);grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.metrics__item{display:flex;flex-direction:column-reverse;gap:.35rem;padding-top:1rem;border-top:2px solid var(--accent)}
.metrics dd{margin:0;font-size:calc(2.6rem * ${s});font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--accent)}
.metrics dt{font-size:.95em;opacity:.75}

/* Galeria: rejilla uniforme, sin huecos ni saltos de alto. El radio de la
   foto no es el del boton: con \`pill\` cada imagen de 333x250 salia como una
   elipse y perdia las esquinas de un original cuadrado. */
.gallery{display:grid;gap:calc(var(--gap) * .22);grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.gallery img{width:100%;height:100%;object-fit:cover;border-radius:min(12px,var(--radius));display:block;aspect-ratio:4/3}
.gallery--masonry img{aspect-ratio:3/4}
.gallery--wide{grid-template-columns:1fr}
.gallery--wide img{aspect-ratio:21/9}

/* Imagen suelta: centrada y acotada, nunca a tamaño natural. object-fit no
   hace nada sin dimensiones: sin esto la imagen salia a tamano natural
   (1280 px) y desbordaba el ancho de lectura. */
.image img{width:100%;height:auto;max-width:100%;border-radius:min(12px,var(--radius));display:block;margin-inline:auto;max-height:70vh;object-fit:cover}

/* Texto largo: columna legible y, en escritorio, titular fijo a la izquierda
   con el cuerpo a la derecha, como una pagina "sobre nosotros" editorial.
   La seccion conserva los 1140 px del resto de la pagina: antes esta era la
   unica de 1440 y su columna derecha no casaba con ninguna otra. */
.text:has(h2){display:grid;grid-template-columns:.8fr 1.2fr;gap:calc(var(--gap) * .6)}
.text:has(h2) h2{position:sticky;top:calc(var(--gap) * .5);align-self:start;max-width:16ch}
.text:has(h2) p{max-width:62ch}

/* Testimonio: cita destacada con su fuente. La medida se acota en la cita, no
   en la seccion: \`section{margin-inline:auto}\` centraba el bloque y lo sacaba
   131 px a la derecha de la retícula que siguen las demas secciones. */
.testimonial blockquote{margin:0 0 1rem;padding-left:1.4rem;border-left:3px solid var(--accent);font-size:calc(1.35rem * ${s});line-height:1.45;max-width:68ch}
.testimonial blockquote p{margin:0;max-width:none}
.testimonial cite{font-style:normal;font-size:.9em;opacity:.65;display:block;max-width:68ch}

/* Preguntas: acordeon nativo, sin JS. El "+" gira a "–" con el propio atributo
   [open]: no hace falta transicion de layout para notar el cambio. */
.faq details{border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent);padding:1.05rem 0;max-width:70ch}
.faq summary{cursor:pointer;font-weight:650;font-size:calc(1.1rem * ${s});list-style:none;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-weight:400;opacity:.6;font-size:1.3em;transition:transform 160ms ease}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{margin:.8em 0 0;opacity:.78;max-width:none}

/* Cierre. Antes era un bloque negro con degradado violeta a cian y boton ambar
   escritos a mano (\`#0b0b14\`, \`#7c3aed\`, \`#06b6d4\`, \`#f5a524\`): no dependian
   del tema, asi que los ocho presets terminaban identicos justo en el bloque
   que la gente recuerda. Ahora es la tinta del preset con el acento del preset,
   y cierra a sangre en vez de flotar con 150 px de fondo a los lados. */
.cta-block{position:relative;overflow:hidden;text-align:center;max-width:none;margin-inline:0;padding-top:calc(var(--gap) * 1.3);padding-bottom:calc(var(--gap) * 1.3);padding-inline:max(var(--margin),calc((100% - 1140px) / 2));background:var(--ink);color:var(--ground);border-radius:0}
.cta-block h2{max-width:22ch;margin-inline:auto;color:var(--ground);font-size:calc(clamp(2rem,4.4vw,3.4rem) * ${s})}
.cta-block .cta,.cta-block .cta a{background:var(--accent);color:var(--ground)}

.contact{text-align:left}
/* Un solo camino para escribir: el formulario. Antes convivian "Enviar" y un
   segundo CTA "Escribir" a 60 px, ninguno de los dos alineado con el form. */
.contact>a{display:inline-flex;align-items:center;gap:.5em;margin:0 .6rem 1rem 0;padding:.7em 1.2em;border:1px solid color-mix(in srgb,var(--ink) 20%,transparent);border-radius:min(10px,var(--radius));text-decoration:none;font-weight:600}

/* Formulario. No habia ni una regla para el: \`.lead-form\` calculaba
   \`display:block\` y los campos salian con el borde nativo del navegador, a
   Arial 13.33 px (el textarea a monospace) dentro de un cuerpo de 18.24 px.
   Rejilla de dos columnas, el mensaje a todo el ancho, y un unico boton. */
.lead-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.15rem 1.5rem;align-items:start;max-width:46rem;margin-inline:auto;text-align:left}
.lead-form .field{display:grid;gap:.45rem;min-width:0}
.lead-form .field:last-of-type{grid-column:1/-1}
.lead-form label{display:block;font-size:.88rem;font-weight:600;letter-spacing:.01em;opacity:.8}
.lead-form input,.lead-form textarea{font:inherit;width:100%;padding:.72rem .9rem;background:var(--ground);color:var(--ink);border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:min(10px,var(--radius))}
.lead-form input:focus,.lead-form textarea:focus{border-color:var(--accent)}
.lead-form textarea{min-height:8.5rem;resize:vertical}
.lead-form .consent{grid-column:1/-1;display:flex;align-items:flex-start;gap:.6rem;font-size:.92em;opacity:.85;font-weight:400}
.lead-form input[type=checkbox]{width:auto;padding:0;border:0;accent-color:var(--accent);flex:none;margin-top:.25em}
.lead-form button[type=submit]{grid-column:1/-1;justify-self:start}

/* Barra de navegacion entre paginas (T-003.1): solo aparece cuando el sitio
   tiene mas de una pagina. Fila horizontal con separacion inferior, enlaces con
   el color de tinta del tema para no competir con el acento, y el enlace de la
   pagina actual en negrita. flex-wrap evita el desbordamiento en movil. */
.site-nav{display:flex;flex-wrap:wrap;gap:.3rem 1.4rem;padding:calc(var(--gap) * .35) var(--margin);border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent);max-width:1140px;margin-inline:auto;margin-bottom:0}
.site-nav a{color:inherit;text-decoration:none;font-size:.93rem;font-weight:500;opacity:.72;padding:.25em 0}
.site-nav a:hover{opacity:1}
.site-nav a[aria-current="page"]{font-weight:700;opacity:1;text-decoration:underline;text-underline-offset:.2em}

/* Pie: cierra con la tinta del tema y las mismas columnas. Antes eran dos
   reglas peleandose (\`margin-top\` y luego \`margin-inline:auto\`), el negro
   estaba escrito a mano y la banda medía 1140 px con 150 px de fondo a cada
   lado, con esquinas rectas justo debajo de un cierre redondeado. */
.site-footer{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:calc(var(--gap) * .4);max-width:none;margin-inline:0;padding-block:calc(var(--gap) * .6);padding-inline:max(var(--margin),calc((100% - 1140px) / 2));background:var(--ink);color:color-mix(in srgb,var(--ground) 82%,var(--ink))}
.site-footer a{color:inherit;text-decoration-color:currentColor}
.site-footer p{margin:0;opacity:.75;max-width:40ch}
.site-footer__brand{font-weight:700;font-size:1.1rem;color:var(--ground)}

@media (prefers-reduced-motion:reduce){*{transition-duration:0.001ms !important;animation-duration:0.001ms !important}.features li:hover,.cta a:hover::after,.cta:hover::after,.btn:hover{transform:none}}

@media (max-width:719px){
.features ul,.features>ul{grid-template-columns:1fr}
.features li,.features:not(.features--steps) li:first-child{grid-column:span 1;grid-row:span 1}
.features--steps ul{grid-template-columns:1fr}
.hero--image{grid-template-columns:1fr}
/* Hero grafico en movil: el titular mantiene el tamano de cartel y la reticula
   de cuartos se conserva, que en 390 px son cuatro lineas y no una trama. */
.hero--graphic{min-height:76vh;padding-top:calc(var(--gap) * 1.2);padding-bottom:calc(var(--gap) * 1.9)}
/* En un movil no hay hueco al lado del titular: el circulo baja y se convierte
   en el arco que cierra la portada por abajo, donde solo hay aire. */
.hero--graphic::after{width:min(88vw,380px);top:auto;bottom:-44%;right:calc(var(--margin) * -.5)}
.hero--graphic h1{font-size:calc(clamp(2.2rem,9.4vw,3.4rem) * ${s})}
.hero--graphic.hero--center::after{width:min(88vw,380px);top:auto;bottom:-44%;left:50%}
.text:has(h2){grid-template-columns:1fr}
.text:has(h2) h2{position:static}
.lead-form{grid-template-columns:1fr}
.site-footer{grid-template-columns:1fr}
/* Las dos bandas de cierre conservan el padding-inline del escritorio (con su
   max() sobre 1140 px) si no se recalculan aqui. */
.cta-block,.site-footer{padding-inline:calc(var(--margin) * .6)}
section{padding:calc(var(--gap) * .6) calc(var(--margin) * .6)}
/* Un solo tamaño de h1 en movil: antes \`h1{1.9rem}\` y \`.hero h1{2.1rem}\`
   competian por el mismo titular y el segundo ganaba siempre. */
.hero h1{font-size:calc(clamp(1.95rem,8.2vw,2.55rem) * ${s})}
}
`;
}
