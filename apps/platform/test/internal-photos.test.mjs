import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// T-020-bug: flujo completo de POST /api/internal/sites/:id/photos SIN red ni
// Postgres. El pool falso imita lo que hace `pg` de verdad: la fila trae como
// claves los nombres de columna QUE PONE EL SQL (alias incluidos). Con la
// consulta antigua (`SELECT run_id, user_id, site_id`) la fila traia
// `site_id`, `row.siteId` era `undefined` y TODA peticion acababa en 404.

const SITE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const JTI = "44444444-4444-4444-8444-444444444444";

const bank = await mkdtemp(join(tmpdir(), "ip-bank-"));
const sitesRoot = await mkdtemp(join(tmpdir(), "ip-sites-"));
process.env.PHOTO_BANK_ROOT = bank;
delete process.env.PEXELS_API_KEY;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 0x20), Buffer.from([0xff, 0xd9])]);
const entry = (id, file, orientation) => ({
  id, file, sector: "salud", orientation, width: 1600, height: 900, alt: `foto ${id}`,
  photographer: { name: "Test" }, photoPageUrl: `https://unsplash.com/photos/${id}`,
});
await mkdir(join(bank, "unsplash", "salud"), { recursive: true });
const photos = [entry("h1", "salud/hero-01.jpg", "landscape")];
for (let i = 1; i <= 4; i++) photos.push(entry(`s${i}`, `salud/sq-0${i}.jpg`, "squarish"));
for (const p of photos) await writeFile(join(bank, "unsplash", p.file), JPEG);
await writeFile(join(bank, "unsplash", "manifest.json"), JSON.stringify({ license: "Unsplash License", photos }));

const { handleInternalPhotos, authorizeAgent } = await import("../dist/internal-photos.js");

/** Fila con las claves que `pg` pondria: alias si hay `AS "x"`, si no la columna. */
function pgRow(sql, values) {
  const out = {};
  const cols = /SELECT([\s\S]+?)FROM/i.exec(sql)[1].split(",").map((s) => s.trim());
  cols.forEach((c, i) => {
    const alias = /AS\s+"([^"]+)"/i.exec(c);
    out[alias ? alias[1] : c] = values[i];
  });
  return out;
}

function fakePool({ tokenValid = true } = {}) {
  const inserted = [];
  const query = async (sql) => {
    if (/app_agent_token_check/.test(sql)) {
      return { rows: tokenValid ? [pgRow(sql, [RUN, USER, SITE])] : [], rowCount: tokenValid ? 1 : 0 };
    }
    if (/SELECT source_url, credit_text FROM assets/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM sites WHERE id = \$1 AND owner_id/.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (/SUM\(bytes\)/.test(sql)) return { rows: [{ total: "0", n: "0" }], rowCount: 1 };
    if (/INSERT INTO assets/.test(sql)) { inserted.push(sql); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 }; // BEGIN, set_config, COMMIT
  };
  return { inserted, query, connect: async () => ({ query, release() {} }) };
}

function request(body, auth = `Bearer ${JTI}`) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = auth ? { authorization: auth } : {};
  return req;
}

function response() {
  const res = { status: 0, body: "" };
  res.writeHead = (s) => { res.status = s; };
  res.end = (b) => { res.body = b ?? ""; };
  return res;
}

const URL_FOTOS = new URL(`http://p/api/internal/sites/${SITE}/photos`);

test("authorizeAgent devuelve siteId/userId en camelCase (antes siempre 404)", async () => {
  const r = await authorizeAgent(fakePool(), request({}), SITE);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.auth, { runId: RUN, userId: USER, siteId: SITE });
});

test("flujo completo: token valido + banco -> 200 con 1 hero y 4 de galeria", async () => {
  const pool = fakePool();
  const hero = response();
  await handleInternalPhotos(pool, sitesRoot, request({ query: "clinic", orientation: "landscape", count: 1, sector: "salud" }), hero, URL_FOTOS);
  assert.equal(hero.status, 200, hero.body);
  assert.equal(JSON.parse(hero.body).photos.length, 1);

  const gal = response();
  await handleInternalPhotos(pool, sitesRoot, request({ query: "clinic", orientation: "square", count: 4, sector: "salud" }), gal, URL_FOTOS);
  assert.equal(gal.status, 200, gal.body);
  assert.equal(JSON.parse(gal.body).photos.length, 4);
  assert.equal(pool.inserted.length, 5);
});

test("token sin fila -> 401 y queda registrado sin el token", async () => {
  const logs = [];
  const original = console.warn;
  console.warn = (...a) => logs.push(a);
  const res = response();
  try {
    await handleInternalPhotos(fakePool({ tokenValid: false }), sitesRoot, request({ query: "x", count: 1 }), res, URL_FOTOS);
  } finally { console.warn = original; }
  assert.equal(res.status, 401);
  const denied = logs.find(([t]) => t === "internal_photos_denied");
  assert.ok(denied);
  assert.equal(denied[1].error, "invalid_token");
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(JTI));
});

test.after(async () => {
  await rm(bank, { recursive: true, force: true });
  await rm(sitesRoot, { recursive: true, force: true });
});
