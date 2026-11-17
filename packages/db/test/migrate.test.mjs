import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de base omitidas: falta DB_TEST_URL o DB_TEST_CONFIRM", { skip: true }, () => {});
  process.exit(0);
}
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const pool = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
after(() => pool.end());

test("applies migrations once and is idempotent", async () => {
  await pool.query("DROP TABLE IF EXISTS sites, site_members, site_drafts, site_versions, assets, audit_log, users, schema_migrations CASCADE");
  // Las migraciones se aplican todas, en orden y sin saltarse ninguna. La lista
  // se deriva del disco a proposito: escribirla a mano la dejo desfasada desde
  // la 0008 y, como esta prueba se salta sin base de datos, nada lo delato.
  const enDisco = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const first = await migrate(pool);
  assert.deepEqual(first, enDisco);
  const second = await migrate(pool);
  assert.deepEqual(second, []);
  const { rows } = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'sites'");
  assert.deepEqual(rows[0], { relrowsecurity: true, relforcerowsecurity: true });
  // Toda tabla con datos de sitio lleva RLS forzado.
  const forced = await pool.query(
    "SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity ORDER BY relname",
    [["assets", "audit_log", "site_drafts", "site_members", "site_versions", "sites", "user_sessions", "users"]],
  );
  assert.deepEqual(forced.rows.map((r) => r.relname), ["assets", "audit_log", "site_drafts", "site_members", "site_versions", "sites", "user_sessions", "users"]);

  // El catalogo de diseno (spec 7.5) es lo contrario: datos globales de producto,
  // sin RLS. Si alguien le pusiera RLS forzado, el agente dejaria de ver el
  // catalogo y las recomendaciones saldrian vacias sin ningun error visible.
  const catalogo = await pool.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname",
    [["design_antipatterns", "design_font_pairings", "design_landing_patterns", "design_palettes", "design_product_types", "design_styles", "design_ux_rules"]],
  );
  assert.deepEqual(catalogo.rows.map((r) => r.relname), ["design_antipatterns", "design_font_pairings", "design_landing_patterns", "design_palettes", "design_product_types", "design_styles", "design_ux_rules"]);
  assert.equal(catalogo.rows.every((r) => r.relrowsecurity === false), true);

  // Toda fila del catalogo puede decir de donde salio y con que licencia (7.7.1).
  for (const t of ["design_product_types", "design_palettes", "design_font_pairings", "design_landing_patterns", "design_ux_rules", "design_antipatterns", "design_styles"]) {
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [t]);
    const nombres = cols.rows.map((r) => r.column_name);
    for (const c of ["source", "license", "verified_at", "status"]) {
      assert.equal(nombres.includes(c), true, `${t} no tiene ${c}`);
    }
  }
});
