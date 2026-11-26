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

// Solo pilas del sistema: la CSP del sitio no permite fuentes externas y
// cargar Google Fonts revelaria el sitio del cliente a un tercero. La familia
// elegida va primera por si el dueno la tiene instalada; si no, cae a la pila
// del sistema sin dejar el texto sin tipografia.
const SANS = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, Georgia, "Times New Roman", Times, serif';

const FAMILY_FALLBACK: Record<string, string> = {
  Inter: `Inter, ${SANS}`,
  "Instrument Sans": `"Instrument Sans", ${SANS}`,
  "Libre Franklin": `"Libre Franklin", ${SANS}`,
  Archivo: `Archivo, ${SANS}`,
  "Space Grotesk": `"Space Grotesk", ${SANS}`,
  Nunito: `Nunito, ${SANS}`,
  // Las serif nunca bajan al cuerpo: se reservan a los titulares.
  Serif: `"Iowan Old Style", Palatino, ${SERIF}`,
  "Source Serif 4": `"Source Serif 4", Charter, ${SERIF}`,
  Fraunces: `Fraunces, "Hoefler Text", ${SERIF}`,
  Merriweather: `Merriweather, Charter, ${SERIF}`,
  Mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

function isSerif(name: string): boolean {
  // Las claves de FAMILY_FALLBACK cuya pila usa una serif del sistema
  // (`SERIF`): el nombre comercial no siempre termina en "Serif"
  // ("Fraunces", "Merriweather"), asi que no sirve una regexp sobre el nombre.
  return FAMILY_FALLBACK[name]?.includes(SERIF) ?? false;
}

function family(name: string): string {
  return FAMILY_FALLBACK[name] ?? SANS;
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
  const serifHeadings = isSerif(theme.typography.family);
  const serifStack = family(theme.typography.family);
  const bodyFamily = serifHeadings ? SANS : serifStack;
  // Cuando el preset empareja serif + sans, la regla de titulares se emite
  // ANTES del cuerpo. No es capricho: `theme.test.mjs` decide si una familia es
  // serif leyendo la PRIMERA declaracion `font-family:` de la hoja.
  const headline = serifHeadings ? `h1,h2,h3,blockquote{font-family:${serifStack}}\n` : "";
  return `:root{
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

/* Etiqueta de seccion: el hilo conductor del ritmo editorial. */
.section-eyebrow{display:block;text-transform:uppercase;letter-spacing:.18em;font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:.9rem}
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
// quede legible; `themeCss` (unico export que usan el renderer y el editor)
// concatena esta parte al final.
// ---------------------------------------------------------------------------
function themeLayoutCss(theme: Theme): string {
  const s = scaleValue(theme.typography.scale);
  return `/* Hero: se compone con los tokens del tema, sin imagenes. Con foto manda la
   foto; sin foto manda la tipografia y el acento dibuja el resto (ver
   \`.hero--graphic\`). */
.hero{position:relative;min-height:78vh;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-start;gap:0;padding-top:calc(var(--gap) * 1.6);padding-bottom:calc(var(--gap) * 1.2);background-color:var(--ground)}
.hero > *{position:relative;z-index:10}
.hero h1{font-size:calc(clamp(2.6rem,6vw,5.2rem) * ${s});letter-spacing:-.035em;line-height:1.02;font-weight:800;max-width:18ch;margin-bottom:.3em}
.hero p{font-size:calc(1.25rem * ${s});opacity:.75;max-width:52ch;margin-bottom:0}
.hero .cta,.cta-block .cta{margin-top:2.2rem}
.hero--center{text-align:center;align-items:center}
.hero--center h1,.hero--center p{margin-inline:auto}
/* Si el hero lleva imagen, el texto se queda a la izquierda y la imagen
   respira a la derecha. */
.hero--image{display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:calc(var(--gap) * .5)}
.hero img{width:100%;height:auto;border-radius:calc(var(--radius) + 10px);box-shadow:0 30px 60px -30px color-mix(in srgb,var(--ink) 45%,transparent);object-fit:cover}
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
   que todos los sitios parezcan el mismo. */
.features ul,.features>ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,1fr);gap:calc(var(--gap) * .3)}
.features li{grid-column:span 2;position:relative;display:flex;flex-direction:column;padding:1.7rem;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:var(--radius);background:color-mix(in srgb,var(--ink) 3%,var(--ground));transition:transform 180ms ease,opacity 180ms ease}
.features li:first-child{grid-column:span 4;grid-row:span 2;justify-content:flex-end;padding:2.2rem;background:color-mix(in srgb,var(--accent) 10%,var(--ground));border-color:color-mix(in srgb,var(--accent) 32%,transparent)}
.features li:first-child h3{font-size:calc(1.7rem * ${s})}
.features li:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
/* Icono dibujado con CSS: cuadro redondeado tintado y un glifo por tarjeta.
   Ni SVG en linea ni data URI: la CSP solo permite self y https:. */
