import { renderPage } from "@webdesign/renderer";

// Sitio de muestra con todas las secciones de 6.2 y dos paginas (incluye ruta anidada).
export const SAMPLE = {
  schemaVersion: 1,
  meta: { name: "Café Demo", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#8A2F1C" },
    typography: { family: "Inter", scale: "s" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [
    {
      id: "p_home", slug: "/", seo: { title: "Inicio", description: "Bienvenido", noindex: false },
      sections: [
        { id: "s1", type: "hero", props: { headline: "Café de especialidad", cta: { label: "Ver carta", href: "#carta" } } },
        { id: "s2", type: "text", props: { heading: "Nuestra historia", body: "Tostamos cada lote a mano." } },
        { id: "s3", type: "image", props: { assetId: "a1", alt: "Taza de café" } },
        { id: "s4", type: "features", props: { items: [{ title: "Origen", body: "Finca propia." }] } },
        { id: "s5", type: "faq", props: { items: [{ q: "¿Abren los domingos?", a: "Sí, de 9 a 14." }] } },
        { id: "s6", type: "contact", props: { email: "hola@cafe.example", phone: "+34600000000" } },
      ],
    },
    {
      id: "p_precios", slug: "/precios", seo: { title: "Precios", description: "Tarifas", noindex: false },
      sections: [
        { id: "s7", type: "pricing", props: { plans: [{ name: "Básico", price: "9 €", features: ["Un café"] }] } },
        { id: "s8", type: "cta", props: { headline: "Reserva", cta: { label: "Reservar", href: "mailto:hola@cafe.example" } } },
      ],
    },
  ],
  assets: [{ id: "a1", alt: "Taza de café", credit: null }],
};

// Resolver de assets como el de publicacion: ruta absoluta bajo /assets/.
export const resolveAsset = (id) => (id === "a1" ? { src: "/assets/image/a1.png", alt: "Taza de café" } : undefined);

// Documento HTML completo de una pagina del sitio de muestra.
export function samplePage(pageId) {
  return renderPage(SAMPLE, pageId, resolveAsset);
}
