import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, newSessionToken } from "../dist/index.js";

test("hash verifies with the right password only", async () => {
  const h = await hashPassword("contraseña-segura-1");
  assert.equal(await verifyPassword("contraseña-segura-1", h), true);
  assert.equal(await verifyPassword("otra-contraseña-x", h), false);
});

test("rejects short passwords", async () => {
  await assert.rejects(() => hashPassword("corta"));
});

test("same password gets different hashes (random salt)", async () => {
  const a = await hashPassword("contraseña-segura-1");
  const b = await hashPassword("contraseña-segura-1");
  assert.notEqual(a, b);
});

test("session token stores only its hash", () => {
  const s = newSessionToken();
  assert.notEqual(s.token, s.tokenHash);
  assert.match(s.tokenHash, /^[0-9a-f]{64}$/);
});
