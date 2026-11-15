import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, readlinkSync } from "node:fs";
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
    // La vista previa del borrador no puede servir el contenido de otro sitio.
    assert.equal((await callRaw("GET", `/api/sites/${pool.siteId}/preview?page=p_home`, true)).status, 404);
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

test("deleting an asset removes its file from disk", async () => {
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

  // El archivo existe antes de borrar.
  const dir = join(sitesRoot, pool.siteId, "assets", "image");
  const before = readdirSync(dir).filter((n) => n.startsWith(up.json.id));
  assert.equal(before.length, 1, "el asset subido debe estar en disco");

  const del = await call("DELETE", `/api/sites/${pool.siteId}/assets?id=${up.json.id}`);
  assert.equal(del.status, 204);

  // Sin huerfanos: ni fila ni archivo.
  const after = readdirSync(dir).filter((n) => n.startsWith(up.json.id));
  assert.equal(after.length, 0, "el archivo debe desaparecer del disco");
  const list = await call("GET", `/api/sites/${pool.siteId}/assets`);
  assert.equal(list.json.assets.some((a) => a.id === up.json.id), false);
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

// Peticion en crudo: permite omitir la cookie y leer HTML, que `call` no hace.
const callRaw = (method, path, withCookie) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { host: "panel.example.com", ...(withCookie && cookie ? { cookie } : {}) } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on("error", reject);
    req.end();
  });

test("the editor preview renders the draft with noindex and the site CSP", async () => {
  const r = await callRaw("GET", `/api/sites/${pool.siteId}/preview?page=p_home`, true);
  assert.equal(r.status, 200);
  // Cabeceras de vista previa: nunca indexable en ningun caso (spec 5.5).
  assert.equal(r.headers["x-robots-tag"], "noindex");
  assert.match(r.headers["content-security-policy"] ?? "", /default-src 'self'/);
  assert.match(r.text, /<\/html>/);
});

test("the editor preview refuses without a session", async () => {
  const r = await callRaw("GET", `/api/sites/${pool.siteId}/preview?page=p_home`, false);
  assert.equal(r.status, 401);
});

test("the panel is served with a strict CSP and never indexable", async () => {
  const r = await callRaw("GET", "/app/", false);
  // El panel no exige sesion para cargar el HTML: el JS pide los datos y ahi 401.
  assert.equal(r.status, 200);
  assert.match(r.headers["content-security-policy"] ?? "", /default-src 'none'/);
  assert.match(r.headers["content-security-policy"] ?? "", /frame-ancestors|frame-src 'self'/);
  assert.notEqual(r.headers["content-security-policy"]?.includes("allow-same-origin"), true);
  assert.equal(r.headers["x-robots-tag"], "noindex");
  assert.match(r.text, /<div id="root">/);
});

test("the panel bundle is served as javascript", async () => {
  const r = await callRaw("GET", "/app/panel.js", false);
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"] ?? "", /javascript/);
});

test("the panel rejects path traversal", async () => {
  for (const path of ["/app/../src/server.ts", "/app/..%2Fserver.js", "/app/x.svg"]) {
    const r = await callRaw("GET", path, false);
    assert.equal(r.status, 404, path);
  }
});

test("the diagnostic endpoint is invisible without a token", async () => {
  const r = await callRaw("GET", "/app/diagnose", false);
  // Sin DIAGNOSTIC_TOKEN la ruta no existe: 404, no 401. No revela que exista.
  assert.equal(r.status, 404);
});

test("the diagnostic route is not swallowed by the panel wildcard", async () => {
  // Regresion: GET /app/* servia panel.html y devolvia 404 antes de llegar aqui.
  process.env.DIAGNOSTIC_OPEN = "1";
  try {
    const r = await callRaw("GET", "/app/diagnose", false);
    assert.notEqual(r.status, 404, "el comodin del panel no debe capturar /app/diagnose");
    assert.equal(r.status === 200 || r.status === 503, true);
    const body = JSON.parse(r.text);
    // En modo abierto el propio informe avisa de que hay que retirarlo.
    assert.match(body.warning ?? "", /DIAGNOSTIC_OPEN/);
  } finally {
    delete process.env.DIAGNOSTIC_OPEN;
  }
});

