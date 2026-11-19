import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSiteDocument, type Page, type SiteDocument } from "@webdesign/site-schema";
import { renderSection } from "@webdesign/ui-components";
import { themeCss } from "./theme-css.js";

// Renderiza HTML estatico a partir de los mismos componentes que usa el editor
// (spec 6.3): una sola implementacion de cada seccion, sin hidratacion.

export { themeCss } from "./theme-css.js";

// React 19 emite algunos atributos en camelCase (`maxLength`, `autoComplete`,
// `readOnly`...) y los booleanos como `required=""`. El navegador los acepta,
// pero html-validate los marca en CI. Se normaliza la salida una sola vez, en
// lugar de repetir el apaño en cada componente.
//
// Se recorre etiqueta por etiqueta y se saltan los valores entre comillas: un
// `alt="miVar=1"` no debe tocarse. React siempre entrecomilla con `"` y escapa
// `<`, `>` y `"` dentro de los valores, asi que este recorrido es exacto.
const TAG = /<[a-zA-Z][^>]*>/g;
const ATTR = /"[^"]*"|(\s)([a-zA-Z][a-zA-Z0-9-]*)(="")?/g;
// Booleanos de HTML que React serializa como `=""`.
const BOOLEAN = new Set(["required", "disabled", "checked", "readonly", "multiple", "selected", "autofocus", "novalidate", "hidden", "open", "async", "defer", "nomodule", "playsinline", "muted", "loop", "controls", "autoplay", "reversed", "itemscope", "formnovalidate", "allowfullscreen", "inert"]);

export function htmlAttributeCase(html: string): string {
  return html.replace(TAG, (tag) =>
    tag.replace(ATTR, (m: string, space: string | undefined, name: string | undefined, empty: string | undefined) => {
      if (space === undefined || name === undefined) return m; // valor entrecomillado
      const lower = name.toLowerCase();
      if (empty !== undefined) return BOOLEAN.has(lower) ? `${space}${lower}` : `${space}${lower}=""`;
      return `${space}${lower}`;
    }),
  );
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type AssetResolver = (assetId: string) => { src: string; alt: string } | undefined;

// La CSP no se escapa: es texto fijo del sistema, y escapar sus comillas la rompe.
export const CSP =
  "default-src 'self'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-src https://www.youtube-nocookie.com";

export function renderPage(input: unknown, pageId: string, resolveAsset: AssetResolver = () => undefined): string {
  const r = validateSiteDocument(input);
  if (!r.ok) throw new Error(`invalid site document: ${r.errors.join("; ")}`);
  const doc: SiteDocument = r.doc;
  const page: Page | undefined = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`page not found: ${pageId}`);

  const body = page.sections
    .map((section) => htmlAttributeCase(renderToStaticMarkup(renderSection(section, { resolveAsset }) as ReactElement)))
    .join("\n");

  const title = escapeHtml(page.seo.title || doc.meta.name);
  const year = new Date().getFullYear();
  const siteName = escapeHtml(doc.meta.name);
  // Pie oscuro y con columnas (B7): fuera de las secciones del documento, asi
  // que no depende de que el dueno anada una seccion "contact" para existir.
  // El enlace vuelve a `#contacto`, que es el ancla que usa esa seccion si
  // esta presente; si no lo esta, el navegador simplemente no desplaza nada.
  const footer =
    `<footer class="site-footer">` +
    `<div><p class="site-footer__brand">${siteName}</p><p>© ${year} ${siteName}. Todos los derechos reservados.</p></div>` +
    `<nav><a href="#contacto">Contacto</a></nav>` +
    `</footer>`;
  return (
    `<!DOCTYPE html><html lang="${escapeHtml(doc.meta.lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title>` +
    (page.seo.description ? `<meta name="description" content="${escapeHtml(page.seo.description)}">` : "") +
    (page.seo.noindex ? '<meta name="robots" content="noindex">' : "") +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    // El CSS se genera del tema del documento: sin esto el sitio sale sin
    // estilos, porque no hay hoja compartida que servir.
    `<style>${themeCss(doc.theme)}</style>` +
    `</head><body>\n${body}\n${footer}\n</body></html>`
  );
}