.features li::before{content:"\\25C6";display:grid;place-items:center;width:44px;height:44px;margin-bottom:1.1rem;border-radius:14px;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-size:1.05rem;line-height:1}
.features li:nth-child(6n+2)::before{content:"\\25CF";border-radius:50%}
.features li:nth-child(6n+3)::before{content:"\\25A0";border-radius:8px}
.features li:nth-child(6n+4)::before{content:"\\25B2";border-radius:6px}
.features li:nth-child(6n+5)::before{content:"\\25C7";border-radius:14px}
.features li:nth-child(6n+6)::before{content:"\\25CB";border-radius:50%}
.features h3{font-size:calc(1.15rem * ${s});margin-bottom:.45em}
.features p{margin:0;opacity:.78;font-size:.95em;max-width:46ch}

/* Pasos numerados: el mismo componente con la clase features--steps cuando el
   id de la seccion dice que es un proceso. Los numeros son texto de CSS, no
   HTML: asi el lector de pantalla no lee "01" antes de cada titular. */
.features--steps ul{counter-reset:step;grid-template-columns:repeat(3,1fr);gap:calc(var(--gap) * .34)}
.features--steps li{grid-column:auto;grid-row:auto;counter-increment:step;border:0;background:none;padding:0;padding-top:1.2rem;border-top:1px solid color-mix(in srgb,var(--ink) 18%,transparent)}
.features--steps li::before{content:counter(step,decimal-leading-zero);width:auto;height:auto;background:none;border-radius:0;place-items:start;margin-bottom:.6rem;font-size:calc(2.6rem * ${s});font-weight:800;letter-spacing:-.04em;line-height:1;background-image:linear-gradient(120deg,var(--accent),color-mix(in srgb,var(--accent) 45%,var(--ink)));-webkit-background-clip:text;background-clip:text;color:transparent}
.features--steps li:hover{transform:none;border-color:color-mix(in srgb,var(--accent) 60%,transparent)}
.features--steps h3{font-size:calc(1.25rem * ${s})}

/* Precios: las tarjetas se igualan en alto y el precio manda. */
.pricing{display:grid;gap:calc(var(--gap) * .42);grid-template-columns:repeat(auto-fit,minmax(250px,1fr));align-items:stretch}
.pricing__plan{display:flex;flex-direction:column;padding:1.9rem;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:var(--radius);background:var(--ground)}
.pricing__plan h3{font-size:calc(1.05rem * ${s});text-transform:uppercase;letter-spacing:.08em;opacity:.7;margin-bottom:.6em}
.pricing__price{font-size:calc(2.4rem * ${s});font-weight:700;line-height:1;margin:0 0 1.2em}
.pricing__plan ul{list-style:none;margin:0;padding:0;display:grid;gap:.55em;font-size:.95em}
.pricing__plan li{padding-left:1.5em;position:relative}
.pricing__plan li::before{content:"";position:absolute;left:0;top:.55em;width:.5em;height:.5em;border-radius:50%;background:var(--accent)}

/* Galeria: rejilla uniforme, sin huecos ni saltos de alto. */
.gallery{display:grid;gap:calc(var(--gap) * .22);grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.gallery img{width:100%;height:100%;object-fit:cover;border-radius:var(--radius);display:block;aspect-ratio:4/3}
.gallery--masonry img{aspect-ratio:3/4}
.gallery--wide{grid-template-columns:1fr}
.gallery--wide img{aspect-ratio:21/9}

/* Imagen suelta: centrada y acotada, nunca a tamaño natural. object-fit no
   hace nada sin dimensiones: sin esto la imagen salia a tamano natural
   (1280 px) y desbordaba el ancho de lectura. */
.image img{width:100%;height:auto;max-width:100%;border-radius:var(--radius);display:block;margin-inline:auto;max-height:70vh;object-fit:cover}

/* Texto largo: columna legible y, en escritorio, titular fijo a la izquierda
   con el cuerpo a la derecha, como una pagina "sobre nosotros" editorial. */
.text{max-width:70ch}
.text:has(h2){max-width:none;display:grid;grid-template-columns:.8fr 1.2fr;gap:calc(var(--gap) * .6)}
.text:has(h2) h2{position:sticky;top:calc(var(--gap) * .5);align-self:start;max-width:16ch}
.text:has(h2) p{max-width:62ch}

/* Testimonio: cita destacada con su fuente. */
.testimonial{max-width:70ch}
.testimonial blockquote{margin:0 0 1rem;padding-left:1.4rem;border-left:3px solid var(--accent);font-size:calc(1.35rem * ${s});line-height:1.45}
.testimonial blockquote p{margin:0;max-width:none}
.testimonial cite{font-style:normal;font-size:.9em;opacity:.65}

/* Preguntas: acordeon nativo, sin JS. El "+" gira a "–" con el propio atributo
   [open]: no hace falta transicion de layout para notar el cambio. */
.faq{max-width:70ch}
.faq details{border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent);padding:1.05rem 0}
.faq summary{cursor:pointer;font-weight:650;font-size:calc(1.1rem * ${s});list-style:none;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-weight:400;opacity:.6;font-size:1.3em;transition:transform 160ms ease}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{margin:.8em 0 0;opacity:.78;max-width:none}

