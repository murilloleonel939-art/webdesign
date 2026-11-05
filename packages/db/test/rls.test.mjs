import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withUser, migrate, ensureTestDatabase } from "../dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de base omitidas: falta DB_TEST_URL o DB_TEST_CONFIRM", { skip: true }, () => {});
  process.exit(0);
}
let DB_URL = process.env.DB_TEST_URL;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
let admin, app;

before(async () => {
  if (!DB_URL) throw new Error("DB_TEST_URL no definida");
  // Cada paquete usa su propia base: migrar y borrar tablas a la vez se pisaria.
  const bootstrap = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  DB_URL = await ensureTestDatabase(bootstrap, process.env.DB_TEST_URL, "db");
  await bootstrap.end();
  admin = new pg.Pool({ connectionString: DB_URL });
  await admin.query("DROP TABLE IF EXISTS sites, site_members, site_drafts, site_versions, assets, audit_log, users, user_sessions, schema_migrations CASCADE");
  await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
  await admin.query("ALTER ROLE app_platform LOGIN PASSWORD 'test'");
  // Se aplican todas las migraciones reales, no una copia: lo que se prueba es lo que corre.
  await migrate(admin);
  await admin.query(`INSERT INTO sites (id, owner_id, name) VALUES
    ('33333333-3333-4333-8333-333333333333', '${A}', 'de A'),
    ('44444444-4444-4444-8444-444444444444', '${B}', 'de B')`);
  app = new pg.Pool({ connectionString: DB_URL.replace(/\/\/[^@]*@/, "//app_platform:test@") });
});
after(async () => { await app?.end(); await admin?.end(); });

test("usuario A solo ve sus sitios", async () => {
  const rows = await withUser(app, A, async (tx) => (await tx.query("SELECT name FROM sites")).rows);
  assert.deepEqual(rows.map((r) => r.name), ["de A"]);
});

test("sin usuario fijado no se ve nada", async () => {
  const { rows } = await app.query("SELECT name FROM sites");
  assert.equal(rows.length, 0);
});

test("no se puede insertar un sitio de otro dueño", async () => {
  await assert.rejects(() =>
    withUser(app, A, (tx) => tx.query("INSERT INTO sites (id, owner_id, name) VALUES ('55555555-5555-4555-8555-555555555555', $1, 'ajeno')", [B]))
  );
});

test("userId inválido se rechaza", async () => {
  await assert.rejects(() => withUser(app, "x'; DROP TABLE sites; --", async () => 1));
});

// --- Fase 1: aislamiento de las tablas de contenido ---

test("el borrador de un sitio ajeno no se ve ni se escribe", async () => {
  await admin.query(`INSERT INTO site_drafts (site_id, rev, doc, doc_hash, updated_by_type)
    VALUES ('44444444-4444-4444-8444-444444444444', 1, '{"schemaVersion":1}'::jsonb, 'h', 'user')`);
  const visible = await withUser(app, A, async (tx) => (await tx.query("SELECT site_id FROM site_drafts")).rows);
  assert.equal(visible.length, 0);
  await assert.rejects(() =>
    withUser(app, A, (tx) =>
      tx.query(`INSERT INTO site_drafts (site_id, rev, doc, doc_hash, updated_by_type)
        VALUES ('44444444-4444-4444-8444-444444444444', 2, '{}'::jsonb, 'h', 'user')`)),
  );
});

test("las versiones publicadas de un sitio ajeno no se ven", async () => {
  await admin.query(`INSERT INTO site_versions (id, site_id, version, schema_version, doc, doc_hash)
    VALUES ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', 1, 1, '{}'::jsonb, 'h')`);
  const rows = await withUser(app, A, async (tx) => (await tx.query("SELECT version FROM site_versions")).rows);
  assert.equal(rows.length, 0);
});

test("los assets ajenos no se ven", async () => {
  await admin.query(`INSERT INTO assets (id, site_id, path, kind, bytes, mime, source, license)
    VALUES ('77777777-7777-4777-8777-777777777777', '44444444-4444-4444-8444-444444444444', 'a/1.webp', 'image', 1000, 'image/webp', 'own', 'MIT')`);
  const rows = await withUser(app, A, async (tx) => (await tx.query("SELECT path FROM assets")).rows);
  assert.equal(rows.length, 0);
});

test("el dueño sí ve su propio assets y su auditoria", async () => {
  await admin.query(`INSERT INTO assets (id, site_id, path, kind, bytes, mime, source)
    VALUES ('88888888-8888-4888-8888-888888888888', '33333333-3333-4333-8333-333333333333', 'a/2.webp', 'image', 10, 'image/webp', 'own')`);
  const rows = await withUser(app, A, async (tx) => (await tx.query("SELECT path FROM assets")).rows);
  assert.deepEqual(rows.map((r) => r.path), ["a/2.webp"]);
  await withUser(app, A, (tx) =>
    tx.query(`INSERT INTO audit_log (id, actor_type, site_id, action) VALUES ('99999999-9999-4999-8999-999999999999', 'user', '33333333-3333-4333-8333-333333333333', 'publish')`));
});

test("la auditoria no se puede modificar ni borrar", async () => {
  await assert.rejects(() => withUser(app, A, (tx) => tx.query("UPDATE audit_log SET action = 'x'")));
  await assert.rejects(() => withUser(app, A, (tx) => tx.query("DELETE FROM audit_log")));
});

test("una cuenta no puede tener dos sitios publicados", async () => {
  await admin.query("UPDATE sites SET status = 'active' WHERE id = '33333333-3333-4333-8333-333333333333'");
  await assert.rejects(() =>
    admin.query(`INSERT INTO sites (id, owner_id, name, status)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${A}', 'segundo', 'active')`));
});
