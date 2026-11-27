import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withUser, migrate, ensureTestDatabase } from "../dist/index.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  // Solo el caso saltado: sin `process.exit`, que mataba al runner antes de
  // contabilizarlo, y sin arrancar nada del resto del archivo (pools, hooks).
  test("pruebas de base omitidas: falta DB_TEST_URL o DB_TEST_CONFIRM", { skip: true }, () => {});
} else {
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

  // --- La política del gateway (0024) ---------------------------------------
  //
  // El gateway suma tokens mientras la fila está en 'running': con el
  // `WITH CHECK` de 0015 (que solo pensaba en el cierre) ese UPDATE violaba RLS
  // con 42501 y tumbaba el proceso. Aquí se comprueban las DOS condiciones: que
  // una ejecución viva se pueda actualizar y que una cerrada NO se pueda ni
  // reabrir ni volver a contar.

  test("la política del gateway deja contar en vivo y no permite reabrir una cerrada", async () => {
    const { rows } = await admin.query(
      "SELECT qual, with_check FROM pg_policies WHERE tablename = 'agent_runs' AND policyname = 'agent_runs_gateway_update'",
    );
    assert.equal(rows.length, 1, "la política existe");
    // `qual` es el USING: solo filas vivas. `with_check`: coherencia de la fila
    // resultante. `pg_get_expr` depara la expresión, así que se compara sin
    // depender de los paréntesis.
    const usando = String(rows[0].qual).replace(/\s+/g, " ");
    const check = String(rows[0].with_check).replace(/\s+/g, " ");
    assert.match(usando, /status = 'running'/);
    assert.doesNotMatch(usando, /^true$/i, "USING (true) permitiría reabrir ejecuciones cerradas");

    // Viva: sin motivo de parada ni fecha de cierre.
    assert.match(check, /status = 'running'/);
    assert.match(check, /stop_reason IS NULL/);
    assert.match(check, /ended_at IS NULL/);
    // Cerrada: con fecha de cierre.
    assert.match(check, /status <> 'running'/);
    assert.match(check, /ended_at IS NOT NULL/);
    // Y ya no es la lista suelta de estados: eso permitía una fila 'running' con
    // `ended_at` puesto.
    assert.doesNotMatch(check, /status = ANY/, "el CHECK no puede ser solo la lista de estados");
  });

  test("con el rol del gateway: la ejecución viva se actualiza y la cerrada no", async () => {
    // `app_llm_gateway` lo crea 0015 LOGIN pero sin contraseña, así que no se
    // puede autenticar tal cual. Se le pone una para esta prueba y se conecta
    // como él por TCP, igual que `before` hace con `app_platform`: así el SQL
    // corre con los privilegios y las políticas REALES del servicio.
    await admin.query("ALTER ROLE app_llm_gateway LOGIN PASSWORD 'test'");
    const gw = new pg.Pool({ connectionString: DB_URL.replace(/\/\/[^@]*@/, "//app_llm_gateway:test@") });
    const uid = "66666666-6666-4666-8666-666666666666";
    const sid = "77777777-7777-4777-8777-777777777777";
    const run = "88888888-8888-4888-8888-888888888888";
    try {
      // Filas de las que depende `agent_runs`: el dueño (`user_id` tiene FK) y
      // su sitio. `agent_id` y `prompt_tokens_max` son NOT NULL; `status` cae en
      // su valor por defecto, 'running'.
      await admin.query("INSERT INTO users (id, email, name) VALUES ($1, 'gateway-test@example.test', 'Gateway Test')", [uid]);
      await admin.query("INSERT INTO sites (id, owner_id, name) VALUES ($1, $2, 'del gateway')", [sid, uid]);
      await admin.query(
        "INSERT INTO agent_runs (id, agent_id, user_id, site_id, prompt_tokens_max) VALUES ($1, 'design', $2, $3, 1000)",
        [run, uid, sid],
      );

      // (a) Viva: sumar tokens funciona. Era el caso que rompía la producción.
      const vivo = await gw.query("UPDATE agent_runs SET tokens_in = tokens_in + 5 WHERE id = $1::uuid", [run]);
      assert.equal(vivo.rowCount, 1, "una ejecución en marcha se puede contar");

      // Cerrarla también: es el otro camino del gateway.
      const cierre = await gw.query(
        "UPDATE agent_runs SET status = 'budget_exhausted', stop_reason = 'tokens', ended_at = now() WHERE id = $1::uuid",
        [run],
      );
      assert.equal(cierre.rowCount, 1, "una ejecución en marcha se puede cerrar");

      // (b) Cerrada: NO se puede reabrir (esto es lo que protege el USING).
      const reabrir = await gw.query("UPDATE agent_runs SET status = 'running' WHERE id = $1::uuid", [run]);
      assert.equal(reabrir.rowCount, 0, "una ejecución cerrada no se reabre");

      // (c) Ni volver a contarla.
      const contar = await gw.query("UPDATE agent_runs SET tokens_in = tokens_in + 9 WHERE id = $1::uuid", [run]);
      assert.equal(contar.rowCount, 0, "una ejecución cerrada no admite más tokens");

      // Y la fila quedó como estaba: cerrada y con los 5 tokens de antes.
      const { rows } = await admin.query("SELECT status, tokens_in FROM agent_runs WHERE id = $1::uuid", [run]);
      assert.equal(rows[0].status, "budget_exhausted");
      assert.equal(rows[0].tokens_in, 5);
    } finally {
      await admin.query("DELETE FROM agent_runs WHERE id = $1::uuid", [run]).catch(() => {});
      await admin.query("DELETE FROM sites WHERE id = $1::uuid", [sid]).catch(() => {});
      await admin.query("DELETE FROM users WHERE id = $1::uuid", [uid]).catch(() => {});
      // Los roles son del CLÚSTER, no de la base: `DB_TEST_CONFIRM` protege la
      // base de pruebas, no el clúster, así que dejarlo con contraseña la
      // pondría también en el rol real del gateway. Se devuelve a como lo dejó
      // 0015 (sin contraseña) ANTES de cerrar el pool: si `gw.end()` fallara, el
      // `ALTER` tiene que haberse ejecutado igual.
      try {
        await admin.query("ALTER ROLE app_llm_gateway PASSWORD NULL");
      } catch (error) {
        // Se registra y se sigue: no puede tapar el error original de la prueba,
        // pero tampoco se oculta que el rol quedó con contraseña puesta.
        process.stderr.write(`rls.test: no se pudo limpiar la contraseña de app_llm_gateway: ${String(error?.message ?? error)}\n`);
      }
      await gw.end();
    }
  });
}

// El resto del archivo solo corre con base de pruebas: sin `DB_TEST_URL` y
// `DB_TEST_CONFIRM` los tres casos de arriba se saltan (el aviso de arriba).
