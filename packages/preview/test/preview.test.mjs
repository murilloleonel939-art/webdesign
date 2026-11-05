import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signPreviewLink, verifyPreviewToken, previewCookie, previewHeaders,
  previewHostMatches, consumeLink, newPreviewToken, DEFAULT_TTL_MINUTES,
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
