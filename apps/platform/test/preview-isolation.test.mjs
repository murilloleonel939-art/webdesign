import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../dist/server.js";
import { signPreviewLink } from "@webdesign/preview";

// Aceptacion de la Fase 1 (spec 5.5): aislamiento de origen contra *.preview.localhost,
// sin Cloudflare, sin DNS real y sin la Fase 2.

const cfg = { baseDomain: "preview.localhost", secret: "s3creto-ci", ttlMinutes: 15, secure: false };
const SITE = "33333333-3333-4333-8333-333333333333";
let server, base, previewBase;

before(async () => {
  server = createApp({
    preview: cfg,
    renderPreview: async (siteId, pageId) => (siteId === SITE ? `<html><body>${pageId}</body></html>` : undefined),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  previewBase = `http://127.0.0.1:${port}`;
});
after(() => server?.close());

// El host de la peticion es lo que decide si es panel o vista previa.
// `fetch` no permite falsificar Host: undici lo deriva de la URL, asi que se usa http.request.
function get(path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: Number(new URL(base).port), path, method: "GET", headers: { host } },
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
}

test("preview host serves the page with noindex and the site CSP", async () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = await get(`/${encodeURIComponent(token)}`, `abc.preview.localhost`);
  assert.equal(r.status, 200);
  assert.match(r.text, /p_home/);
  assert.equal(r.headers["x-robots-tag"], "noindex");
  assert.match(r.headers["content-security-policy"] ?? "", /script-src 'none'/);
});

test("the preview cookie belongs to the preview subdomain only", async () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = await get(`/${encodeURIComponent(token)}`, `abc.preview.localhost`);
  const cookie = [].concat(r.headers["set-cookie"] ?? []).join("; ");
  assert.match(cookie, new RegExp(`pv_${SITE}`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  // Sin Domain=: no se comparte con el panel ni con otros subdominios.
  assert.ok(!/Domain=/i.test(cookie));
});

test("the app origin never serves a preview", async () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = await get(`/${encodeURIComponent(token)}`, "panel.example.com");
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.text).error, "not_found");
});

test("the same link cannot be used twice", async () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  assert.equal((await get(`/${encodeURIComponent(token)}`, "abc.preview.localhost")).status, 200);
  assert.equal((await get(`/${encodeURIComponent(token)}`, "abc.preview.localhost")).status, 403);
});

test("a forged or expired link is refused", async () => {
  const forged = await get("/basura.firma", "abc.preview.localhost");
  assert.equal(forged.status, 403);
  const old = signPreviewLink(cfg, SITE, "p_home", Date.now() - 60 * 60_000);
  assert.equal((await get(`/${encodeURIComponent(old.token)}`, "abc.preview.localhost")).status, 403);
});

test("a lookalike host does not reach the preview", async () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = await get(`/${encodeURIComponent(token)}`, "evilpreview.localhost");
  assert.equal(r.status, 404);
});

test("healthz keeps working on the app origin", async () => {
  const r = await get("/healthz", "panel.example.com");
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { status: "ok" });
});

test("an unknown site renders 404 inside the preview origin", async () => {
  const { token } = signPreviewLink(cfg, "44444444-4444-4444-8444-444444444444", "p_home");
  const r = await get(`/${encodeURIComponent(token)}`, "abc.preview.localhost");
  assert.equal(r.status, 404);
  assert.equal(r.headers["x-robots-tag"], "noindex");
});
