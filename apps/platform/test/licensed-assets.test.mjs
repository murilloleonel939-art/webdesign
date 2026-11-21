import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeAssets } from "../dist/api.js";

// Assets con licencia de un sitio (6.4, IMAGE_LICENSE_MISSING).
//
// El publicador y la vista previa usan esta lista: las fotos de Pexels entran
// como `open-collection` con `license = 'Pexels License'` (packages/assets,
// campo `rights`), asi que cuentan. Un `open-collection` sin licencia NO cuenta:
// la regla del linter 6.4 no se toca. Sin base de datos: pool falso y sin red.

const USER = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";

/** Pool falso: devuelve las filas de `assets` que pida la prueba. */
function fakePool(rows) {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM assets/.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, queries };
}

const asset = (id, source, license) => ({ id, path: `${id}.jpg`, source, kind: "image", license });

test("activeAssets: own y generated cuentan sin licencia", async () => {
  const { pool } = fakePool([asset("a1", "own", null), asset("a2", "generated", null)]);
  const sitesRoot = await mkdtemp(join(tmpdir(), "licensed-assets-"));
  const out = await activeAssets(pool, USER, SITE, sitesRoot);
  assert.deepEqual(out.licensedAssetIds, ["a1", "a2"]);
});

test("activeAssets: open-collection con licencia cuenta (fotos de Pexels)", async () => {
  const { pool, queries } = fakePool([asset("a3", "open-collection", "Pexels License")]);
  const sitesRoot = await mkdtemp(join(tmpdir(), "licensed-assets-"));
  const out = await activeAssets(pool, USER, SITE, sitesRoot);
  assert.deepEqual(out.licensedAssetIds, ["a3"]);
  // La licencia tiene que venir en la consulta: sin la columna no se puede decidir.
  const select = queries.find((q) => /FROM assets/.test(q.sql));
  assert.match(select.sql, /license/);
});

test("activeAssets: open-collection sin licencia (null o vacia) no cuenta", async () => {
  const { pool } = fakePool([asset("a4", "open-collection", null), asset("a5", "open-collection", "")]);
  const sitesRoot = await mkdtemp(join(tmpdir(), "licensed-assets-"));
  const out = await activeAssets(pool, USER, SITE, sitesRoot);
  assert.deepEqual(out.licensedAssetIds, []);
});
