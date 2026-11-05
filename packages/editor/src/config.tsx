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
function makeRender(type: Section["type"]) {
  const Component = SECTION_COMPONENTS[type] as unknown as (p: { section: Section; editing?: boolean }) => ReactElement;
  return function Render(props: Props) {
    return <Component section={{ id: "preview", type, props }} editing />;
  };
}

// Puck no tiene limite de longitud en sus campos (0.20): los limites de 6.2 se
// aplican al guardar, en save.ts, donde el documento se valida contra el esquema.
const text = (label: string) => ({ type: "text" as const, label });

export interface EditorConfigOptions {
  // Lista de tipografias alojadas: Puck no ofrece nada fuera de ella (6.2).
  hostedFonts: readonly string[];
}

export function buildEditorConfig(_opts: EditorConfigOptions): Config {
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
        render: makeRender("hero"),
      },
      text: {
        label: "Texto",
        fields: { body: { type: "textarea", label: "Cuerpo" } },
        defaultProps: { body: "" },
        render: makeRender("text"),
      },
      image: {
        label: "Imagen",
        fields: { assetId: { type: "text", label: "Asset" }, alt: text("Texto alternativo") },
        defaultProps: { assetId: "" },
        render: makeRender("image"),
      },
      gallery: {
        label: "Galería",
        fields: { assetIds: { type: "array", label: "Assets", arrayFields: { id: { type: "text", label: "Asset" } } } },
        defaultProps: { assetIds: [] },
        render: makeRender("gallery"),
      },
      features: {
        label: "Ventajas",
        fields: { items: { type: "array", label: "Elementos", arrayFields: { title: text("Título"), body: text("Texto") } } },
        defaultProps: { items: [] },
        render: makeRender("features"),
      },
      pricing: {
        label: "Precios",
        fields: { plans: { type: "array", label: "Planes", arrayFields: { name: text("Nombre"), price: text("Precio") } } },
        defaultProps: { plans: [] },
        render: makeRender("pricing"),
      },
      testimonial: {
        label: "Testimonio",
        fields: { quote: { type: "textarea", label: "Cita" }, author: text("Autor") },
        // `ownerProvided` no es un campo: lo fija el dueno al guardar, no el agente.
        defaultProps: { quote: "", author: "" },
        render: makeRender("testimonial"),
      },
      faq: {
        label: "Preguntas",
        fields: { items: { type: "array", label: "Preguntas", arrayFields: { q: text("Pregunta"), a: { type: "textarea", label: "Respuesta" } } } },
        defaultProps: { items: [] },
        render: makeRender("faq"),
      },
      contact: {
        label: "Contacto",
        fields: { email: { type: "text", label: "Email" }, phone: text("Teléfono") },
        defaultProps: {},
        render: makeRender("contact"),
      },
      cta: {
        label: "Llamada",
        fields: { headline: text("Titular") },
        defaultProps: { headline: "" },
        render: makeRender("cta"),
      },
    },
    root: {
      fields: {
        slug: { type: "text", label: "Ruta" },
      },
    },
  };
}
