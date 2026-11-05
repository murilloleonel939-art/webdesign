import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSiteDocument, type Page, type SiteDocument } from "@webdesign/site-schema";
import { renderSection } from "@webdesign/ui-components";

// Renderiza HTML estatico a partir de los mismos componentes que usa el editor
// (spec 6.3): una sola implementacion de cada seccion, sin hidratacion.

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
    .map((section) => renderToStaticMarkup(renderSection(section, { resolveAsset }) as ReactElement))
    .join("\n");

  const title = escapeHtml(page.seo.title || doc.meta.name);
  return (
    `<!doctype html><html lang="${escapeHtml(doc.meta.lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title>` +
    (page.seo.description ? `<meta name="description" content="${escapeHtml(page.seo.description)}">` : "") +
    (page.seo.noindex ? '<meta name="robots" content="noindex">' : "") +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `</head><body>\n${body}\n</body></html>`
  );
}
