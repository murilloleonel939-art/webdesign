// Catálogo de diseño (Fase 1b, ADR 0001).
// Los presets son datos globales sin RLS: se leen con el rol de la app.
// `applyPreset` no escribe aquí: transforma el documento del sitio y lo guarda
// por la via normal (`saveDraft`), para que rev optimista, validacion y
// audit_log se comporten igual que en cualquier otro cambio.

import type pg from "pg";
import type { SiteDocument, Section } from "@webdesign/site-schema";

export interface DesignStyle {
  id: string;
  name: string;
  summary: string;
  colors: { ground: string; ink: string; accent: string };
  typography: { family: string; scale: string };
  spacing: { margin: number; sectionGap: number };
  radius: "square" | "rounded" | "pill";
  dials: { variance: number; motion: number; density: number };
  sections: Array<{ type: string }>;
}

interface Row {
  id: string;
  name: string;
  summary: string;
  colors: unknown;
  typography: unknown;
  spacing: unknown;
  radius: "square" | "rounded" | "pill";
  dials: unknown;
  sections: unknown;
}

// Valores por defecto por tipo de seccion. Existen para que aplicar un preset
// produzca un documento que pasa el esquema, sin pedirle nada al dueno.
// Valores por defecto por tipo de seccion, ajustados al esquema real
// (`headline`, no `title`; `quote`/`author`, no `quotes`).
// `testimonial` NO tiene valor por defecto a proposito: inventar un testimonio
// es fabricar datos, y el linter lo marcaria como no verificado. Si un preset
// lo pide, se sustituye por `text`.
const SECTION_DEFAULTS: Record<string, Record<string, unknown>> = {
  hero: {
    headline: "Tu titular aquí",
    subline: "Una línea que explica qué haces y para quién.",
  },
  text: {
    body: "Cuenta aquí tu propuesta. Dos o tres frases claras valen más que un párrafo largo.",
  },
  features: {
    items: [
      { title: "Primera ventaja", body: "Qué resuelve y para quién." },
      { title: "Segunda ventaja", body: "Qué resuelve y para quién." },
      { title: "Tercera ventaja", body: "Qué resuelve y para quién." },
    ],
  },
  gallery: { assetIds: [] },
  pricing: {
    plans: [
      { name: "Básico", price: "19 €", features: ["Lo esencial"] },
      { name: "Completo", price: "49 €", features: ["Todo lo anterior", "Soporte"] },
    ],
  },
  faq: {
    items: [{ q: "¿Cuánto tarda?", a: "Depende del alcance; te lo confirmamos por escrito." }],
  },
  contact: {},
  cta: { headline: "¿Hablamos?", cta: { label: "Contactar", href: "#contacto" } },
};

// Un tipo sin props seguras no se puede sembrar: se degrada a `text`.
function safeType(type: string): string {
  return type in SECTION_DEFAULTS ? type : "text";
}

export async function listStyles(pool: pg.Pool): Promise<DesignStyle[]> {
  const r = await pool.query<Row>(
    `SELECT id, name, summary, colors, typography, spacing, radius, dials, sections
     FROM design_styles WHERE status = 'active' ORDER BY name`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    colors: row.colors as DesignStyle["colors"],
    typography: row.typography as DesignStyle["typography"],
    spacing: row.spacing as DesignStyle["spacing"],
    radius: row.radius,
    dials: row.dials as DesignStyle["dials"],
    sections: row.sections as Array<{ type: string }>,
  }));
}

export async function getStyle(pool: pg.Pool, id: string): Promise<DesignStyle | undefined> {
  const all = await listStyles(pool);
  return all.find((s) => s.id === id);
}

// Como se combina un estilo con lo que el sitio ya tiene.
// - `inherit`: el tema cambia, el contenido se queda. Es lo que espera un dueno
//   que ya escribio el suyo y solo quiere otro aire.
// - `reset`: el contenido se sustituye por la estructura del preset. Solo es
//   correcto si el dueno lo pide de forma explicita.
export type StyleApplyMode = "inherit" | "reset";

export function isStyleApplyMode(v: unknown): v is StyleApplyMode {
  return v === "inherit" || v === "reset";
}

// Aplica un preset al documento.
// No toca assets, ni paginas adicionales, ni SEO, ni integraciones.
export function applyStyleToDocument(
  doc: SiteDocument,
  style: DesignStyle,
  mode: StyleApplyMode = "inherit",
): { doc: SiteDocument; sectionsChanged: boolean } {
  const home = doc.pages.find((p) => p.slug === "/") ?? doc.pages[0];
  const pageId = home?.id ?? "p_home";

  // Conservar el contenido es el defecto: un sitio con texto propio no puede
  // quedar vacio por probar otro estilo.
  const keep = mode === "inherit" && (home?.sections?.length ?? 0) > 0;

  const sections = keep
    ? (home?.sections ?? [])
    : (style.sections.map((s, i) => {
        const type = safeType(s.type);
        return {
          id: `s_${style.id}_${i}`,
          type,
          props: SECTION_DEFAULTS[type] ?? {},
        };
      }) as unknown as Section[]);

  const pages = doc.pages.map((p) =>
    p.id === pageId ? { ...p, sections } : p,
  );

  return {
    doc: {
      ...doc,
      design: {
        ...doc.design,
        presetId: style.id,
        dials: { ...style.dials },
      },
      theme: {
        colors: { ...style.colors },
        typography: { ...style.typography },
        spacing: { ...style.spacing },
        radius: style.radius,
      },
      // El titulo cae al nombre del sitio: nacer con "" hacia que el linter
      // bloqueara la publicacion de todo sitio nuevo con MISSING_TITLE, y el
      // aviso del editor no decia por que.
      pages: pages.length > 0 ? pages : [{
        id: pageId, slug: "/",
        seo: { title: doc.meta.name.slice(0, 70), description: doc.meta.name.slice(0, 160), noindex: false },
        sections,
      }],
    },
    sectionsChanged: !keep,
  };
}
