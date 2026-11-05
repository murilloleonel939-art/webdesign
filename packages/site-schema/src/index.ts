import { z } from "zod";

// Esquema del documento de sitio (spec 6.1). Formato canónico del que dependen
// editor, agentes y renderer. Tipo desconocido = rechazado.

export const SECTION_TYPES = ["hero", "text", "image", "gallery", "features", "pricing", "testimonial", "faq", "contact", "cta"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

// Esquemas de enlace permitidos (spec 6.2). Nada de javascript: ni data:.
const ALLOWED_SCHEMES = ["https:", "http:", "mailto:", "tel:"];

export function isSafeUrl(value: string): boolean {
  if (value.startsWith("#")) return true; // ancla interna
  try {
    return ALLOWED_SCHEMES.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const urlSchema = z.string().refine(isSafeUrl, { message: "UNSAFE_URL" });
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "invalid color" });

// El slug no admite `..`, barras repetidas ni mayúsculas.
const slugSchema = z.string().regex(/^\/([a-z0-9]+(-[a-z0-9]+)*\/?)*$/, { message: "invalid slug" });

const ctaSchema = z.object({ label: z.string().max(60), href: urlSchema });

const propsByType: Record<SectionType, z.ZodTypeAny> = {
  hero: z.object({ headline: z.string().max(120), subline: z.string().max(240).optional(), cta: ctaSchema.optional(), image: z.string().optional() }),
  text: z.object({ body: z.string().max(4000) }),
  image: z.object({ assetId: z.string(), alt: z.string().max(200).optional() }),
  gallery: z.object({ assetIds: z.array(z.string()).max(24) }),
  features: z.object({ items: z.array(z.object({ title: z.string().max(80), body: z.string().max(300) })).max(12) }),
  pricing: z.object({ plans: z.array(z.object({ name: z.string().max(40), price: z.string().max(20), features: z.array(z.string().max(120)).max(12) })).max(6) }),
  testimonial: z.object({ quote: z.string().max(600), author: z.string().max(80), ownerProvided: z.literal(true) }),
  faq: z.object({ items: z.array(z.object({ q: z.string().max(200), a: z.string().max(1200) })).max(20) }),
  contact: z.object({ email: z.string().email().optional(), phone: z.string().max(30).optional(), cta: ctaSchema.optional() }),
  cta: z.object({ headline: z.string().max(120), cta: ctaSchema }),
};

export const sectionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(SECTION_TYPES),
    variant: z.string().max(40).optional(),
    props: z.record(z.string(), z.unknown()),
  })
  .superRefine((s, ctx) => {
    const r = propsByType[s.type].safeParse(s.props);
    if (!r.success) ctx.addIssue({ code: "custom", message: `props invalid for ${s.type}: ${r.error.issues[0]?.message ?? ""}` });
  });

export const pageSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  seo: z.object({ title: z.string().max(70), description: z.string().max(160), ogImage: z.string().nullable().optional(), noindex: z.boolean() }),
  themeOverrides: z.record(z.string(), z.unknown()).optional(),
  sections: z.array(sectionSchema),
});

export const siteDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({ name: z.string().min(1).max(80), lang: z.enum(["es", "en"]), favicon: z.string().nullable().optional() }),
  design: z.object({
    brief: z.string().max(500),
    idea: z.string().max(500),
    presetId: z.string().max(60),
    dials: z.object({ variance: z.number().int().min(0).max(10), motion: z.number().int().min(0).max(10), density: z.number().int().min(0).max(10) }),
  }),
  theme: z.object({
    colors: z.object({ ground: hexColor, ink: hexColor, accent: hexColor }),
    typography: z.object({ family: z.string().max(60), scale: z.string().max(40) }),
    spacing: z.object({ margin: z.number().int().min(0).max(200), sectionGap: z.number().int().min(0).max(400) }),
    radius: z.enum(["square", "rounded", "pill"]),
  }),
  pages: z.array(pageSchema).min(1),
  assets: z.array(z.object({ id: z.string(), alt: z.string().max(200).optional(), credit: z.string().max(200).nullable().optional() })),
  integrations: z
    .object({
      chatWidget: z.object({ enabled: z.boolean() }).optional(),
      whatsapp: z.object({ phone: z.string().nullable(), message: z.string().max(300) }).optional(),
    })
    .optional(),
});

export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Section = z.infer<typeof sectionSchema>;

export type ValidationResult =
  | { ok: true; doc: SiteDocument }
  | { ok: false; errors: string[] };

export function validateSiteDocument(input: unknown): ValidationResult {
  const r = siteDocumentSchema.safeParse(input);
  if (r.success) return { ok: true, doc: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "document"}: ${i.message}`) };
}
