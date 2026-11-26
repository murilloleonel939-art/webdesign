import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateSiteDocument } from "@webdesign/site-schema";
import { renderSection, SECTION_COMPONENTS } from "../dist/index.js";

const html = (section, opts) => renderToStaticMarkup(renderSection(section, opts));

test("every section type has a component", () => {
  assert.deepEqual(Object.keys(SECTION_COMPONENTS).sort(), [
    "contact", "cta", "faq", "features", "gallery", "hero", "image", "pricing", "testimonial", "text",
  ]);
});

test("hero text is escaped by React", () => {
  const out = html({ id: "s1", type: "hero", props: { headline: '<script>alert(1)</script>', cta: { label: "Ir", href: "https://x.com" } } });
  assert.ok(!out.includes("<script>"));
  assert.match(out, /&lt;script&gt;/);
});

test("external links carry rel noopener noreferrer", () => {
  const out = html({ id: "s1", type: "hero", props: { headline: "h", cta: { label: "Ir", href: "https://x.com" } } });
  assert.match(out, /rel="noopener noreferrer"/);
});

test("in the editor, links are not live", () => {
  const out = html({ id: "s1", type: "hero", props: { headline: "h", cta: { label: "Ir", href: "https://x.com" } } }, { editing: true });
  assert.ok(!out.includes("href="));
});

test("a testimonial without owner confirmation renders nothing", () => {
  const out = html({ id: "s1", type: "testimonial", props: { quote: "q", author: "a" } });
  assert.ok(!out.includes("blockquote"));
  const ok = html({ id: "s1", type: "testimonial", props: { quote: "cita", author: "Ana", ownerProvided: true } });
  assert.match(ok, /cita/);
});

test("an image without a resolved asset renders no img", () => {
  const out = html({ id: "s1", type: "image", props: { assetId: "a1" } });
  assert.ok(!out.includes("<img"));
  const withAsset = html({ id: "s1", type: "image", props: { assetId: "a1" } }, { resolveAsset: (id) => (id === "a1" ? { src: "/a/1.webp", alt: "Foto" } : undefined) });
  assert.match(withAsset, /src="\/a\/1.webp"/);
  assert.match(withAsset, /alt="Foto"/);
});

test("contact builds mailto and tel links", () => {
  const out = html({ id: "s1", type: "contact", props: { email: "a@b.co", phone: "+34 600 123 456" } });
  assert.match(out, /href="mailto:a%40b\.co"/);
  assert.match(out, /href="tel:\+34600123456"/);
});

test("unknown type is rejected, not silently rendered", () => {
  assert.throws(() => renderSection({ id: "s", type: "raw_html", props: {} }), /unknown section type/);
});

test("every component renders a section whose props validate", () => {
  const samples = [
    { id: "a", type: "hero", props: { headline: "h" } },
    { id: "b", type: "text", props: { body: "uno\n\ndos" } },
    { id: "c", type: "features", props: { items: [{ title: "t", body: "b" }] } },
    { id: "d", type: "pricing", props: { plans: [{ name: "P", price: "9", features: ["f"] }] } },
    { id: "e", type: "faq", props: { items: [{ q: "q", a: "a" }] } },
    { id: "f", type: "cta", props: { headline: "h", cta: { label: "l", href: "#x" } } },
    { id: "g", type: "gallery", props: { assetIds: ["a1"] } },
  ];
  const doc = {
    schemaVersion: 1,
    meta: { name: "N", lang: "es" },
    design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
    theme: { colors: { ground: "#FFFFFF", ink: "#000000", accent: "#112233" },
      typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 160 }, radius: "square" },
    pages: [{ id: "p1", slug: "/", seo: { title: "t", description: "d", noindex: false }, sections: samples }],
    assets: [],
  };
  assert.equal(validateSiteDocument(doc).ok, true);
  for (const s of samples) assert.ok(html(s).length > 0, s.type);
});

test("a gallery renders one image per resolved asset", () => {
  const out = html({ id: "g", type: "gallery", props: { assetIds: ["a1", "a2", "a3"] } },
    { resolveAsset: (id) => ({ src: `/a/${id}.webp`, alt: id }) });
  assert.equal((out.match(/<img/g) ?? []).length, 3);
  assert.match(out, /src="\/a\/a2\.webp"/);
});

test("el formulario de contacto apunta al mismo origen y exige consentimiento", () => {
  const out = html({ id: "c1", type: "contact", props: {} }, { editing: false });
  // Sin CORS y sin dominio comun: la accion es relativa, Caddy conserva el Host.
  assert.match(out, /action="\/_f\/lead"/);
  assert.match(out, /method="post"/);
  // El consentimiento es obligatorio: sin el no se guarda el dato.
  // React puede emitir `required=""` antes o despues del nombre: se comprueba
  // que el input del consentimiento lleve el atributo, en cualquier orden.
  const consentInput = out.match(/<input[^>]*name="consent"[^>]*>/)?.[0] ?? "";
  assert.match(consentInput, /required/, "el consentimiento debe ser obligatorio");
  // Los campos que espera el servidor existen con el nombre exacto.
  for (const name of ["name", "email", "phone", "message"]) {
    assert.match(out, new RegExp(`name="${name}"`), `falta el campo ${name}`);
  }
});

test("el formulario no se pinta dentro del editor", () => {
  const out = html({ id: "c1", type: "contact", props: {} }, { editing: true });
  // En el editor solo se ve el bloque, no un formulario que enviaria a medias.
  assert.equal(out.includes("/_f/lead"), false);
});

test("un hero sin foto se marca con hero--graphic", () => {
  // Sin imagen no hay nada que ensenar a la derecha: el tema dibuja una
  // composicion propia y necesita un selector que no afecte al hero con foto.
  const sin = html({ id: "s1", type: "hero", props: { headline: "h" } });
  assert.match(sin, /class="hero hero--default hero--graphic"/);
  assert.equal(sin.includes("hero--image"), false);

  // Un id de asset que no resuelve tampoco es una foto: mismo tratamiento.
  const huerfano = html({ id: "s1", type: "hero", props: { headline: "h", image: "a1" } });
  assert.match(huerfano, /hero--graphic/);
  assert.equal(huerfano.includes("<img"), false);
});

test("un hero con foto lleva hero--image y no el grafico", () => {
  const out = html(
    { id: "s1", type: "hero", props: { headline: "h", image: "a1" } },
    { resolveAsset: (id) => (id === "a1" ? { src: "/a/1.webp", alt: "Foto" } : undefined) },
  );
  assert.match(out, /hero--image/);
  assert.equal(out.includes("hero--graphic"), false);
});

test("el hero grafico se estila por clase, nunca por style en linea (CSP)", () => {
  const out = html({ id: "s1", type: "hero", props: { headline: "h", subline: "s" } });
  assert.equal(/\sstyle=/.test(out), false);
});
