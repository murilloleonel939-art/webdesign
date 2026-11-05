import type { Page, Section, SiteDocument } from "@webdesign/site-schema";

// Adaptador entre el documento canonico (spec 6.1) y el formato de datos de Puck.
// Contrato de 6.3: schema -> puck -> schema debe devolver el mismo documento.
// Las props de seccion no se tocan: se copian tal cual, para no reinterpretar nada.

export interface PuckData {
  content: PuckBlock[];
  root: { props: Record<string, unknown> };
}

export interface PuckBlock {
  type: string;
  props: Record<string, unknown> & { id: string };
}

// Lo que Puck no modela (meta, theme, design, assets) viaja en root.props, sin perderse.
interface RootProps {
  schemaVersion: 1;
  meta: SiteDocument["meta"];
  design: SiteDocument["design"];
  theme: SiteDocument["theme"];
  assets: SiteDocument["assets"];
  slug: string;
  seo: Page["seo"];
  themeOverrides?: Page["themeOverrides"];
}

// Un documento puede tener varias paginas; Puck edita una a la vez.
export function documentToPuck(doc: SiteDocument, pageId: string): PuckData {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`page not found: ${pageId}`);
  const root: RootProps = {
    schemaVersion: doc.schemaVersion,
    meta: doc.meta,
    design: doc.design,
    theme: doc.theme,
    assets: doc.assets,
    slug: page.slug,
    seo: page.seo,
    ...(page.themeOverrides ? { themeOverrides: page.themeOverrides } : {}),
  };
  return {
    content: page.sections.map((s) => ({
      type: s.type,
      props: { id: s.id, ...(s.variant ? { variant: s.variant } : {}), ...s.props },
    })),
    root: { props: root as unknown as Record<string, unknown> },
  };
}

export function puckToDocument(data: PuckData, editingPageId: string): SiteDocument {
  const root = data.root.props as unknown as RootProps;
  const sections: Section[] = data.content.map((block) => {
    const { id, variant, ...props } = block.props;
    return {
      id,
      type: block.type as Section["type"],
      ...(typeof variant === "string" ? { variant } : {}),
      props,
    };
  });
  const page: Page = {
    id: editingPageId,
    slug: root.slug,
    seo: root.seo,
    ...(root.themeOverrides ? { themeOverrides: root.themeOverrides } : {}),
    sections,
  };
  return {
    schemaVersion: root.schemaVersion,
    meta: root.meta,
    design: root.design,
    theme: root.theme,
    pages: [page],
    assets: root.assets,
  };
}

// Variante completa: reemplaza solo la pagina editada y conserva las demas.
export function mergeEditedPage(original: SiteDocument, edited: SiteDocument): SiteDocument {
  const page = edited.pages[0];
  if (!page) throw new Error("edited document has no page");
  const exists = original.pages.some((p) => p.id === page.id);
  return {
    ...original,
    pages: exists ? original.pages.map((p) => (p.id === page.id ? page : p)) : [...original.pages, page],
  };
}

// `ownerProvided` de un testimonio solo lo fija el dueno desde la interfaz (spec 6.2).
// Un agente nunca puede escribirlo: se fuerza a lo que ya habia.
export function guardOwnerOnlyFields(original: SiteDocument, next: SiteDocument, actorType: "user" | "agent"): SiteDocument {
  if (actorType === "user") return next;
  const allowed = new Set(
    original.pages.flatMap((p) => p.sections.filter((s) => s.type === "testimonial").map((s) => s.id)),
  );
  return {
    ...next,
    pages: next.pages.map((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        if (s.type !== "testimonial") return s;
        const prev = original.pages
          .flatMap((op) => op.sections)
          .find((os) => os.id === s.id);
        // Un testimonio nuevo escrito por un agente no puede venir verificado.
        const ownerProvided = allowed.has(s.id) ? (prev?.props as Record<string, unknown>)?.["ownerProvided"] === true : false;
        return { ...s, props: { ...s.props, ownerProvided } };
      }),
    })),
  };
}