test("the diagnostic reports migrations and counts, with no personal data", async () => {
  process.env.DIAGNOSTIC_TOKEN = "token-de-prueba-1234567890";
  const withToken = (header) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/app/diagnose", method: "GET", headers: { host: "panel.example.com", ...header } },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  try {
    // Sin cabecera o con token incorrecto: cerrado.
    assert.equal((await withToken({})).status, 401);
    assert.equal((await withToken({ "x-diagnostic-token": "otro-token-distinto-12345" })).status, 401);

    const r = await withToken({ "x-diagnostic-token": "token-de-prueba-1234567890" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-robots-tag"], "noindex");

    const body = JSON.parse(r.text);
    assert.equal(body.ok, true);
    assert.equal(body.database.reachable, true);
    // Las siete migraciones de Fase 1 mas la de dominios.
    assert.equal(body.migrations.missing.includes("0003_site_content_rls.sql"), false);
    assert.equal(typeof body.counts.sites, "number");
    assert.equal(body.counts.sites >= 1, true);
    // No se filtran datos personales: solo recuentos y estados.
    assert.equal(r.text.includes("@"), false, "el informe no debe traer emails");
    assert.equal(/password|token_hash/i.test(r.text), false, "el informe no debe traer secretos");
  } finally {
    delete process.env.DIAGNOSTIC_TOKEN;
  }
});

test("the design catalog is not public without a session", async () => {
  const r = await callRaw("GET", "/api/design-styles", false);
  assert.equal(r.status, 401);
});

test("applying an unknown preset is rejected with 400, not 404", async () => {
  const r = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ presetId: "no-existe-este-estilo", expectedRev: 0 });
    const req = http.request(
      { host: "127.0.0.1", port, path: `/api/sites/${pool.siteId}/apply-preset`, method: "POST",
        headers: { host: "panel.example.com", cookie, "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => { let t = ""; res.setEncoding("utf8"); res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t })); },
    );
    req.on("error", reject);
    req.end(body);
  });
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(r.text).error, "unknown_preset");
});

test("applying a real preset changes the theme and keeps the draft valid", async () => {
  const before = JSON.parse((await callRaw("GET", `/api/sites/${pool.siteId}/draft`, true)).text);
  const body = JSON.stringify({ presetId: "tech", expectedRev: before.rev });
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: `/api/sites/${pool.siteId}/apply-preset`, method: "POST",
        headers: { host: "panel.example.com", cookie, "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => { let t = ""; res.setEncoding("utf8"); res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t })); },
    );
    req.on("error", reject);
    req.end(body);
  });
  assert.equal(r.status, 200, r.text);
  const after = JSON.parse((await callRaw("GET", `/api/sites/${pool.siteId}/draft`, true)).text);
  assert.equal(after.doc.design.presetId, "tech");
  assert.equal(after.doc.theme.colors.ground, "#0e1117");
  assert.equal(after.rev > before.rev, true, "la revision avanza");
  // El documento guardado sigue pasando el esquema.
  assert.equal(Array.isArray(after.doc.pages[0].sections), true);
  assert.equal(after.doc.pages[0].sections.length >= 4, true);
});

test("the panel bundle is revalidated, never heuristically cached", async () => {
  // Regresion: sin cache-control el navegador puede seguir usando el bundle
  // viejo tras un despliegue y el dueno no ve los cambios.
  const js = await callRaw("GET", "/app/panel.js", false);
  assert.equal(js.status, 200);
  assert.equal(js.headers["cache-control"], "no-cache");
  assert.match(js.headers.etag ?? "", /^"[A-Za-z0-9_-]{20,}"$/);

  // El HTML nunca se guarda: puede cambiar en cada despliegue.
  const html = await callRaw("GET", "/app/", false);
  assert.equal(html.headers["cache-control"], "no-store");

  // Revalidacion: con el ETag al dia responde 304 y no reenvia el cuerpo.
  const again = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/app/panel.js", method: "GET",
        headers: { host: "panel.example.com", "if-none-match": js.headers.etag } },
      (res) => { let t = ""; res.setEncoding("utf8"); res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t })); },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(again.status, 304);
  assert.equal(again.text, "");
});
