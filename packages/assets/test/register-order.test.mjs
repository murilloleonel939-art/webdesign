import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAsset } from "../dist/index.js";

// Orden de operaciones en registerAsset: dueno -> cuota -> disco -> INSERT.
// Antes era disco primero y con el `siteId` crudo de la URL: una sesion valida
// escribia ficheros bajo /data/sites/<sitio ajeno>/assets con solo adivinar su
// UUID, y un rechazo posterior (cuota, o un INSERT que falla) dejaba el fichero
// ahi, sin fila que lo referenciara. Sin base en esta maquina; el doble en
// memoria contesta lo justo que la funcion consulta antes de escribir, y
// cualquier otra consulta revienta para que un cambio de orden salga en rojo.

const OWNER = "11111111-1111-4111-8111-111111111111";
const FOREIGN_SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWN_SITE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

// `owned: false` simula un sitio que no es del usuario; `insertFails` simula el
// INSERT que revienta despues de haber escrito el fichero. `onInsert` permite
// mirar el disco justo en el instante del INSERT.
function doublePool({ owned, insertFails = false, onInsert }) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      const text = typeof sql === "string" ? sql.trim() : String(sql);
      calls.push(text);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [], rowCount: 0 };
      if (/set_config/.test(text)) return { rows: [], rowCount: 0 };
      if (/FROM sites WHERE id = \$1 AND owner_id = \$2 FOR UPDATE/.test(text)) {
        return { rows: owned ? [{}] : [], rowCount: owned ? 1 : 0 };
      }
      if (/FROM assets WHERE site_id = \$1/.test(text)) {
        return { rows: [{ total: "0", n: "0" }], rowCount: 1 };
      }
      if (/INSERT INTO assets/.test(text)) {
        onInsert?.(params);
        if (insertFails) throw new Error("insert fallido (simulado)");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`consulta inesperada: ${text} :: ${JSON.stringify(params)}`);
    },
    release: () => {},
  };
  return { pool: { connect: async () => client }, calls };
}

// Ficheros bajo `root` (los directorios vacios no cuentan como residuo).
function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

const opts = (sitesRoot, siteId) => ({
  userId: OWNER, siteId, kind: "image", content: PNG,
  declaredMime: "image/png", source: "own", sitesRoot,
});

test("sitio ajeno: lanza site_not_found y no escribe nada en disco", async () => {
  const root = mkdtempSync(join(tmpdir(), "assets-order-"));
  const { pool, calls } = doublePool({ owned: false });

  await assert.rejects(
    () => registerAsset(pool, opts(root, FOREIGN_SITE)),
    (e) => e.code === "site_not_found",
  );

  // Ni el directorio del sitio: la comprobacion de dueno va antes de mkdir,
  // asi que /data/sites/<sitio ajeno> no llega a existir.
  assert.equal(existsSync(join(root, FOREIGN_SITE)), false);
  assert.deepEqual(readdirSync(root), []);
  // Y el corte es antes de la cuota: no se consulta `assets` en absoluto.
  assert.equal(calls.some((c) => /FROM assets WHERE site_id/.test(c)), false);
  assert.equal(calls.some((c) => /INSERT INTO assets/.test(c)), false);
});

test("si el INSERT falla, el fichero escrito se borra", async () => {
  const root = mkdtempSync(join(tmpdir(), "assets-order-"));
  let written = [];
  const { pool } = doublePool({
    owned: true,
    insertFails: true,
    // En el instante del INSERT el fichero ya esta en su ruta final y sin .tmp:
    // el rename lo consumio. Que luego no quede nada es merito del unlink.
    onInsert: () => { written = filesUnder(root); },
  });

  await assert.rejects(() => registerAsset(pool, opts(root, OWN_SITE)), /insert fallido/);

  assert.equal(written.length, 1);
  assert.match(written[0], /assets[/\\]image[/\\][0-9a-f-]{36}-[0-9a-f]{12}\.png$/);
  // Nada huerfano: ni el fichero final ni el .tmp sobreviven al INSERT fallido.
  assert.deepEqual(filesUnder(root), []);
});
