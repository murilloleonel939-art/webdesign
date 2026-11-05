import { validateSiteDocument, isSafeUrl, type SiteDocument } from "@webdesign/site-schema";

// Linter estático (spec 6.4). Corre sin navegador en cada guardado del editor.
// Los hallazgos `error` bloquean la publicación; `warning` e `info` no.

export type Severity = "error" | "warning" | "info";

export interface LintFinding {
  code: string;
  severity: Severity;
  pageId?: string | undefined;
  sectionId?: string | undefined;
  field?: string | undefined;
  message: string; // clave de traducción, no texto final
  fixHint?: string | undefined;
  autofixable: boolean;
}

const HOSTED_FONTS = ["Source Serif 4", "Inter", "Fraunces", "Instrument Sans", "Libre Franklin"];
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const LONG_TEXT = 2500;

// Contraste WCAG sobre luminancia relativa (sin navegador).
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export interface LintOptions {
  // Peso propio ya calculado de HTML, imágenes, vídeos y fuentes (bytes).
  pageBytes?: Record<string, number>;
  // Assets con licencia registrada; los demás son error IMAGE_LICENSE_MISSING.
  licensedAssetIds?: string[];
}


// Pasada previa sobre el JSON crudo: estos códigos deben salir aunque el esquema
// rechace el documento, porque son la causa del rechazo y el editor necesita el detalle.
function scanRaw(input: unknown, licensed: Set<string>): LintFinding[] {
  const out: LintFinding[] = [];
  const d = input as Record<string, unknown> | null;
  const pages = Array.isArray(d?.["pages"]) ? (d!["pages"] as unknown[]) : [];
  for (const rawPage of pages) {
    const page = rawPage as Record<string, unknown> | null;
    const pid = typeof page?.["id"] === "string" ? (page["id"] as string) : undefined;
    const sections = Array.isArray(page?.["sections"]) ? (page!["sections"] as unknown[]) : [];
    for (const rawSection of sections) {
      const sec = rawSection as Record<string, unknown> | null;
      const sid = typeof sec?.["id"] === "string" ? (sec["id"] as string) : undefined;
      const props = (sec?.["props"] ?? {}) as Record<string, unknown>;
      const type = sec?.["type"];

      const hrefs: string[] = [];
      if (typeof props["href"] === "string") hrefs.push(props["href"] as string);
      const cta = props["cta"] as { href?: unknown } | undefined;
      if (typeof cta?.href === "string") hrefs.push(cta.href);
      for (const h of hrefs) {
        if (!isSafeUrl(h)) out.push({ code: "UNSAFE_URL", severity: "error", pageId: pid, sectionId: sid, field: "href", message: "lint.unsafeUrl", autofixable: false });
      }

      for (const k of ["headline", "subline", "body", "quote"]) {
        const v = props[k];
        if (typeof v === "string" && /<\/?[a-z][^>]*>/i.test(v)) {
          out.push({ code: "RAW_HTML", severity: "error", pageId: pid, sectionId: sid, field: k, message: "lint.rawHtml", autofixable: false });
        }
      }

      if (type === "testimonial" && props["ownerProvided"] !== true) {
        out.push({ code: "TESTIMONIAL_UNVERIFIED", severity: "error", pageId: pid, sectionId: sid, message: "lint.testimonialUnverified", autofixable: false });
      }

      const used: string[] = [];
      if (typeof props["assetId"] === "string") used.push(props["assetId"] as string);
      if (Array.isArray(props["assetIds"])) used.push(...(props["assetIds"] as string[]));
      for (const aid of new Set(used)) {
        if (!licensed.has(aid)) out.push({ code: "IMAGE_LICENSE_MISSING", severity: "error", pageId: pid, sectionId: sid, field: "assetId", message: "lint.imageLicenseMissing", fixHint: aid, autofixable: false });
      }
    }
  }
  return out;
}