/* Cierre: fondo oscuro propio con degradado violeta a cian (B6), deliberado y
   de la paleta del cierre, no del tema claro del resto del sitio. */
.cta-block{position:relative;overflow:hidden;text-align:center;padding-top:calc(var(--gap) * 1.3);padding-bottom:calc(var(--gap) * 1.3);background-color:#0b0b14;background-image:radial-gradient(70% 90% at 20% 15%,#7c3aed66,transparent 60%),radial-gradient(70% 90% at 85% 85%,#06b6d466,transparent 60%);border-radius:var(--radius)}
.cta-block h2{max-width:22ch;margin-inline:auto;color:#f5f5f7;font-size:calc(clamp(2rem,4.4vw,3.4rem) * ${s})}
.cta-block .cta,.cta-block .cta a{background:#f5a524;color:#0b0b14}

.contact{text-align:center}
.contact .lead-form{margin-inline:auto;text-align:left}
.contact > a{display:inline-flex;align-items:center;gap:.5em;margin:0 .6rem 1rem;padding:.7em 1.2em;border:1px solid color-mix(in srgb,var(--ink) 20%,transparent);border-radius:var(--radius);text-decoration:none;font-weight:600}

/* Barra de navegacion entre paginas (T-003.1): solo aparece cuando el sitio
   tiene mas de una pagina. Fila horizontal con separacion inferior, enlaces con
   el color de tinta del tema para no competir con el acento, y el enlace de la
   pagina actual en negrita. flex-wrap evita el desbordamiento en movil. */
.site-nav{display:flex;flex-wrap:wrap;gap:.3rem 1.4rem;padding:calc(var(--gap) * .35) var(--margin);border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent);max-width:1140px;margin-inline:auto;margin-bottom:0}
.site-nav a{color:inherit;text-decoration:none;font-size:.93rem;font-weight:500;opacity:.72;padding:.25em 0}
.site-nav a:hover{opacity:1}
.site-nav a[aria-current="page"]{font-weight:700;opacity:1;text-decoration:underline;text-underline-offset:.2em}

/* Pie: siempre oscuro respecto al tema, con columnas y el enlace de vuelta al
   contacto. Vive en una clase propia porque el renderer lo anade fuera de las
   secciones del documento. */
.site-footer{background:#0b0b14;color:#f5f5f7cc;padding:calc(var(--gap) * .6) var(--margin);margin-top:calc(var(--gap) * .5)}
.site-footer{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:calc(var(--gap) * .4);max-width:1140px;margin-inline:auto}
.site-footer a{color:inherit;text-decoration-color:currentColor}
.site-footer p{margin:0;opacity:.75;max-width:40ch}
.site-footer__brand{font-weight:700;font-size:1.1rem;color:#f5f5f7}

@media (prefers-reduced-motion:reduce){*{transition-duration:0.001ms !important;animation-duration:0.001ms !important}.features li:hover,.cta a:hover::after,.cta:hover::after,.btn:hover{transform:none}}

@media (max-width:719px){
.features ul,.features>ul{grid-template-columns:1fr}
.features li,.features li:first-child{grid-column:span 1;grid-row:span 1}
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
.site-footer{grid-template-columns:1fr}
section{padding:calc(var(--gap) * .6) calc(var(--margin) * .6)}
h1{font-size:calc(1.9rem * ${s})}
.hero h1{font-size:calc(2.1rem * ${s})}
}
`;
}
