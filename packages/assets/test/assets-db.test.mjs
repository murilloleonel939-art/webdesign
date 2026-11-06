import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate } from "@webdesign/db";
import { registerAsset, licensedAssetIds, assetResolver, withdrawAsset, LIMITS } from "../dist/index.js";

// Registro de assets contra la base real: cuota, licencia y retirada.

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de assets omitidas: falta DB de pruebas", { skip: true }, () => {});
  process.exit(0);
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
let pool, sitesRoot;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]);

before(async () => {
  sitesRoot = mkdtempSync(join(tmpdir(), "assets-"));
  const admin = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  const { ensureTestDatabase } = await import("@webdesign/db");
  const url = await ensureTestDatabase(admin, process.env.DB_TEST_URL, "assets");
  await admin.end();
  pool = new pg.Pool({ connectionString: url });
  for (const t of ["sites", "site_members", "site_drafts", "site_versions", "assets", "audit_log", "users", "user_sessions", "schema_migrations"]) {
    await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  await migrate(pool);
  await pool.query(`INSERT INTO users (id, email, name) VALUES ('${OWNER}', 'a@b.co', 'Ana')`);
  await pool.query(`INSERT INTO sites (id, owner_id, name) VALUES ('${SITE}', '${OWNER}', 'Café')`);
});
after(async () => {
  await pool?.end();
  if (sitesRoot) rmSync(sitesRoot, { recursive: true, force: true });
});

const base = { userId: OWNER, siteId: SITE, sitesRoot, source: "own" };

test("un asset valido se guarda con nombre generado", async () => {
  const r = await registerAsset(pool, { ...base, kind: "image", content: PNG, declaredMime: "image/png" });
  assert.equal(r.ok, true);
  assert.match(r.path, /^image\/[0-9a-f-]{36}-[0-9a-f]{12}\.png$/);
  assert.equal(existsSync(join(sitesRoot, SITE, "assets", r.path)), true);
});

test("un archivo cuyo contenido no es imagen no entra, diga lo que diga", async () => {
  const svg = Uint8Array.from("<svg onload=alert(1)>".split("").map((c) => c.charCodeAt(0)));
  const r = await registerAsset(pool, { ...base, kind: "image", content: svg, declaredMime: "image/png" });
  assert.deepEqual(r, { ok: false, reason: "mime_not_allowed" });
});

test("un asset sin licencia existe pero no figura como licenciado", async () => {
  const r = await registerAsset(pool, { ...base, kind: "image", content: JPEG, declaredMime: "image/jpeg" });
  assert.equal(r.ok, true);
  const licensed = await licensedAssetIds(pool, OWNER, SITE);
  assert.equal(licensed.includes(r.id), false);
});

test("un asset de coleccion abierta guarda autor y licencia", async () => {
  const r = await registerAsset(pool, {
    ...base, kind: "image", content: JPEG, declaredMime: "image/jpeg",
    source: "open-collection", license: "CC0-1.0", author: "Anon", sourceUrl: "https://example.org/x",
  });
  assert.equal(r.ok, true);
  const licensed = await licensedAssetIds(pool, OWNER, SITE);
  assert.equal(licensed.includes(r.id), true);
});

test("el resolver entrega la ruta publica y deja fuera lo retirado", async () => {
  const r = await registerAsset(pool, { ...base, kind: "image", content: PNG, declaredMime: "image/png" });
  const resolve = await assetResolver(pool, OWNER, SITE);
  assert.match(resolve(r.id).src, /^\/assets\/image\//);
  await withdrawAsset(pool, OWNER, SITE, r.id);
  assert.equal((await assetResolver(pool, OWNER, SITE))(r.id), undefined);
});

test("pasarse de la cuota del sitio no registra nada", async () => {
  const y = await pool.query("SELECT COALESCE(SUM(bytes),0) AS t FROM assets WHERE site_id = $1", [SITE]);
  const used = Number(y.rows[0].t);
  // Se simula un asset que ya llena la cuota.
  await pool.query(
    `INSERT INTO assets (id, site_id, path, kind, bytes, mime, source)
     VALUES (gen_random_uuid(), $1, 'image/padding.png', 'image', $2, 'image/png', 'own')`,
    [SITE, LIMITS.siteTotalBytes - used],
  );
  const r = await registerAsset(pool, { ...base, kind: "image", content: PNG, declaredMime: "image/png" });
  assert.deepEqual(r, { ok: false, reason: "site_quota_exceeded" });
});
