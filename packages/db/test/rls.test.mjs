import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { withUser } from "../dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db") {
  throw new Error("Las pruebas borran tablas: define DB_TEST_CONFIRM=destroy-test-db solo contra una base de pruebas");
}
const DB_URL = process.env.DB_TEST_URL;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
let admin, app;

before(async () => {
  if (!DB_URL) throw new Error("DB_TEST_URL no definida");
  admin = new pg.Pool({ connectionString: DB_URL });
  await admin.query("DROP TABLE IF EXISTS sites");
  await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
  await admin.query("ALTER ROLE app_platform LOGIN PASSWORD 'test'");
  await admin.query(readFileSync(new URL("../migrations/0001_sites_rls.sql", import.meta.url), "utf8"));
  await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_platform");
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
