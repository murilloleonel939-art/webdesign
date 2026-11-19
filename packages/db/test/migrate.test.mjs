import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
  // El rol de la plataforma tiene que existir ANTES de migrar: las migraciones
  // solo conceden permisos si lo encuentran (`IF EXISTS ... pg_roles`), asi que
  // creandolo despues el assert de EXECUTE pasaria por el motivo equivocado.
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
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

  // Las dos comprobaciones publicas de 0019 son SECURITY DEFINER y solo las
  // puede ejecutar la plataforma. Si alguien las recreara sin `REVOKE ... FROM
  // PUBLIC`, cualquiera con conexion leeria el conteo de leads de un sitio
  // ajeno: es justo lo que este bloque vigila.
  const funciones = await pool.query(
    `SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY p.proname`,
    [["app_lead_recent_count", "app_public_asset_visible"]],
  );
  assert.deepEqual(funciones.rows.map((r) => r.proname), ["app_lead_recent_count", "app_public_asset_visible"]);
  for (const f of funciones.rows) {
    assert.equal(f.prosecdef, true, `${f.proname} no es SECURITY DEFINER`);
    // STABLE: 's'. Una VOLATILE dasa el conteo por bueno dentro de la transaccion.
    assert.equal(f.provolatile, "s", `${f.proname} no es STABLE`);
    // search_path fijo: sin el, la sesion del llamante puede anteponer un esquema.
    assert.equal((f.proconfig ?? []).some((c) => c.startsWith("search_path=")), true, `${f.proname} sin search_path fijo`);
  }
  // `proacl` y no `has_function_privilege('public', ...)`: PUBLIC es un
  // pseudorol y no un nombre de rol que esa funcion resuelva. La entrada de
  // PUBLIC en el ACL se escribe sin destinatario (`=X/duenno`); tras el REVOKE
  // solo debe quedar `app_platform=X/duenno`.
  const permisos = await pool.query(
    `SELECT p.proname, p.proacl::text AS acl,
            has_function_privilege('app_platform', p.oid, 'EXECUTE') AS plataforma
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY p.proname`,
    [["app_lead_recent_count", "app_public_asset_visible"]],
  );
  assert.deepEqual(permisos.rows.map((r) => r.proname), ["app_lead_recent_count", "app_public_asset_visible"]);
  for (const p of permisos.rows) {
    assert.equal(p.plataforma, true, `app_platform no puede ejecutar ${p.proname}`);
    assert.match(p.acl ?? "", /app_platform=X\//, `${p.proname} sin GRANT a app_platform`);
    // PUBLIC como destinatario: el ACL va entre llaves y esa entrada se escribe
    // sin nombre delante, asi que puede ir tras `{` o tras una coma.
    assert.equal(/(?:[{,])=X\//.test(p.acl ?? ""), false, `${p.proname} sigue abierta a PUBLIC`);
  }
});

// 0021 existe porque las migraciones viejas conceden permisos dentro de bloques
// condicionados a que el rol exista: si no existia, el GRANT se saltaba en
// silencio y el permiso no se volvia a pedir nunca. Esta prueba aplica el
// archivo dos veces seguidas, que es lo que pasara en produccion cuando ya este
// aplicada y alguien lo relance a mano para reparar.
test("0021 se aplica dos veces y el permiso sigue concedido", async () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, "0021_regrant_app_tables.sql"), "utf8");
  await pool.query(sql);
  // La segunda no rompe: no crea nada, solo repite GRANT y recomprueba.
  await pool.query(sql);

  const { rows } = await pool.query(
    `SELECT t AS tabla,
            has_table_privilege('app_platform', t, 'SELECT') AS sel,
            has_table_privilege('app_platform', t, 'INSERT') AS ins,
            has_table_privilege('app_platform', t, 'UPDATE') AS upd,
            has_table_privilege('app_platform', t, 'DELETE') AS del
     FROM unnest($1::text[]) AS t ORDER BY t`,
    [["assets", "site_drafts", "site_members", "site_versions", "users", "sites", "user_sessions"]],
  );
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.equal(r.sel && r.ins && r.upd && r.del, true, `app_platform sin permisos sobre ${r.tabla} tras 0021`);
  }
  // audit_log es la excepcion: se lee y se escribe, pero no se modifica ni se
  // borra nunca desde la aplicacion.
  const { rows: audit } = await pool.query(
    `SELECT has_table_privilege('app_platform', 'audit_log', 'SELECT,INSERT') AS ok,
            has_table_privilege('app_platform', 'audit_log', 'UPDATE') AS modifica`,
  );
  assert.deepEqual(audit[0], { ok: true, modifica: false });
});