export function lintSite(input: unknown, opts: LintOptions = {}): LintFinding[] {
  const licensed = new Set(opts.licensedAssetIds ?? []);
  const findings: LintFinding[] = scanRaw(input, licensed);
  const r = validateSiteDocument(input);
  if (!r.ok) {
    for (const e of r.errors) {
      findings.push({ code: "SCHEMA_INVALID", severity: "error", message: "lint.schemaInvalid", fixHint: e, autofixable: false });
    }
    return findings;
  }
  const doc: SiteDocument = r.doc;
  const add = (f: LintFinding) => findings.push(f);

  if (!HOSTED_FONTS.includes(doc.theme.typography.family)) {
    add({ code: "FONT_NOT_HOSTED", severity: "error", field: "theme.typography.family", message: "lint.fontNotHosted", autofixable: true });
  }
  if (contrastRatio(doc.theme.colors.ink, doc.theme.colors.ground) < 4.5) {
    add({ code: "THEME_CONTRAST", severity: "warning", field: "theme.colors", message: "lint.contrast", autofixable: false });
  }

  const slugs = new Map<string, string>();
  const assetIds = new Set(doc.assets.map((a) => a.id));

  for (const page of doc.pages) {
    const pid = page.id;
    if (slugs.has(page.slug)) {
      add({ code: "DUPLICATE_SLUG", severity: "error", pageId: pid, field: "slug", message: "lint.duplicateSlug", autofixable: false });
    }
    slugs.set(page.slug, pid);

    if (!page.seo.title.trim()) {
      add({ code: "MISSING_TITLE", severity: "error", pageId: pid, field: "seo.title", message: "lint.missingTitle", autofixable: false });
    }
    if (!page.seo.description?.trim()) {
      add({ code: "MISSING_META_DESCRIPTION", severity: "warning", pageId: pid, field: "seo.description", message: "lint.missingDescription", autofixable: false });
    }
    if (page.sections.length === 0) {
      add({ code: "EMPTY_PAGE", severity: "error", pageId: pid, message: "lint.emptyPage", autofixable: false });
    }
    if (opts.pageBytes?.[pid] !== undefined && opts.pageBytes[pid]! > MAX_PAGE_BYTES) {
      add({ code: "PAGE_TOO_HEAVY", severity: "error", pageId: pid, message: "lint.pageTooHeavy", autofixable: false });
    }

    let hasCta = false;
    for (const s of page.sections) {
      const p = s.props as Record<string, unknown>;
      const sid = s.id;

      // Enlaces y CTAs.
      const hrefs: (string | undefined)[] = [];
      if (typeof p["href"] === "string") hrefs.push(p["href"]);
      const cta = p["cta"] as { href?: string } | undefined;
      if (cta?.href) {
        hrefs.push(cta.href);
        hasCta = true;
      }
      for (const h of hrefs) {
        if (h?.startsWith("/") && !doc.pages.some((x) => x.slug === h)) {
          add({ code: "BROKEN_INTERNAL_LINK", severity: "warning", pageId: pid, sectionId: sid, field: "href", message: "lint.brokenInternalLink", autofixable: false });
        }
      }

      // HTML crudo en texto enriquecido.
      if (typeof p["body"] === "string" && p["body"].length > LONG_TEXT) {
        add({ code: "LONG_TEXT", severity: "info", pageId: pid, sectionId: sid, field: "body", message: "lint.longText", autofixable: false });
      }

      // Imágenes: alt, licencia y existencia.
      const usedAssets: string[] = [];
      if (typeof p["assetId"] === "string") usedAssets.push(p["assetId"]);
      if (Array.isArray(p["assetIds"])) usedAssets.push(...(p["assetIds"] as string[]));
      for (const aid of usedAssets) {
        if (!assetIds.has(aid)) {
          add({ code: "SCHEMA_INVALID", severity: "error", pageId: pid, sectionId: sid, field: "assetId", message: "lint.assetMissing", fixHint: aid, autofixable: false });
        }
      }
      if (usedAssets.length > 0) {
        const alt = p["alt"];
        const known = usedAssets.every((aid) => doc.assets.find((a) => a.id === aid)?.alt?.trim());
        if (!(typeof alt === "string" && alt.trim()) && !known) {
          add({ code: "MISSING_ALT", severity: "warning", pageId: pid, sectionId: sid, field: "alt", message: "lint.missingAlt", autofixable: false });
        }
      }
      if (Array.isArray(p["assetIds"]) && (p["assetIds"] as string[]).length > 12) {
        add({ code: "TOO_MANY_IMAGES", severity: "info", pageId: pid, sectionId: sid, message: "lint.tooManyImages", autofixable: false });
      }

    }
    if (!hasCta) {
      add({ code: "CTA_MISSING", severity: "warning", pageId: pid, message: "lint.ctaMissing", autofixable: false });
    }
  }

  return findings;
}

// Solo los `error` bloquean la publicación (spec 6.4).
export function blocksPublication(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
