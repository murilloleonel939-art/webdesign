import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "../dist/index.js";

// Aceptacion de Fase 4 (spec 6.5): "cuando el dueno pide un cambio y el linter
// visual emite un `error`, el cambio se aplica igual y solo se avisa".
//
// Sin Postgres en esta maquina, la prueba cubre la decision previa a la base:
// si el linter visual devuelve un `error` sin confirmacion, `publish` se para y
// devuelve los hallazgos para que el panel pida «Publicar igual». No es un
// bloqueo de contenido: `blocked` es false, que es lo que distingue 6.5 de 6.4.

const SITE = {
  schemaVersion: 1,
  meta: { name: "Prueba", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#FFFFFF", ink: "#1B1B1B", accent: "#0B5FFF" },
    typography: { family: "Inter", scale: "normal" },
    spacing: { margin: 24, sectionGap: 96 },
    radius: "rounded",
  },
  pages: [
    {
      id: "p1",
      slug: "/",
      seo: { title: "Inicio", description: "d", noindex: false },
      // `features` sin titular propio cuelga sus h3 del h1 del hero: eso es un
      // `error` de 6.5 (SLOP_HEADING_SKIP) que el dueno puede aceptar.
      sections: [
        { id: "s1", type: "hero", props: { headline: "Hola", subline: "", cta: { label: "Ir", href: "#x" } } },
        { id: "s2", type: "features", props: { items: [{ title: "A", body: "a" }] } },
      ],
    },
  ],
  assets: [],
};

const sitesRoot = () => mkdtempSync(join(tmpdir(), "sites-"));
// `withUser` valida el uuid antes que nada, asi que se usa uno real para que
// las pruebas lleguen hasta donde quieren llegar.
const USER = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const pool = () => { throw new Error("no debe tocar la base en este caso"); };

test("un error de 6.5 pide confirmacion y no bloquea la publicacion", async () => {
  const r = await publish(pool, { sitesRoot: sitesRoot(), userId: USER, siteId: SITE_ID, doc: SITE });
  assert.equal(r.ok, false);
  // La clave: `blocked` es false. Un `blocked: true` seria contenido invalido.
  assert.equal(r.blocked, false);
  assert.ok(r.visual.some((f) => f.code === "SLOP_HEADING_SKIP"), JSON.stringify(r.visual));
  assert.ok(r.visual.some((f) => f.severity === "error"));
});

test("confirmado por el dueno, el cambio se aplica igual", async () => {
  // Con `confirmVisualFindings` el flujo sigue: los hallazgos se conservan para
  // que se registren en audit_log, pero no detienen la publicacion. Llegar a
  // `connect` es la senal de que la confirmacion desbloqueo el flujo.
  const touched = [];
  const fakePool = { connect: () => { touched.push("connect"); return Promise.reject(new Error("fin de prueba")); } };
  await publish(fakePool, {
    sitesRoot: sitesRoot(), userId: USER, siteId: SITE_ID, doc: SITE, confirmVisualFindings: true,
  }).catch(() => {});
  assert.equal(touched.length, 1, "la confirmacion debe dejar pasar el flujo");
});

test("un sitio limpio no se detiene por 6.5", async () => {
  const clean = structuredClone(SITE);
  clean.pages[0].sections[1].props.heading = "Ventajas";
  const touched = [];
  const fakePool = { connect: () => { touched.push("connect"); return Promise.reject(new Error("fin de prueba")); } };
  const r = await publish(fakePool, { sitesRoot: sitesRoot(), userId: USER, siteId: SITE_ID, doc: clean }).catch((e) => ({ err: e.message }));
  assert.equal(touched.length, 1, JSON.stringify(r));
});
