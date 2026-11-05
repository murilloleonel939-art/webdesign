import { validateSiteDocument, type Block, type SiteDocument } from "@webdesign/site-schema";

// Escapa todo texto que viene del usuario. Nunca se inserta HTML crudo.
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Contenido de cada bloque. El tipo y el texto llegan ya validados por el esquema.
type BlockContent = { text?: string; href?: string; src?: string; alt?: string };

function renderBlock(block: Block, content: BlockContent): string {
  const text = escapeHtml(content.text ?? "");
  switch (block.type) {
    case "hero":
      return `<section id="${escapeHtml(block.id)}" class="hero"><h1>${text}</h1></section>`;
    case "text":
      return `<section id="${escapeHtml(block.id)}"><p>${text}</p></section>`;
    case "image":
      return `<section id="${escapeHtml(block.id)}"><img src="${escapeHtml(content.src ?? "")}" alt="${escapeHtml(content.alt ?? "")}"></section>`;
    case "contact":
      return `<section id="${escapeHtml(block.id)}"><a href="${escapeHtml(content.href ?? "#")}">${text}</a></section>`;
  }
}

// Renderiza un documento validado a HTML. Tipo desconocido = error.
export function renderSite(input: unknown, contents: Record<string, BlockContent>, lang: "es" | "en" = "es"): string {
  const r = validateSiteDocument(input);
  if (!r.ok) throw new Error(`invalid site document: ${r.errors.join("; ")}`);
  const doc: SiteDocument = r.doc;
  const body = doc.blocks.map((b) => renderBlock(b, contents[b.id] ?? {})).join("\n");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'none'"></head><body>\n${body}\n</body></html>`;
}
