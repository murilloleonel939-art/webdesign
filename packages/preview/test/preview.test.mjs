import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signPreviewLink, verifyPreviewToken, previewCookie, previewHeaders,
  previewHostMatches, consumeLink, newPreviewToken, DEFAULT_TTL_MINUTES,
  signAssetUrl, verifyAssetUrl, newAssetSigningKey,
} from "../dist/index.js";

const cfg = { baseDomain: "preview.localhost", secret: "s3creto-de-pruebas", ttlMinutes: DEFAULT_TTL_MINUTES, secure: false };
const SITE = "33333333-3333-4333-8333-333333333333";

test("a signed link verifies and carries site and page", () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = verifyPreviewToken(cfg, token);
  assert.equal(r.ok, true);
  assert.equal(r.claims.siteId, SITE);
  assert.equal(r.claims.pageId, "p_home");
});

test("tokens are not interchangeable across secrets", () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const r = verifyPreviewToken({ ...cfg, secret: "otro" }, token);
  assert.deepEqual(r, { ok: false, reason: "bad_signature" });
});

test("an expired link is rejected", () => {
  const now = Date.now();
  const { token } = signPreviewLink(cfg, SITE, "p_home", now);
  assert.deepEqual(verifyPreviewToken(cfg, token, now + 16 * 60_000), { ok: false, reason: "expired" });
});

test("tampering with the payload breaks the signature", () => {
  const { token } = signPreviewLink(cfg, SITE, "p_home");
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ siteId: "otro", pageId: "x", exp: Date.now() + 60000, jti: "a" })).toString("base64url");
  assert.deepEqual(verifyPreviewToken(cfg, `${forged}.${sig}`, Date.now()), { ok: false, reason: "bad_signature" });
  assert.equal(payload.length > 0, true);
});

test("the link is single use", async () => {
  const used = new Set();
  const store = { has: async (j) => used.has(j), mark: async (j) => void used.add(j) };
  const { jti } = signPreviewLink(cfg, SITE, "p_home");
  assert.equal(await consumeLink(store, jti), true);
  assert.equal(await consumeLink(store, jti), false);
});

test("preview host must be a direct subdomain of the preview domain", () => {
  assert.equal(previewHostMatches("abc.preview.localhost:3000", cfg), true);
  assert.equal(previewHostMatches("preview.localhost:3000", cfg), false);
  assert.equal(previewHostMatches("a.b.preview.localhost", cfg), false);
  assert.equal(previewHostMatches("abc.example.com", cfg), false);
  // Intento de confusion con sufijo parecido.
  assert.equal(previewHostMatches("evilpreview.localhost", cfg), false);
});

test("cookie is HttpOnly, Strict and Secure only when configured", () => {
  const dev = previewCookie("pv", "x", cfg);
  assert.match(dev, /HttpOnly/);
  assert.match(dev, /SameSite=Strict/);
  assert.ok(!dev.includes("Secure"));
  assert.match(previewCookie("pv", "x", { ...cfg, secure: true }), /Secure/);
  // Nunca se abre a todo el dominio.
  assert.ok(!dev.includes("Domain="));
});

test("preview responses are noindex and carry the site CSP", () => {
  const h = previewHeaders("default-src 'self'");
  assert.equal(h["x-robots-tag"], "noindex");
  assert.equal(h["content-security-policy"], "default-src 'self'");
  assert.equal(h["referrer-policy"], "no-referrer");
});

test("tokens are random and unique", () => {
  const set = new Set(Array.from({ length: 200 }, () => newPreviewToken()));
  assert.equal(set.size, 200);
});

// --- URL de asset firmadas (T-021) -----------------------------------------

const KEY = { secret: "s3creto-de-pruebas", ttlMinutes: 15 };
const ASSET = "image/abc-foto.png";

test("una firma de asset verifica contra su sitio y su ruta", () => {
  const token = signAssetUrl(KEY, SITE, ASSET);
  assert.equal(verifyAssetUrl(KEY, token, SITE, ASSET), true);
});

test("la firma de asset no vale para otro sitio", () => {
  const token = signAssetUrl(KEY, SITE, ASSET);
  assert.equal(verifyAssetUrl(KEY, token, "44444444-4444-4444-8444-444444444444", ASSET), false);
});

test("la firma de asset no vale para otra ruta", () => {
  const token = signAssetUrl(KEY, SITE, ASSET);
  assert.equal(verifyAssetUrl(KEY, token, SITE, "image/otra.png"), false);
  // Tampoco cambiando solo el tipo de asset.
  assert.equal(verifyAssetUrl(KEY, token, SITE, "poster/abc-foto.png"), false);
});

test("la firma de asset caduca", () => {
  const token = signAssetUrl(KEY, SITE, ASSET, Date.now() - 16 * 60_000);
  assert.equal(verifyAssetUrl(KEY, token, SITE, ASSET), false);
  // Recien caducada por un milisegundo: sigue sin valer.
  const just = signAssetUrl(KEY, SITE, ASSET, Date.now() - 15 * 60_000 - 1);
  assert.equal(verifyAssetUrl(KEY, just, SITE, ASSET), false);
});

test("la firma de asset no vale con otro secreto ni manipulada", () => {
  const token = signAssetUrl(KEY, SITE, ASSET);
  assert.equal(verifyAssetUrl({ ...KEY, secret: "otro" }, token, SITE, ASSET), false);
  // Carga util reescrita y firma vieja: no cuadra.
  const [, sig] = token.split(".");
  const otra = Buffer.from(JSON.stringify({ kind: "asset", siteId: SITE, assetPath: "image/otra.png", exp: Date.now() + 60_000 })).toString("base64url");
  assert.equal(verifyAssetUrl(KEY, `${otra}.${sig}`, SITE, "image/otra.png"), false);
  // Basura: no lanza, devuelve false.
  for (const bad of ["", ".", "sin-punto", "a.b", "..", "x.y.z"]) {
    assert.equal(verifyAssetUrl(KEY, bad, SITE, ASSET), false);
  }
});

test("una firma de enlace no sirve como firma de asset, ni al reves", () => {
  const { token: link } = signPreviewLink(cfg, SITE, "p_home");
  assert.equal(verifyAssetUrl(KEY, link, SITE, ASSET), false);
  const asset = signAssetUrl(KEY, SITE, ASSET);
  // `verifyPreviewToken` sigue sin aceptar la de asset: no lleva pageId.
  const r = verifyPreviewToken(cfg, asset);
  assert.equal(r.ok === true && typeof r.claims.pageId === "string", false);
});

test("la clave efimera es aleatoria y firma igual", () => {
  const a = newAssetSigningKey();
  const b = newAssetSigningKey();
  assert.notEqual(a.secret, b.secret);
  assert.equal(a.ttlMinutes, DEFAULT_TTL_MINUTES);
  const token = signAssetUrl(a, SITE, ASSET);
  assert.equal(verifyAssetUrl(a, token, SITE, ASSET), true);
  assert.equal(verifyAssetUrl(b, token, SITE, ASSET), false);
});
