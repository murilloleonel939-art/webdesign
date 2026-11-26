import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate, ensureTestDatabase } from "@webdesign/db";
import { signAssetUrl } from "@webdesign/preview";
import { createApp } from "../dist/server.js";

// T-021: la vista previa sirve los assets por URL firmada.
//
// El iframe de la vista previa va con `sandbox` sin `allow-same-origin`: su
// origen es opaco y el navegador no manda la cookie de sesion en lo que pide
// desde dentro (medido en Chromium). Por eso el iframe no puede pasar el
// control del dueno de `/assets/`, y hasta ahora la vista previa incrustaba
// cada foto en base64: 960 KB de HTML para cuatro fotos, sin cache.
// La via firmada es ADICIONAL y solo de lectura.

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de assets de la vista previa omitidas: falta DB de pruebas", { skip: true }, () => {});
} else {
  const PREVIEW = { baseDomain: "preview.localhost", secret: "secreto-vista-previa", ttlMinutes: 15, secure: false };
  const OTRO_SITE = "55555555-5555-4555-8555-555555555555";
  // PNG de 62 KB: si se incrustara en base64 el HTML pasaria de 80 KB. Asi el
  // limite de peso de abajo distingue de verdad una cosa de la otra.
  const FOTO = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(62_000).fill(0)]);
  const ALT = "Fachada de la clinica";
  const IDS = ["a1", "a2", "a3", "a4"].map((n) => `11111111-1111-4111-8111-11111111111${n.slice(1)}`);

  let pool, appPool, server, port, sitesRoot, cookie;
  // Sitio en borrador: es el caso para el que existe la vista previa.
  let draft;
  // Sitio publicado: sus assets se siguen sirviendo sin firma, como hoy.
  let published;

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
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text.startsWith("{") ? JSON.parse(text) : undefined, text }));
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  const callRaw = (method, path, withCookie) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, method, headers: { host: "panel.example.com", ...(withCookie && cookie ? { cookie } : {}) } },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  const uploadPhoto = (siteId) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: `/api/sites/${siteId}/assets?kind=image`, method: "POST",
          headers: { host: "panel.example.com", cookie, "content-type": "image/png", "content-length": FOTO.length } },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
        },
      );
      req.on("error", reject);
      req.write(Buffer.from(FOTO));
      req.end();
    });

  const photoDoc = (assetId) => ({
    schemaVersion: 1,
    meta: { name: "Clinica Dental", lang: "es" },
    design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
    theme: { colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
      typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 160 }, radius: "square" },
    pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "Bienvenido", noindex: false },
      sections: [
        { id: "s_hero", type: "hero", props: { headline: "Sonrisa sana", image: assetId } },
        { id: "s_gal", type: "gallery", props: { assetIds: [assetId, assetId, assetId] } },
      ] }],
    assets: [{ id: assetId, alt: ALT, credit: null }],
  });

  const publishSite = async (siteId, assetId) => {
    const rev = await call("GET", `/api/sites/${siteId}/draft`);
    assert.equal(rev.status, 200);
    const saved = await call("PUT", `/api/sites/${siteId}/draft`, { doc: photoDoc(assetId), expectedRev: rev.json.rev });
    assert.equal(saved.status, 200);
    const pub = await call("POST", `/api/sites/${siteId}/publish`, { confirmWarnings: true, confirmVisual: true });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
  };

  // La ruta del asset la decide la base, no el test: `/assets/<sitio>/<ruta>`.
  const assetPathOf = async (assetId) =>
    (await pool.query("SELECT path FROM assets WHERE id = $1", [assetId])).rows[0].path;

  before(async () => {
    sitesRoot = mkdtempSync(join(tmpdir(), "sites-preview-"));
    const admin = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
    const url = await ensureTestDatabase(admin, process.env.DB_TEST_URL, "platform");
    await admin.end();
    pool = new pg.Pool({ connectionString: url });
    for (const t of ["sites", "site_members", "site_drafts", "site_versions", "assets", "audit_log", "users", "user_sessions", "schema_migrations"]) {
      await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await migrate(pool);
    // RLS no aplica al superusuario: se prueba con el rol de la aplicacion.
    await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform') THEN CREATE ROLE app_platform LOGIN; END IF; END $$");
    await pool.query("ALTER ROLE app_platform LOGIN PASSWORD 'test'");
    appPool = new pg.Pool({ connectionString: url.replace(/\/\/[^@]*@/, "//app_platform:test@") });
    server = createApp({ pool: appPool, sitesRoot, preview: PREVIEW });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;

    const { createUser, startSession } = await import("../dist/api.js");
    const userId = await createUser(pool, "vista@example.com", "Vista", "contrasena-larga");
    cookie = `sid=${await startSession(pool, userId)}`;

    // Sitio 1: borrador con hero + tres fotos de galeria.
    const a = await call("POST", "/api/sites", { name: "Borrador con fotos" });
    assert.equal(a.status, 201);
    const aAsset = await uploadPhoto(a.json.id);
    assert.equal(aAsset.status, 201);
    draft = { siteId: a.json.id, assetId: aAsset.json.id, path: await assetPathOf(aAsset.json.id) };
    const rev = await call("GET", `/api/sites/${draft.siteId}/draft`);
    const saved = await call("PUT", `/api/sites/${draft.siteId}/draft`, { doc: photoDoc(draft.assetId), expectedRev: rev.json.rev });
    assert.equal(saved.status, 200);

    // Sitio 2: publicado, para comprobar que la via de siempre no cambia.
    const b = await call("POST", "/api/sites", { name: "Publicado con fotos" });
    assert.equal(b.status, 201);
    const bAsset = await uploadPhoto(b.json.id);
    assert.equal(bAsset.status, 201);
    published = { siteId: b.json.id, assetId: bAsset.json.id, path: await assetPathOf(bAsset.json.id) };
    await publishSite(published.siteId, published.assetId);
  });

  after(async () => {
    server?.close();
    await appPool?.end();
    await pool?.end();
    if (sitesRoot) rmSync(sitesRoot, { recursive: true, force: true });
  });

  test("la vista previa sirve los assets por URL firmada, sin base64", async () => {
    const r = await callRaw("GET", `/api/sites/${draft.siteId}/preview?page=p_home`, true);
    assert.equal(r.status, 200);
    const html = r.body.toString("utf8");

    // Cero bytes de imagen incrustados: eso era el fallo.
    assert.equal(html.includes("data:image"), false, "el HTML no puede llevar data:image");

    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(srcs.length, 4, "hero + tres fotos de galeria");
    for (const src of srcs) {
      assert.match(src, new RegExp(`^/assets/${draft.siteId}/image/[0-9a-f-]+\\.png\\?pv=`));
    }

    // El peso ya no depende de la foto: 62 KB en base64 pasarian de 82 KB.
    assert.ok(Buffer.byteLength(html) < 32 * 1024, `el HTML de la vista previa pesa ${Buffer.byteLength(html)} bytes`);

    // El alt se conserva (T-021 alt sigue arreglado).
    const alts = [...html.matchAll(/<img[^>]*\salt="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(alts.length, 4);
    for (const a of alts) assert.equal(a, ALT);
  });

  test("la URL firmada sirve los bytes del asset", async () => {
    const html = (await callRaw("GET", `/api/sites/${draft.siteId}/preview?page=p_home`, true)).body.toString("utf8");
    const src = /<img[^>]*\ssrc="([^"]+)"/.exec(html)[1];
    const r = await callRaw("GET", src, false);
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"] ?? "", /image\/png/);
    assert.equal(r.body.length, FOTO.length);
  });

  test("sin firma, un asset de borrador sigue dando 404", async () => {
    const r = await callRaw("GET", `/assets/${draft.siteId}/${draft.path}`, false);
    assert.equal(r.status, 404);
  });

  test("una firma de otro sitio no abre el asset", async () => {
    const token = signAssetUrl(PREVIEW, OTRO_SITE, draft.path);
    const r = await callRaw("GET", `/assets/${draft.siteId}/${draft.path}?pv=${token}`, false);
    assert.equal(r.status, 404);
  });

  test("una firma caducada no abre el asset", async () => {
    const token = signAssetUrl(PREVIEW, draft.siteId, draft.path, Date.now() - 16 * 60_000);
    const r = await callRaw("GET", `/assets/${draft.siteId}/${draft.path}?pv=${token}`, false);
    assert.equal(r.status, 404);
  });

  test("una firma valida no sirve otra ruta del mismo sitio", async () => {
    // Mismo token, otra ruta: la firma ata la ruta exacta.
    const token = signAssetUrl(PREVIEW, draft.siteId, draft.path);
    const otra = draft.path.replace(/\.png$/, "-otra.png");
    const r = await callRaw("GET", `/assets/${draft.siteId}/${otra}?pv=${token}`, false);
    assert.equal(r.status, 404);
  });

  test("una firma manipulada o basura no abre nada", async () => {
    const token = signAssetUrl(PREVIEW, draft.siteId, draft.path);
    const [payload, sig] = token.split(".");
    const falsa = `${payload}.${sig.slice(0, -2)}xx`;
    assert.equal((await callRaw("GET", `/assets/${draft.siteId}/${draft.path}?pv=${falsa}`, false)).status, 404);
    assert.equal((await callRaw("GET", `/assets/${draft.siteId}/${draft.path}?pv=basura`, false)).status, 404);
    assert.equal((await callRaw("GET", `/assets/${draft.siteId}/${draft.path}?pv=`, false)).status, 404);
  });

  test("la firma no abre escritura ni listado", async () => {
    const token = signAssetUrl(PREVIEW, draft.siteId, draft.path);
    // POST y DELETE con la firma puesta: la via firmada es solo GET.
    const post = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: `/assets/${draft.siteId}/${draft.path}?pv=${token}`, method: "POST",
          headers: { host: "panel.example.com", "content-length": "0" } },
        (res) => { let t = ""; res.setEncoding("utf8"); res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode })); },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(post.status, 404);
    // La ruta de gestion de assets sigue exigiendo sesion.
    assert.equal((await callRaw("GET", `/api/sites/${draft.siteId}/assets`, false)).status, 401);
  });

  test("un sitio publicado sigue sirviendo sus assets sin firma", async () => {
    const r = await callRaw("GET", `/assets/${published.siteId}/${published.path}`, false);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, FOTO.length);
    // Y la URL firmada tambien vale para el, sin cambiar nada.
    const token = signAssetUrl(PREVIEW, published.siteId, published.path);
    assert.equal((await callRaw("GET", `/assets/${published.siteId}/${published.path}?pv=${token}`, false)).status, 200);
  });
}
