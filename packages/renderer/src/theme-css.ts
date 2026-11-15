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
@media (max-width:640px){section{padding:calc(var(--gap) * .6) calc(var(--margin) * .6)}h1{font-size:calc(1.9rem * ${s})}}`;
}
