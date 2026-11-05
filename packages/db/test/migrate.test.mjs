import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de base omitidas: falta DB_TEST_URL o DB_TEST_CONFIRM", { skip: true }, () => {});
  process.exit(0);
}
const pool = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
after(() => pool.end());

test("applies migrations once and is idempotent", async () => {
  await pool.query("DROP TABLE IF EXISTS sites, site_members, site_drafts, site_versions, assets, audit_log, users, schema_migrations CASCADE");
  const first = await migrate(pool);
  // Cada migracion nueva se agrega aqui: el orden importa y no se salta ninguna.
  assert.deepEqual(first, ["0001_sites_rls.sql", "0002_app_role.sql", "0003_site_content_rls.sql"]);
  const second = await migrate(pool);
  assert.deepEqual(second, []);
  const { rows } = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'sites'");
  assert.deepEqual(rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  // Toda tabla con datos de sitio lleva RLS forzado.
  const forced = await pool.query(
    "SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY relname",
    [["assets", "audit_log", "site_drafts", "site_members", "site_versions", "sites", "users"]],
  );
  assert.deepEqual(forced.rows.map((r) => r.relname), ["assets", "audit_log", "site_drafts", "site_members", "site_versions", "sites", "users"]);
});
