import type { ReactElement } from "react";
import type { Config } from "@measured/puck";
import type { Section } from "@webdesign/site-schema";
import { SECTION_COMPONENTS } from "@webdesign/ui-components";

// Configuracion de Puck: un componente por tipo de seccion del esquema, con los
// mismos campos y limites de longitud que 6.2. Puck nunca escribe el documento:
// el adaptador hace la conversion, asi que aqui solo se editan props de seccion.

type Props = Record<string, unknown>;

// Puck exige que cada componente declare sus campos; el render delega en el
// componente puro compartido con el renderer para que no haya dos disenos.
export function resolveEditorAssetPath(path: string): string {
  return path.startsWith("/") ? path : `/assets/${path}`;
}

function makeRender(type: Section["type"], assets: readonly { id: string; path?: string }[]) {
  const Component = SECTION_COMPONENTS[type] as unknown as (p: { section: Section; editing?: boolean; resolveAsset?: (id: string) => { src: string; alt: string } | undefined }) => ReactElement;
  return function Render(props: Props) {
    const resolveAsset = (id: string) => { const asset = assets.find(a => a.id === id); return asset?.path ? { src: resolveEditorAssetPath(asset.path), alt: "" } : undefined; };
    return <Component section={{ id: "preview", type, props }} editing resolveAsset={resolveAsset} />;
  };
}

// Puck no tiene limite de longitud en sus campos (0.20): los limites de 6.2 se
// aplican al guardar, en save.ts, donde el documento se valida contra el esquema.
const text = (label: string) => ({ type: "text" as const, label });

export interface EditorConfigOptions {
  hostedFonts: readonly string[];
  assets?: readonly { id: string; label?: string; path?: string }[];
}

export function buildEditorConfig(opts: EditorConfigOptions): Config {
  return {
    components: {
      hero: {
        label: "Portada",
        fields: {
          headline: text("Titular"),
          subline: text("Entradilla"),
          variant: { type: "select", label: "Variante", options: [{ label: "Simple", value: "default" }, { label: "Con imagen", value: "image-dominant" }] },
        },
        defaultProps: { headline: "Titular", variant: "default" },
        render: makeRender("hero", opts.assets ?? []),
      },
      text: {
        label: "Texto",
        fields: { body: { type: "textarea", label: "Cuerpo" } },
        defaultProps: { body: "" },
        render: makeRender("text", opts.assets ?? []),
      },
      image: {
        label: "Imagen",
        fields: { assetId: { type: "custom", label: "Imagen", render: ({ value, onChange }) => <div style={{ display: "grid", gap: 8 }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData("text/asset-id"); if (id) onChange(id); }}>{opts.assets?.length ? opts.assets.map(a => <button type="button" key={a.id} draggable onDragStart={e => e.dataTransfer.setData("text/asset-id", a.id)} onClick={() => onChange(a.id)} style={{ textAlign: "left", border: value === a.id ? "2px solid #2563eb" : "1px solid #d1d5db", borderRadius: 8, padding: 8, cursor: "grab", background: "white" }}>{a.label ?? a.id}</button>) : <small>Sube una imagen para seleccionarla</small>}<small>Arrastra una imagen aquí o haz clic para seleccionarla.</small></div> }, alt: text("Texto alternativo") },
        defaultProps: { assetId: "" },
        render: makeRender("image", opts.assets ?? []),
      },
      gallery: {
        label: "Galería",
        fields: { assetIds: { type: "array", label: "Assets", arrayFields: { id: { type: "text", label: "Asset" } } } },
        defaultProps: { assetIds: [] },
        render: makeRender("gallery", opts.assets ?? []),
      },
      features: {
        label: "Ventajas",
        fields: { items: { type: "array", label: "Elementos", arrayFields: { title: text("Título"), body: text("Texto") } } },
        defaultProps: { items: [] },
        render: makeRender("features", opts.assets ?? []),
      },
      pricing: {
        label: "Precios",
        fields: { plans: { type: "array", label: "Planes", arrayFields: { name: text("Nombre"), price: text("Precio") } } },
        defaultProps: { plans: [] },
        render: makeRender("pricing", opts.assets ?? []),
      },
      testimonial: {
        label: "Testimonio",
        fields: { quote: { type: "textarea", label: "Cita" }, author: text("Autor") },
        // `ownerProvided` no es un campo: lo fija el dueno al guardar, no el agente.
        defaultProps: { quote: "", author: "" },
        render: makeRender("testimonial", opts.assets ?? []),
      },
      faq: {
        label: "Preguntas",
        fields: { items: { type: "array", label: "Preguntas", arrayFields: { q: text("Pregunta"), a: { type: "textarea", label: "Respuesta" } } } },
        defaultProps: { items: [] },
        render: makeRender("faq", opts.assets ?? []),
      },
      contact: {
        label: "Contacto",
        fields: { email: { type: "text", label: "Email" }, phone: text("Teléfono") },
        defaultProps: {},
        render: makeRender("contact", opts.assets ?? []),
      },
      cta: {
        label: "Llamada",
        fields: { headline: text("Titular") },
        defaultProps: { headline: "" },
        render: makeRender("cta", opts.assets ?? []),
      },
    },
    root: {
      fields: {
        slug: { type: "text", label: "Ruta" },
      },
    },
  };
}
