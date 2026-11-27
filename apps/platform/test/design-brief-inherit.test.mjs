import { test } from "node:test";
import assert from "node:assert/strict";
import { completeBriefInput } from "../dist/brief-inherit.js";
import { normalizeBrief, planSections } from "@webdesign/agent-design";

// Herencia del brief en un rediseño (T-028).
//
// El defecto: `POST /api/sites/:id/design-runs` sólo mandaba lo que el dueño
// contestó en esa sesión. Al pedir un rediseño sin volver a dar sus datos, el
// brief llegaba vacío, `normalizeBrief` no heredaba nada y `draftSite`
// reconstruía el sitio desde cero: un sitio de 4 páginas se encogía a landing y
// perdía su `meta.name`.
//
// Estas pruebas fijan las tres cosas: qué se hereda, que el cuerpo manda, y que
// sin borrador todo sigue como antes.

// Preset con la forma del catálogo (migración 0009). No se importa `platform`:
// el preset entra como DATO, igual que en el agente.
const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  keywords: ["clinica"],
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "text" }, { type: "features" }, { type: "cta" }],
};

/** Documento del dueño con los cuatro datos y una sección de contacto. */
const DOC = {
  schemaVersion: 1,
  meta: { name: "Clínica Dental Sonrisa", lang: "es" },
  design: {
    brief: "clínica dental en Medellín; nombre: Clínica Dental Sonrisa; servicio: limpieza dental; contacto: hola@sonrisadental.co",
    idea: "Clínico y sereno",
    ownerPrompt: "quiero una pagina web para una clinica dental en Medellín",
    presetId: "editorial",
    dials: { variance: 4, motion: 3, density: 5 },
  },
  theme: {
    colors: { ground: "#ffffff", ink: "#111111", accent: "#1f4ed8" },
    typography: { family: "Inter", scale: "base" },
    spacing: { margin: 48, sectionGap: 64 },
    radius: "rounded",
  },
  pages: [
    {
      id: "p_home",
      slug: "/",
      seo: { title: "Clínica Dental Sonrisa", description: "Odontología en Medellín", noindex: false },
      sections: [
        { id: "s_hero", type: "hero", props: { headline: "Sonríe sin miedo", cta: { label: "Pedir cita", href: "/contacto" } } },
        { id: "s_contact", type: "contact", props: { email: "hola@sonrisadental.co" } },
      ],
    },
    {
      id: "p_contacto",
      slug: "/contacto",
      seo: { title: "Contacto", description: "Escríbenos", noindex: false },
      sections: [{ id: "s_contact2", type: "contact", props: { phone: "+57 604 555 0101" } }],
    },
  ],
  assets: [],
};

test("A1 cuerpo vacío: hereda nombre, tipo, ciudad y contacto del documento", () => {
  const brief = completeBriefInput({}, DOC);
  assert.equal(brief.name, "Clínica Dental Sonrisa");
  assert.equal(brief.businessType, "clínica dental");
  assert.equal(brief.city, "Medellín");
  assert.equal(brief.contact, "hola@sonrisadental.co");
  // El servicio también está en el documento: no hay motivo para volver a pedirlo.
  assert.equal(brief.service, "limpieza dental");
  // `pending` se construye DESPUÉS de heredar (normalizeBrief lo hace en el
  // worker): si la herencia llegara tarde, el panel volvería a pedirlo todo.
  assert.deepEqual(normalizeBrief(brief).pending, []);
});

test("A1 el sitio heredado sigue siendo de 4 páginas, no una landing", () => {
  const plan = planSections(normalizeBrief(completeBriefInput({}, DOC)), PRESET);
  assert.equal(plan.shape, "site");
  assert.equal(plan.pages.length, 4);
  assert.deepEqual(plan.pages.map((p) => p.slug), ["/", "/servicios", "/sobre-nosotros", "/contacto"]);
  // El contraste: el mismo pedido sin herencia se encoge a landing de 1 página.
  const sinHerencia = planSections(normalizeBrief({}), PRESET);
  assert.equal(sinHerencia.shape, "landing");
  assert.equal(sinHerencia.pages.length, 1);
});

test("A2 lo que el dueño escribe en el chat manda: el nombre del cuerpo gana", () => {
  const brief = completeBriefInput({ name: "Sonrisa Norte" }, DOC);
  assert.equal(brief.name, "Sonrisa Norte");
  // Y lo que no trae el cuerpo se sigue heredando.
  assert.equal(brief.city, "Medellín");
  assert.equal(brief.businessType, "clínica dental");
});

test("A2 un campo vacío del cuerpo no es un valor: se hereda", () => {
  // El panel manda "" en los campos que el dueño no tocó.
  const brief = completeBriefInput({ name: "  ", city: "" }, DOC);
  assert.equal(brief.name, "Clínica Dental Sonrisa");
  assert.equal(brief.city, "Medellín");
});

test("A3 sin borrador previo se comporta como hoy", () => {
  const body = { name: "Café Aurora", businessType: "cafetería" };
  assert.deepEqual(completeBriefInput(body, undefined), body);
  // Y el brief vacío sigue vacío: la ruta lo rechaza con 400 como siempre.
  assert.deepEqual(completeBriefInput({}, undefined), {});
});

test("A4 un documento sin design ni contacto sólo aporta el nombre, no inventa", () => {
  const doc = { meta: { name: "Peluquería Lola" }, pages: [] };
  assert.deepEqual(completeBriefInput({}, doc), { name: "Peluquería Lola" });
});

test("A5 la frase del dueño cubre el hueco cuando design.brief no parte por ' en '", () => {
  // `designBrief` quita lo que falta: si sólo hay ciudad, la cabeza es una sola
  // palabra y no se puede saber si es tipo o ciudad. No se adivina: se lee la
  // frase original, que sí trae las dos cosas.
  const doc = {
    meta: { name: "Sonrisa" },
    design: { brief: "Medellín; nombre: Sonrisa", ownerPrompt: "quiero una pagina web para una clinica dental en Medellín" },
    pages: [],
  };
  const brief = completeBriefInput({}, doc);
  assert.equal(brief.businessType, "clinica dental");
  assert.equal(brief.city, "Medellín");
});

test("A6 el marcador no se hereda como si fuera un dato", () => {
  const doc = {
    meta: { name: "Sonrisa" },
    design: { brief: "pendiente de confirmar", ownerPrompt: "" },
    pages: [{ id: "p", slug: "/", seo: {}, sections: [{ id: "s_c", type: "contact", props: { email: "pendiente de confirmar", phone: "+57 604 555 0101" } }] }],
  };
  const brief = completeBriefInput({}, doc);
  assert.equal(brief.businessType, undefined);
  assert.equal(brief.city, undefined);
  // El correo marcador no vale, pero el teléfono real sí.
  assert.equal(brief.contact, "+57 604 555 0101");
});

test("A7 un documento a medias no rompe la herencia", () => {
  assert.deepEqual(completeBriefInput({}, null), {});
  assert.deepEqual(completeBriefInput({}, "no soy un documento"), {});
  assert.deepEqual(completeBriefInput({}, { meta: { name: 42 }, pages: "x" }), {});
});
