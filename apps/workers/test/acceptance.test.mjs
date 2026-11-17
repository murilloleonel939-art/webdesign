import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE } from "@webdesign/quality/test/fixtures.mjs";
import { lintRelease } from "@webdesign/lint-visual";
import { renderPage } from "@webdesign/renderer";
import { validateSiteDocument } from "@webdesign/site-schema";
import { processLintJob, lintJobId } from "../dist/index.js";

// Aceptacion del job de lint visual (spec 6.5). Sin Redis ni Postgres: las
// dependencias son falsas y cuentan sus llamadas.

const SITE = "22222222-2222-4222-8222-222222222222";
const SEVERIDADES = new Set(["error", "warning", "info"]);

// Mismo documento con hallazgos que en lint-job.test.mjs: un features sin
// titular cuelga del hero y dispara SLOP_HEADING_SKIP (error).
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

// Almacen en memoria con la forma de la tabla y contador de llamadas.
function fakeDeps(docs) {
  const table = new Map();
  const calls = { save: 0 };
  return {
    table,
    calls,
    deps: {
      async loadVersion(siteId, version) {
        const doc = docs.get(`${siteId}:${version}`);
        return doc === undefined ? null : { doc };
      },
      async saveFindings(siteId, version, findings) {
        calls.save += 1;
        // Como el SQL: borra lo anterior del release y reinserta.
        table.set(`${siteId}:${version}`, findings.map((f) => ({ ...f })));
      },
    },
  };
}

test("a) los hallazgos guardados coinciden con lintRelease sobre las mismas paginas", async () => {
  const doc = conHallazgos();
  const { table, deps } = fakeDeps(new Map([[`${SITE}:10`, doc]]));
  await processLintJob({ siteId: SITE, version: 10 }, deps);

  // Se reconstruyen las paginas igual que lint-job.ts (renderPage, resolver nulo).
  const validated = validateSiteDocument(doc);
  assert.equal(validated.ok, true);
  const pages = new Map();
  for (const page of validated.doc.pages) {
    pages.set(page.id, renderPage(validated.doc, page.id, () => undefined));
  }
  const esperado = lintRelease(pages);
  assert.ok(esperado.length > 0, "las paginas derivadas deben disparar hallazgos");
  assert.deepEqual(table.get(`${SITE}:10`), esperado);
});

test("b) las severidades guardadas son solo error|warning|info", async () => {
  const { table, deps } = fakeDeps(new Map([[`${SITE}:11`, conHallazgos()]]));
  await processLintJob({ siteId: SITE, version: 11 }, deps);
  const findings = table.get(`${SITE}:11`);
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.ok(SEVERIDADES.has(f.severity), `severidad no permitida: ${f.severity}`);
  }
});

test("c) un hallazgo de severidad error no hace fallar el job", async () => {
  const { table, deps } = fakeDeps(new Map([[`${SITE}:12`, conHallazgos()]]));
  // El job debe resolver, no lanzar, aunque haya errores de 6.5.
  const r = await processLintJob({ siteId: SITE, version: 12 }, deps);
  assert.ok(r.count > 0);
  assert.equal(table.get(`${SITE}:12`).some((f) => f.severity === "error"), true);
});

test("d) release inexistente: count 0 y saveFindings no se llama", async () => {
  const { table, calls, deps } = fakeDeps(new Map());
  const r = await processLintJob({ siteId: SITE, version: 99 }, deps);
  assert.deepEqual(r, { count: 0 });
  assert.equal(calls.save, 0);
  assert.equal(table.size, 0);
});

test("e) reejecutar el mismo job deja el mismo numero de filas", async () => {
  const { table, deps } = fakeDeps(new Map([[`${SITE}:13`, conHallazgos()]]));
  await processLintJob({ siteId: SITE, version: 13 }, deps);
  const primera = table.get(`${SITE}:13`).length;
  await processLintJob({ siteId: SITE, version: 13 }, deps);
  const segunda = table.get(`${SITE}:13`).length;
  assert.equal(segunda, primera);
  assert.equal(table.size, 1);
});

test("f) lintJobId produce lint:<siteId>:<version>", () => {
  // NOTA: `enqueueReleaseLint` crea su propia `Queue` de bullmq dentro de la
  // funcion y no admite inyeccion de conexion/cola, asi que no se puede
  // sustituir por un falso sin mockear bullmq. Se comprueba la clave que usa
  // (exportada), y que `enqueueReleaseLint` la pasa como `jobId` en queue.ts.
  assert.equal(lintJobId({ siteId: SITE, version: 7 }), `lint:${SITE}:7`);
});
