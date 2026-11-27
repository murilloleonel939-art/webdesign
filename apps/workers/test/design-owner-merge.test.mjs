import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetTracker, LlmClient } from "@webdesign/llm";
import { processDesignJob, fastBudget } from "../dist/index.js";

// Fusión del rediseño con lo que escribió el dueño (T-027).
//
// El fallo que estas pruebas cierran: `runFastDesign` reconstruye el documento
// desde el preset y el job lo guardaba entero, así que un rediseño borraba los
// testimonios, los precios y las cifras del panel, el titular corregido a mano y
// el teléfono. Aquí se fija lo que un rediseño conserva, lo que sí cambia y la
// única excepción (una petición explícita del dueño en el chat).

const RUN = "77777777-7777-4777-8777-777777777777";
const SITE = "88888888-8888-4888-8888-888888888888";
const USER = "99999999-9999-4999-8999-999999999999";

const PRESET = {
  id: "editorial",
  name: "Editorial",
  summary: "Clásico con serif y mucho aire",
  colors: { ground: "#f7f7f2", ink: "#172033", accent: "#1f4ed8" },
  typography: { family: "Source Serif 4", scale: "large" },
  spacing: { margin: 64, sectionGap: 72 },
  radius: "rounded",
  sections: [{ type: "hero" }, { type: "text" }, { type: "cta" }],
};

const BRIEF = {
  businessType: "cafetería de especialidad",
  name: "Café Aurora",
  city: "Valencia",
  service: "tueste propio",
  contact: "hola@cafeaurora.test",
};

/** Transporte falso: contesta siempre y cuenta las llamadas. */
function fakeTransport() {
  return {
    provider: "fake",
    calls: 0,
    async complete() {
      this.calls += 1;
      return { text: "listo", toolCalls: [], finishReason: "stop", usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 }, model: "fake", latencyMs: 1 };
    },
  };
}

/**
 * Borrador que ya tiene lo del dueño, tal como lo deja el panel.
 *
 * Las marcas `ownerEdited` las pone el guardado del panel (`markOwnerEdits`), no
 * esta prueba: aquí se simula el estado guardado para comprobar que el job las
 * respeta. El titular lleva marca y el subtítulo no, que es el caso real.
 */
function ownerDraft() {
  return {
    schemaVersion: 1,
    meta: { name: "Café Aurora", lang: "es" },
    design: { brief: "b", idea: "i", presetId: "editorial", dials: { variance: 5, motion: 5, density: 5 } },
    theme: {
      colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
      typography: { family: "Inter", scale: "s" },
      spacing: { margin: 24, sectionGap: 160 },
      radius: "square",
    },
    pages: [{
      id: "p_home",
      slug: "/",
      seo: { title: "Café Aurora", description: "Café de especialidad", noindex: false },
      sections: [
        { id: "s_hero", type: "hero", props: { headline: "Café Aurora, tostado en casa", subline: "Un café" }, ownerEdited: ["headline"] },
        { id: "s_features", type: "features", props: { heading: "Qué hacemos", items: [{ title: "Tueste", body: "Propio" }] } },
        {
          id: "testimonials-1",
          type: "testimonials",
          props: { heading: "Opiniones", ownerProvided: true, items: [{ quote: "Trato exquisito", name: "Marta" }] },
        },
        { id: "pricing-1", type: "pricing", props: { heading: "Precios", plans: [{ name: "Menú", price: "18 €", features: ["Primero y segundo"] }] } },
        {
          id: "metrics-1",
          type: "metrics",
          props: { heading: "En cifras", items: [{ value: "12", label: "años" }, { value: "900", label: "clientes" }, { value: "4,9", label: "de 5" }] },
        },
        { id: "s_contact", type: "contact", props: { phone: "600 123 123", cta: { label: "Llamar", href: "#contacto" } } },
      ],
    }],
    assets: [],
  };
}

/** Dependencias dobles que devuelven el borrador dado y guardan lo que se les pide. */
function fakeDeps(previous) {
  const calls = { saved: [], finished: [], revoked: [] };
  const tracker = new BudgetTracker(fastBudget());
  const deps = {
    async loadDraft() {
      return { rev: 7, doc: previous };
    },
    async loadPresets() {
      return [PRESET];
    },
    async saveCheckpoint() {},
    async saveDraft(input) {
      calls.saved.push(input);
      return { ok: true, rev: 8 };
    },
    async finishRun(runId, userId, status, stopReason) {
      calls.finished.push({ runId, userId, status, stopReason });
    },
    async revokeToken(runId, userId) {
      calls.revoked.push({ runId, userId });
    },
    async makeClient() {
      return { client: new LlmClient(fakeTransport(), tracker, { sleep: async () => {} }), tracker, token: "jti", apiBaseUrl: "http://x" };
    },
  };
  return { deps, calls };
}

