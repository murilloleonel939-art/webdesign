import type { DragEvent, ReactElement } from "react";
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
  // El lienzo de Puck es un iframe con srcDoc, asi que su origen es
  // about:blank y una ruta relativa no resuelve: la imagen no se veia en el
  // editor aunque el sitio publicado la sirviera bien. Se absolutiza contra el
  // origen del panel.
  const rel = path.startsWith("/") ? path : `/assets/${path}`;
  const origin = typeof location === "undefined" ? "" : location.origin;
  return origin ? `${origin}${rel}` : rel;
}

// Selector de imagen: miniaturas en cuadricula, con el elegido marcado.
// Arrastrar desde la biblioteca y pulsar aqui hacen lo mismo: fijar el assetId.
function AssetPicker({ assets, value, onChange }: {
  assets: readonly { id: string; label?: string; path?: string }[];
  value: unknown;
  onChange: (id: string) => void;
}) {
  const current = typeof value === "string" ? value : "";
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/asset-id");
    if (id) onChange(id);
  };
  if (!assets.length) {
    return <p style={{ margin: 0, fontSize: 12, color: "#6b7590" }}>Sube una imagen para poder elegirla.</p>;
  }
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: 7 }}
    >
      {assets.map((a) => {
        const selected = current === a.id;
        return (
          <button
            key={a.id}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/asset-id", a.id)}
            onClick={() => onChange(a.id)}
            title={a.label ?? a.id}
            aria-pressed={selected}
            style={{
              position: "relative", padding: 0, overflow: "hidden", cursor: "pointer",
              aspectRatio: "4 / 3", borderRadius: 9,
              border: selected ? "2px solid #6c5ce7" : "1px solid #e6e9f2",
              background: "#f4f6fb",
              boxShadow: selected ? "0 0 0 3px #6c5ce71f" : "none",
            }}
          >
            {a.path ? (
              <img src={resolveEditorAssetPath(a.path)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 11, color: "#6b7590" }}>—</span>
            )}
          </button>
        );
      })}
    </div>
  );
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
  // Se declaro para ofrecer solo fuentes hospedadas, pero el config no lo lee:
  // ninguna seccion lo consume. Se deja opcional hasta que exista ese selector,
  // en vez de obligar a cada llamada a pasar algo que nadie usa.
  hostedFonts?: readonly string[];
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
        fields: { heading: text("Título"), body: { type: "textarea", label: "Cuerpo" } },
        defaultProps: { heading: "", body: "" },
        render: makeRender("text", opts.assets ?? []),
      },
      image: {
        label: "Imagen",
        fields: {
          assetId: {
            type: "custom",
            label: "Imagen",
            render: ({ value, onChange }) => <AssetPicker assets={opts.assets ?? []} value={value} onChange={onChange} />,
          },
          alt: text("Texto alternativo"),
        },
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
        fields: {
          heading: text("Título"),
          items: { type: "array", label: "Elementos", arrayFields: { title: text("Título"), body: text("Texto") } },
        },
        defaultProps: { heading: "", items: [] },
        render: makeRender("features", opts.assets ?? []),
      },
      pricing: {
        label: "Precios",
        fields: {
          heading: text("Título"),
          plans: { type: "array", label: "Planes", arrayFields: { name: text("Nombre"), price: text("Precio") } },
        },
        defaultProps: { heading: "", plans: [] },
        render: makeRender("pricing", opts.assets ?? []),
      },
      testimonial: {
        label: "Testimonio",
        fields: { quote: { type: "textarea", label: "Cita" }, author: text("Autor") },
        // `ownerProvided` no es un campo: lo fija el dueno al guardar, no el agente.
        defaultProps: { quote: "", author: "" },
        render: makeRender("testimonial", opts.assets ?? []),
      },
      testimonials: {
        label: "Testimonios",
        fields: {
          heading: text("Título"),
          items: { type: "array", label: "Testimonios", arrayFields: { quote: { type: "textarea", label: "Cita" }, name: text("Nombre"), role: text("Rol") } },
        },
        // Igual que `testimonial`: `ownerProvided` no es un campo editable aqui.
        defaultProps: { heading: "", items: [] },
        render: makeRender("testimonials", opts.assets ?? []),
      },
      metrics: {
        label: "Cifras",
        fields: {
          heading: text("Título"),
          items: { type: "array", label: "Cifras", arrayFields: { value: text("Cifra"), label: text("Etiqueta") } },
        },
        defaultProps: { heading: "", items: [] },
        render: makeRender("metrics", opts.assets ?? []),
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
        // El linter bloquea la publicacion si falta el titulo y no habia donde
        // escribirlo: el dueno veia "falta algo" sin poder arreglarlo.
        // Va como objeto y no como campos "seo.title": asi se mapea entero a
        // root.seo, sin depender de como interprete Puck los nombres con punto.
        seo: {
          type: "object",
          label: "Titulo y descripcion",
          objectFields: {
            title: { type: "text", label: "Titulo de la pagina" },
            description: { type: "textarea", label: "Descripcion para buscadores" },
          },
        },
      },
    },
  };
}
