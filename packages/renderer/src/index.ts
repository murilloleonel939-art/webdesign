import { validateSiteDocument, type Page, type Section, type SiteDocument } from "@webdesign/site-schema";

// Escapa todo texto que viene del usuario. Nunca se inserta HTML crudo.
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type AssetResolver = (assetId: string) => { src: string; alt: string } | undefined;

function attrs(extra: Record<string, string | undefined>): string {
  return Object.entries(extra)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeHtml(v as string)}"`)
    .join("");
}

function renderSection(s: Section, resolveAsset: AssetResolver): string {
  const p = s.props as Record<string, unknown>;
  const id = escapeHtml(s.id);
  switch (s.type) {
    case "hero": {
      const cta = p["cta"] as { label: string; href: string } | undefined;
      return `<section id="${id}" class="hero"><h1>${escapeHtml(String(p["headline"] ?? ""))}</h1>${
        p["subline"] ? `<p>${escapeHtml(String(p["subline"]))}</p>` : ""
      }${cta ? `<a${attrs({ href: cta.href, rel: "noopener noreferrer" })}>${escapeHtml(cta.label)}</a>` : ""}</section>`;
    }
    case "text":
      return `<section id="${id}"><p>${escapeHtml(String(p["body"] ?? ""))}</p></section>`;
    case "image": {
      const a = resolveAsset(String(p["assetId"] ?? ""));
      if (!a) return `<section id="${id}"></section>`;
      return `<section id="${id}"><img${attrs({ src: a.src, alt: String(p["alt"] ?? a.alt) })}></section>`;
    }
    case "gallery": {
      const imgs = (p["assetIds"] as string[] | undefined ?? [])
        .map((aid) => resolveAsset(aid))
        .filter((a): a is { src: string; alt: string } => a !== undefined)
        .map((a) => `<img${attrs({ src: a.src, alt: a.alt })}>`)
        .join("");
      return `<section id="${id}" class="gallery">${imgs}</section>`;
    }
    case "features": {
      const items = (p["items"] as { title: string; body: string }[] | undefined ?? [])
        .map((i) => `<li><h3>${escapeHtml(i.title)}</h3><p>${escapeHtml(i.body)}</p></li>`)
        .join("");
      return `<section id="${id}"><ul class="features">${items}</ul></section>`;
    }
    case "pricing": {
      const plans = (p["plans"] as { name: string; price: string; features: string[] }[] | undefined ?? [])
        .map((pl) => `<li><h3>${escapeHtml(pl.name)}</h3><p>${escapeHtml(pl.price)}</p><ul>${pl.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></li>`)
        .join("");
      return `<section id="${id}"><ul class="pricing">${plans}</ul></section>`;
    }
    case "testimonial":
      return `<section id="${id}" class="testimonial"><blockquote>${escapeHtml(String(p["quote"] ?? ""))}</blockquote><cite>${escapeHtml(String(p["author"] ?? ""))}</cite></section>`;
    case "faq": {
      const items = (p["items"] as { q: string; a: string }[] | undefined ?? [])
        .map((i) => `<details><summary>${escapeHtml(i.q)}</summary><p>${escapeHtml(i.a)}</p></details>`)
        .join("");
      return `<section id="${id}"><div class="faq">${items}</div></section>`;
    }
    case "contact": {
      const cta = p["cta"] as { label: string; href: string } | undefined;
      return `<section id="${id}" class="contact">${
        p["email"] ? `<a${attrs({ href: `mailto:${String(p["email"])}` })}>${escapeHtml(String(p["email"]))}</a>` : ""
      }${p["phone"] ? `<a${attrs({ href: `tel:${String(p["phone"])}` })}>${escapeHtml(String(p["phone"]))}</a>` : ""}${
        cta ? `<a${attrs({ href: cta.href, rel: "noopener noreferrer" })}>${escapeHtml(cta.label)}</a>` : ""
      }</section>`;
    }
    case "cta": {
      const cta = p["cta"] as { label: string; href: string };
      return `<section id="${id}" class="cta"><h2>${escapeHtml(String(p["headline"] ?? ""))}</h2><a${attrs({ href: cta.href, rel: "noopener noreferrer" })}>${escapeHtml(cta.label)}</a></section>`;
    }
  }
}

const CSP = "default-src 'self'; img-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-src https://www.youtube-nocookie.com";

// Renderiza una página de un documento validado. Tipo desconocido = error.
export function renderPage(input: unknown, pageId: string, resolveAsset: AssetResolver = () => undefined): string {
  const r = validateSiteDocument(input);
  if (!r.ok) throw new Error(`invalid site document: ${r.errors.join("; ")}`);
  const doc: SiteDocument = r.doc;
  const page: Page | undefined = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`page not found: ${pageId}`);
  const body = page.sections.map((s) => renderSection(s, resolveAsset)).join("\n");
  const title = escapeHtml(page.seo.title || doc.meta.name);
  return `<!doctype html><html lang="${doc.meta.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${
    page.seo.description ? `<meta name="description" content="${escapeHtml(page.seo.description)}">` : ""
  }${page.seo.noindex ? '<meta name="robots" content="noindex">' : ""}<meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>\n${body}\n</body></html>`;
}
