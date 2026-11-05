import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../dist/index.js";

const pool = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
after(() => pool.end());

test("applies migrations once and is idempotent", async () => {
  await pool.query("DROP TABLE IF EXISTS sites, schema_migrations");
  const first = await migrate(pool);
  assert.deepEqual(first, ["0001_sites_rls.sql", "0002_app_role.sql"]);
  const second = await migrate(pool);
  assert.deepEqual(second, []);
  const { rows } = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'sites'");
  assert.deepEqual(rows[0], { relrowsecurity: true, relforcerowsecurity: true });
});
