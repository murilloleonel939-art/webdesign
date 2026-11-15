// Hoja de estilos del sitio publicado (Fase 2).
// Hasta ahora el renderer emitia HTML sin CSS: cualquier sitio publicado salia
// sin tema, sin tipografia y con el formulario de contacto a la vista sin forma.
// El tema vive en el documento (`theme`), asi que el CSS se genera a partir de
// el y no hay hoja compartida que se pueda quedar desfasada.

import type { SiteDocument } from "@webdesign/site-schema";

type Theme = SiteDocument["theme"];

const FAMILY_FALLBACK: Record<string, string> = {
  // Solo pilas del sistema: la CSP del sitio no permite fuentes externas y
  // cargar Google Fonts revelaria el sitio del cliente a un tercero.
  Inter: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "Instrument Sans": 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "Libre Franklin": 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  Archivo: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "Space Grotesk": '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  Nunito: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  Serif: 'Georgia, "Times New Roman", Times, serif',
  "Source Serif 4": 'Georgia, "Times New Roman", Times, serif',
  Fraunces: 'Georgia, "Times New Roman", Times, serif',
  Merriweather: 'Georgia, "Times New Roman", Times, serif',
  Mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

function family(name: string): string {
  return FAMILY_FALLBACK[name] ?? 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
}

// El radio afecta a bordes de tarjetas, campos y botones: se centraliza.
function radiusValue(radius: Theme["radius"]): string {
  if (radius === "square") return "0";
  if (radius === "pill") return "999px";
  return "12px";
}

// Escala tipografica: multiplica el tamano base sin inventar familias.
function scaleValue(scale: string): number {
  const map: Record<string, number> = { compact: 0.94, normal: 1, comfortable: 1.06, large: 1.14 };
  return map[scale] ?? 1;
}

export function themeCss(theme: Theme): string {
  const r = radiusValue(theme.radius);
  const s = scaleValue(theme.typography.scale);
  // Margenes y separacion vienen del documento y estan acotados por el esquema.
  const margin = theme.spacing.margin;
  const gap = theme.spacing.sectionGap;
  return `:root{
--ground:${theme.colors.ground};
--ink:${theme.colors.ink};
--accent:${theme.colors.accent};
--radius:${r};
--margin:${margin}px;
--gap:${gap}px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:${family(theme.typography.family)};font-size:calc(16px * ${s});line-height:1.6;-webkit-font-smoothing:antialiased}
section{padding:var(--gap) var(--margin)}
h1,h2,h3{line-height:1.15;margin:0 0 .5em}
h1{font-size:calc(2.6rem * ${s})}
h2{font-size:calc(1.8rem * ${s})}
p{margin:0 0 1em;max-width:68ch}
a{color:var(--accent)}
img{max-width:100%;height:auto}
.btn,.cta a,button[type=submit]{display:inline-block;background:var(--accent);color:var(--ground);padding:.7em 1.3em;border:0;border-radius:var(--radius);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn:hover,.cta a:hover,button[type=submit]:hover{filter:brightness(1.08)}
/* Formulario de contacto: sin JS y en el mismo origen. */
.lead-form{display:grid;gap:1rem;max-width:520px;margin-top:1.5rem}
.lead-form .field{display:grid;gap:.35rem}
.lead-form label{font-weight:600;font-size:.9em}
.lead-form input[type=text],.lead-form input[type=email],.lead-form input[type=tel],.lead-form textarea{width:100%;padding:.65em .75em;border:1px solid color-mix(in srgb,var(--ink) 24%,transparent);border-radius:var(--radius);background:var(--ground);color:var(--ink);font:inherit}
.lead-form input:focus-visible,.lead-form textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lead-form .consent{display:flex;gap:.55rem;align-items:flex-start;font-weight:400;font-size:.9em}
.lead-form .consent input{margin-top:.25em}
/* Maquetacion de las secciones. Sin esto el sitio publicado salia como un
documento corrido: titulos, listas y formulario uno debajo de otro, sin
columnas, sin tarjetas y sin jerarquia visual. */
section{max-width:1140px;margin-inline:auto}
.hero{padding-top:calc(var(--gap) * 1.15);padding-bottom:calc(var(--gap) * 1.15)}
.hero h1{font-size:calc(3.2rem * ${s});letter-spacing:-.02em;max-width:20ch}
.hero p{font-size:calc(1.2rem * ${s});opacity:.72;max-width:56ch}
.hero--center{text-align:center}
.hero--center h1,.hero--center p{margin-inline:auto}
.hero .cta,.cta-block .cta{margin-top:2rem}

/* Ventajas: rejilla de tarjetas que se reparte sola. */
.features ul{list-style:none;margin:0;padding:0;display:grid;gap:calc(var(--gap) * .42);grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.features li{padding:1.6rem;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:var(--radius);background:color-mix(in srgb,var(--ink) 3%,var(--ground))}
.features h3{font-size:calc(1.15rem * ${s});margin-bottom:.45em}
.features p{margin:0;opacity:.75;font-size:.95em}

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

/* Imagen suelta: centrada y acotada, nunca a tamaño natural. */
/* object-fit no hace nada sin dimensiones: la imagen salia a tamano natural
(1280 px) y desbordaba el ancho de lectura. */
.image img{width:100%;height:auto;max-width:100%;border-radius:var(--radius);display:block;margin-inline:auto;max-height:70vh;object-fit:cover}

/* Texto largo: columna legible, no renglones de 200 caracteres. */
.text{max-width:70ch}

/* Testimonio: cita destacada con su fuente. */
.testimonial{max-width:70ch}
.testimonial blockquote{margin:0 0 1rem;padding-left:1.4rem;border-left:3px solid var(--accent);font-size:calc(1.35rem * ${s});line-height:1.45}
.testimonial blockquote p{margin:0;max-width:none}
.testimonial cite{font-style:normal;font-size:.9em;opacity:.65}

/* Preguntas: acordeon nativo, sin JS. */
.faq{max-width:70ch}
.faq details{border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent);padding:1.05rem 0}
.faq summary{cursor:pointer;font-weight:600;font-size:calc(1.05rem * ${s});list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";float:right;font-weight:400;opacity:.5}
.faq details[open] summary::after{content:"–"}
.faq details p{margin:.8em 0 0;opacity:.78;max-width:none}

/* Cierre: bloque con fondo tintado para separar del resto. */
.cta-block{text-align:center;background:color-mix(in srgb,var(--accent) 8%,var(--ground));border-radius:var(--radius)}
.cta-block h2{max-width:24ch;margin-inline:auto}

.contact .lead-form{margin-inline:auto}

@media (max-width:640px){section{padding:calc(var(--gap) * .6) calc(var(--margin) * .6)}h1{font-size:calc(1.9rem * ${s})}.hero h1{font-size:calc(2.1rem * ${s})}}`;
}
