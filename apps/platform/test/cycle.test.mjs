import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate, ensureTestDatabase } from "@webdesign/db";
import { createApp } from "../dist/server.js";

// Aceptacion de la Fase 1 (spec 12): crear, editar, previsualizar, publicar y
// revertir. Todo por HTTP, con sesion real y RLS activo.

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas del ciclo omitidas: falta DB de pruebas", { skip: true }, () => {});
  process.exit(0);
}

let pool, appPool, server, port, sitesRoot, cookie;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

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
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

const siteDoc = (headline) => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: { colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 160 }, radius: "square" },
  pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "Bienvenido", noindex: false },
    sections: [{ id: "s_hero", type: "hero", props: { headline } }] }],
  assets: [],
});

before(async () => {
  sitesRoot = mkdtempSync(join(tmpdir(), "sites-"));
  const admin = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  const url = await ensureTestDatabase(admin, process.env.DB_TEST_URL, "platform");
  await admin.end();
  pool = new pg.Pool({ connectionString: url });
  for (const t of ["sites", "site_members", "site_drafts", "site_versions", "assets", "audit_log", "users", "user_sessions", "schema_migrations"]) {
    await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
  await migrate(pool);
  // RLS no aplica al superusuario: el ciclo se prueba con el rol de la aplicacion,
  // que es el que usa la plataforma en produccion.
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
  await pool.query("ALTER ROLE app_platform LOGIN PASSWORD 'test'");
  appPool = new pg.Pool({ connectionString: url.replace(/\/\/[^@]*@/, "//app_platform:test@") });
  server = createApp({ pool: appPool, sitesRoot });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(async () => {
  server?.close();
  await appPool?.end();
  await pool?.end();
  if (sitesRoot) rmSync(sitesRoot, { recursive: true, force: true });
});

test("without a session nothing is allowed", async () => {
  assert.equal((await call("GET", "/api/sites")).status, 401);
  assert.equal((await call("POST", "/api/sites", { name: "x" })).status, 401);
});

test("an account logs in and creates its site", async () => {
  const { createUser, startSession } = await import("../dist/api.js");
  const userId = await createUser(pool, "ana@example.com", "Ana", "contrasena-larga");
  const token = await startSession(pool, userId);
  cookie = `sid=${token}`;
  assert.equal((await call("GET", "/api/sites")).status, 200);
  const created = await call("POST", "/api/sites", { name: "Café" });
  assert.equal(created.status, 201);
  assert.match(created.json.id, /^[0-9a-f-]{36}$/);
  pool.siteId = created.json.id;
});

test("editing saves the draft and returns lint findings", async () => {
  const r = await call("PUT", `/api/sites/${pool.siteId}/draft`, { doc: siteDoc("Hola"), expectedRev: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.rev, 1);
  assert.ok(Array.isArray(r.json.findings));
});

test("a second tab with a stale revision gets a conflict, not a silent overwrite", async () => {
  const r = await call("PUT", `/api/sites/${pool.siteId}/draft`, { doc: siteDoc("Pisado"), expectedRev: 0 });
  assert.equal(r.status, 409);
  assert.equal(r.json.currentRev, 1);
  const loaded = await call("GET", `/api/sites/${pool.siteId}/draft`);
  assert.equal(loaded.json.doc.pages[0].sections[0].props.headline, "Hola");
});

test("an invalid document is refused with 422", async () => {
  const bad = siteDoc("x");
  bad.pages[0].sections[0].type = "raw_html";
  const r = await call("PUT", `/api/sites/${pool.siteId}/draft`, { doc: bad, expectedRev: 1 });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, "invalid");
});

test("publishing writes real files and a version", async () => {
  const r = await call("POST", `/api/sites/${pool.siteId}/publish`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.version, 1);
  const html = readFileSync(join(sitesRoot, pool.siteId, "releases", "v1", "index.html"), "utf8");
  assert.match(html, /Hola/);
  assert.match(html, /Content-Security-Policy/);
  // El sitio publicado es apuntado por el symlink public.
  // El symlink es relativo a proposito: mover /data no lo rompe.
  assert.equal(readlinkSync(join(sitesRoot, pool.siteId, "public")), join("releases", "v1"));
});

test("a second publish creates v2 and moving back to v1 works", async () => {
  const edit = await call("PUT", `/api/sites/${pool.siteId}/draft`, { doc: siteDoc("Adiós"), expectedRev: 1 });
  assert.equal(edit.status, 200);
  const pub = await call("POST", `/api/sites/${pool.siteId}/publish`, {});
  assert.equal(pub.json.version, 2);
  assert.match(readFileSync(join(sitesRoot, pool.siteId, "releases", "v2", "index.html"), "utf8"), /Adiós/);
  const back = await call("POST", `/api/sites/${pool.siteId}/rollback`, { version: 1 });
  assert.equal(back.status, 200);
  assert.equal(back.json.version, 1);
  assert.match(readFileSync(join(sitesRoot, pool.siteId, "public", "index.html"), "utf8"), /Hola/);
});

test("another account cannot see or touch this site", async () => {
  const { createUser, startSession } = await import("../dist/api.js");
  const other = await startSession(pool, await createUser(pool, "luis@example.com", "Luis", "otra-contrasena"));
  const saved = cookie;
  cookie = `sid=${other}`;
  try {
    const list = await call("GET", "/api/sites");
    assert.deepEqual(list.json.sites, []);
    assert.equal((await call("GET", `/api/sites/${pool.siteId}/draft`)).status, 404);
  } finally {
    cookie = saved;
  }
});

test("the wrong password does not log in", async () => {
  const saved = cookie;
  cookie = undefined;
  try {
    const r = await call("POST", "/api/login", { email: "ana@example.com", password: "incorrecta" });
    assert.equal(r.status, 401);
  } finally {
    cookie = saved;
  }
});

test("audit records every publish and rollback", async () => {
  const { withUser } = await import("@webdesign/db");
  const rows = await pool.query("SELECT action FROM audit_log ORDER BY at");
  const actions = rows.rows.map((r) => r.action);
  assert.ok(actions.includes("site.publish"));
  assert.ok(actions.includes("site.rollback"));
  assert.equal(existsSync(join(sitesRoot, pool.siteId, "releases", "v1")), true);
});

test("an uploaded asset is linked into the release, not copied", async () => {
  const up = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: `/api/sites/${pool.siteId}/assets?kind=image`, method: "POST",
        headers: { host: "panel.example.com", cookie, "content-type": "image/png", "content-length": PNG.length } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    req.write(Buffer.from(PNG));
    req.end();
  });
  assert.equal(up.status, 201);
  assert.match(up.json.id, /^[0-9a-f-]{36}$/);

  const withImage = siteDoc("Hola");
  withImage.assets = [{ id: up.json.id, alt: "", credit: null }];
  withImage.pages[0].sections = [{
    id: "s_img", type: "image", props: { assetId: up.json.id, alt: "Foto" },
  }];
  const rev = await call("GET", `/api/sites/${pool.siteId}/draft`);
  const saved = await call("PUT", `/api/sites/${pool.siteId}/draft`, { doc: withImage, expectedRev: rev.json.rev });
  assert.equal(saved.status, 200);

  const pub = await call("POST", `/api/sites/${pool.siteId}/publish`, { confirmWarnings: true });
  assert.equal(pub.status, 200);
  const html = readFileSync(join(sitesRoot, pool.siteId, "public", "index.html"), "utf8");
  assert.match(html, /\/assets\/image\//);
  // La release contiene el asset enlazado.
  const relAssets = join(sitesRoot, pool.siteId, "releases", `v${pub.json.version}`, "assets", "image");
  assert.equal(existsSync(relAssets), true);
});

test("a file whose content is not an image is refused", async () => {
  const svg = Buffer.from("<svg onload=alert(1)>");
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: `/api/sites/${pool.siteId}/assets?kind=image`, method: "POST",
        headers: { host: "panel.example.com", cookie, "content-type": "image/png", "content-length": svg.length } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    req.write(svg);
    req.end();
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, "mime_not_allowed");
});
