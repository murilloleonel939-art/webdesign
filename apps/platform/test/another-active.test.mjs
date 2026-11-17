import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate, ensureTestDatabase } from "@webdesign/db";
import { createApp } from "../dist/server.js";

// Spec 1.15: un solo sitio publicado por cuenta. Cuando el dueno ya tenia uno
// `active` y publicaba otro, el UPDATE chocaba con el indice parcial
// sites_one_active_per_owner (23505); el throw subia por el handler async, Node
// mataba el proceso y el proxy devolvia 502. Lo que se exige aqui es doble:
// 409 con el motivo, y que el servidor siga vivo despues (aqui y en produccion).

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de sitio activo omitidas: falta DB de pruebas", { skip: true }, () => {});
  process.exit(0);
}

let pool, appPool, server, port, sitesRoot, cookie;
let firstSite, secondSite;

const call = (method, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: {
        host: "panel.example.com",
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...(cookie ? { cookie } : {}),
      } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

const siteDoc = (headline, name) => ({
  schemaVersion: 1,
  meta: { name, lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: { colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 160 }, radius: "square" },
  pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "Bienvenido", noindex: false },
    sections: [{ id: "s_hero", type: "hero", props: { headline } }] }],
  assets: [],
});

before(async () => {
  sitesRoot = mkdtempSync(join(tmpdir(), "sites-active-"));
  const admin = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  const url = await ensureTestDatabase(admin, process.env.DB_TEST_URL, "platform_active");
  await admin.end();
  pool = new pg.Pool({ connectionString: url });
  for (const t of ["sites", "site_members", "site_drafts", "site_versions", "assets", "audit_log", "users", "user_sessions", "domains", "site_domain_pool", "reserved_subdomains", "schema_migrations"]) {
    await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  await migrate(pool);
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
  await pool.query("ALTER ROLE app_platform LOGIN PASSWORD 'test'");
  appPool = new pg.Pool({ connectionString: url.replace(/\/\/[^@]*@/, "//app_platform:test@") });
  server = createApp({ pool: appPool, sitesRoot });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;

  const { createUser, startSession } = await import("../dist/api.js");
  const userId = await createUser(pool, "ana@example.com", "Ana", "contrasena-larga");
  cookie = `sid=${await startSession(pool, userId)}`;

  const a = await call("POST", "/api/sites", { name: "Café Central" });
  assert.equal(a.status, 201);
  firstSite = a.json.id;
  await call("PUT", `/api/sites/${firstSite}/draft`, { doc: siteDoc("Hola", "Café Central"), expectedRev: 0 });

  const b = await call("POST", "/api/sites", { name: "Café Segundo" });
  assert.equal(b.status, 201);
  secondSite = b.json.id;
  await call("PUT", `/api/sites/${secondSite}/draft`, { doc: siteDoc("Adiós", "Café Segundo"), expectedRev: 0 });
});

after(async () => {
  server?.close();
  await appPool?.end();
  await pool?.end();
  if (sitesRoot) rmSync(sitesRoot, { recursive: true, force: true });
});

test("the first site publishes", async () => {
  const r = await call("POST", `/api/sites/${firstSite}/publish`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.version, 1);
});

test("publishing a second site answers 409 another_site_active, never 500", async () => {
  const r = await call("POST", `/api/sites/${secondSite}/publish`, {});
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "another_site_active");
  // El panel necesita el nombre para decir QUE sitio ocupa el turno y ofrecer
  // despublicarlo; sin el, el aviso no se puede accionar.
  assert.equal(r.json.activeSiteId, firstSite);
  assert.equal(r.json.activeSiteName, "Café Central");
});

test("the server is still alive after the blocked publish", async () => {
  // Esto es el sintoma real que se estaba viendo: el proceso moria y el proxy
  // devolvia 502 al resto de clientes. Si el throw hubiera matado el proceso,
  // esta peticion no tendria con quien hablar.
  const r = await call("GET", "/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: "ok" });
});

test("the blocked publish wrote nothing: no release, no version row", async () => {
  const versions = await pool.query("SELECT version FROM site_versions WHERE site_id = $1", [secondSite]);
  assert.equal(versions.rowCount, 0);
  const site = await pool.query("SELECT status FROM sites WHERE id = $1", [secondSite]);
  assert.equal(site.rows[0].status, "draft");
});

test("unpublish is idempotent and writes audit on the first call only", async () => {
  const first = await call("POST", `/api/sites/${firstSite}/unpublish`, {});
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { ok: true });
  const again = await call("POST", `/api/sites/${firstSite}/unpublish`, {});
  assert.equal(again.status, 200);
  const rows = await pool.query("SELECT action FROM audit_log WHERE action = 'site.unpublish' AND site_id = $1", [firstSite]);
  assert.equal(rows.rowCount, 1);
  // Despublicar no borra: la release y su fila de version siguen ahi.
  const kept = await pool.query("SELECT version FROM site_versions WHERE site_id = $1", [firstSite]);
  assert.equal(kept.rowCount, 1);
});

test("after unpublishing the first, the second publishes fine", async () => {
  const r = await call("POST", `/api/sites/${secondSite}/publish`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.version, 1);
  const site = await pool.query("SELECT status FROM sites WHERE id = $1", [secondSite]);
  assert.equal(site.rows[0].status, "active");
});

test("a foreign site cannot be unpublished: 404", async () => {
  const { createUser, startSession } = await import("../dist/api.js");
  const other = await startSession(pool, await createUser(pool, "luis@example.com", "Luis", "otra-contrasena"));
  const saved = cookie;
  cookie = `sid=${other}`;
  try {
    assert.equal((await call("POST", `/api/sites/${secondSite}/unpublish`, {})).status, 404);
  } finally {
    cookie = saved;
  }
});