const job = (extra = {}) => ({ runId: RUN, siteId: SITE, userId: USER, brief: BRIEF, ...extra });

const sectionsOf = (doc) => doc.pages[0].sections;
const sectionOf = (doc, type) => sectionsOf(doc).find((s) => s.type === type);

test("1. testimonios, precios y cifras del dueño siguen ahí después del rediseño", async () => {
  const { deps, calls } = fakeDeps(ownerDraft());
  const r = await processDesignJob(deps, job());

  assert.equal(r.status, "ok");
  const doc = calls.saved[0].doc;
  for (const type of ["testimonials", "pricing", "metrics"]) {
    const section = sectionOf(doc, type);
    assert.ok(section, `${type} desapareció del borrador`);
  }
  assert.equal(sectionOf(doc, "testimonials").props.items[0].name, "Marta");
  assert.equal(sectionOf(doc, "testimonials").props.ownerProvided, true);
  assert.equal(sectionOf(doc, "pricing").props.plans[0].price, "18 €");
  assert.deepEqual(sectionOf(doc, "metrics").props.items.map((i) => i.value), ["12", "900", "4,9"]);
});

test("1b. el teléfono del contacto también sobrevive", async () => {
  const { deps, calls } = fakeDeps(ownerDraft());
  await processDesignJob(deps, job());
  const contact = sectionOf(calls.saved[0].doc, "contact");
  assert.ok(contact);
  assert.equal(contact.props.phone, "600 123 123");
});

test("2. el titular escrito a mano sobrevive; el subtítulo que nadie tocó cambia", async () => {
  const { deps, calls } = fakeDeps(ownerDraft());
  await processDesignJob(deps, job());
  const hero = sectionOf(calls.saved[0].doc, "hero");
  assert.equal(hero.props.headline, "Café Aurora, tostado en casa");
  assert.notEqual(hero.props.subline, "Un café", "lo que nadie tocó se regenera");
});

test("3. una petición explícita del chat sí cambia el titular, aunque el dueño lo hubiera escrito", async () => {
  const { deps, calls } = fakeDeps(ownerDraft());
  await processDesignJob(deps, job({ changeRequest: true }));
  const hero = sectionOf(calls.saved[0].doc, "hero");
  assert.notEqual(hero.props.headline, "Café Aurora, tostado en casa", "el chat no pudo cambiar el titular");
  // La marca caduca: el texto nuevo es del rediseño, no del dueño.
  assert.equal(hero.ownerEdited, undefined);
  // Sus datos no se tocan por chat: eso no se reescribe con una frase.
  for (const type of ["testimonials", "pricing", "metrics"]) {
    assert.ok(sectionOf(calls.saved[0].doc, type), `${type} desapareció con la petición del chat`);
  }
});

test("4. un documento sin datos del dueño se regenera entero, como antes", async () => {
  const { deps, calls } = fakeDeps({ schemaVersion: 1, meta: {}, design: {}, theme: {}, pages: [], assets: [] });
  const r = await processDesignJob(deps, job());
  assert.equal(r.status, "ok");
  const types = sectionsOf(calls.saved[0].doc).map((s) => s.type);
  // La estructura la pone el agente: nada del dueño que conservar.
  assert.ok(types.includes("hero"));
  for (const type of ["testimonials", "pricing", "metrics"]) assert.equal(types.includes(type), false, `${type} apareció de la nada`);
  // Ni una marca inventada en un sitio que nadie ha tocado.
  for (const section of sectionsOf(calls.saved[0].doc)) assert.equal(section.ownerEdited, undefined);
});

test("4b. una excepción de la fusión no impide guardar el diseño", async () => {
  // El borrador anterior llega con basura: se regenera, no se rompe el run.
  const { deps, calls } = fakeDeps({ schemaVersion: 1, pages: "no-es-una-lista" });
  const r = await processDesignJob(deps, job());
  assert.equal(r.status, "ok");
  assert.equal(calls.saved.length, 1);
});
