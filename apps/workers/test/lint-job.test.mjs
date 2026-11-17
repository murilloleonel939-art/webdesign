import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE } from "@webdesign/quality/test/fixtures.mjs";
import { processLintJob } from "../dist/index.js";

// Aceptacion de Fase 4 (spec 6.5): el worker analiza un release ya creado y
// guarda sus hallazgos. Ninguna de estas pruebas toca Redis ni Postgres: las
// dependencias son falsas y viven en memoria, que es justo lo que el job puro
// permite.

const SITE = "22222222-2222-4222-8222-222222222222";

// `SAMPLE` esta limpio a proposito (el sistema de diseno no dispara sus propias
// reglas), asi que para ver hallazgos se derivan sus paginas: un `features`
// sin titular propio cuelga sus h3 del h1 del hero, que es SLOP_HEADING_SKIP.
// El resto del documento sigue siendo el de muestra, ya validado.
function conHallazgos() {
  const doc = structuredClone(SAMPLE);
  for (const page of doc.pages) {
    page.sections = [
      { id: "h1", type: "hero", props: { headline: "Hola", cta: { label: "Ir", href: "#x" } } },
      { id: "f1", type: "features", props: { items: [{ title: "A", body: "a" }] } },
    ];
  }
  return doc;
}

// Almacen en memoria con la misma forma que la tabla: una clave por release.
function fakeDeps(docs) {
  const saved = new Map();
  return {
    saved,
    deps: {
      async loadVersion(siteId, version) {
        const doc = docs.get(`${siteId}:${version}`);
        return doc === undefined ? null : { doc };
      },
      async saveFindings(siteId, version, findings) {
        // Como el SQL: reemplaza, no acumula.
        saved.set(`${siteId}:${version}`, findings);
      },
    },
  };
}

test("guarda los hallazgos del release", async () => {
  const { saved, deps } = fakeDeps(new Map([[`${SITE}:3`, conHallazgos()]]));
  const r = await processLintJob({ siteId: SITE, version: 3 }, deps);

  const stored = saved.get(`${SITE}:3`);
  assert.equal(r.count, stored.length);
  assert.ok(r.count > 0, "el documento derivado dispara alguna regla");
  // El contrato de 6.5: cada hallazgo conserva codigo, severidad, mensaje y la
  // pagina de la que sale.
  for (const f of stored) {
    assert.equal(f.code, "SLOP_HEADING_SKIP");
    assert.equal(f.severity, "error");
    assert.equal(typeof f.message, "string");
    assert.ok(f.pageId === "p_home" || f.pageId === "p_precios");
  }
  assert.equal(saved.size, 1);
});

test("un sitio de muestra limpio se guarda sin hallazgos", async () => {
  const { saved, deps } = fakeDeps(new Map([[`${SITE}:4`, SAMPLE]]));
  const r = await processLintJob({ siteId: SITE, version: 4 }, deps);
  // Guardar cero es lo correcto: borra los de una ejecucion anterior.
  assert.deepEqual(r, { count: 0 });
  assert.deepEqual(saved.get(`${SITE}:4`), []);
});

test("un release inexistente no guarda nada y no lanza", async () => {
  const { saved, deps } = fakeDeps(new Map());
  const r = await processLintJob({ siteId: SITE, version: 9 }, deps);
  assert.deepEqual(r, { count: 0 });
  assert.equal(saved.size, 0);
});

test("repetir el job reemplaza los hallazgos, no los duplica", async () => {
  const { saved, deps } = fakeDeps(new Map([[`${SITE}:1`, conHallazgos()]]));
  const first = await processLintJob({ siteId: SITE, version: 1 }, deps);
  const second = await processLintJob({ siteId: SITE, version: 1 }, deps);

  assert.equal(first.count, second.count);
  assert.equal(saved.size, 1);
  assert.equal(saved.get(`${SITE}:1`).length, second.count);
});

test("el linter corre pagina a pagina sobre el release", async () => {
  const { saved, deps } = fakeDeps(new Map([[`${SITE}:5`, conHallazgos()]]));
  await processLintJob({ siteId: SITE, version: 5 }, deps);
  const pages = new Set(saved.get(`${SITE}:5`).map((f) => f.pageId));
  assert.deepEqual([...pages].sort(), ["p_home", "p_precios"]);
});
