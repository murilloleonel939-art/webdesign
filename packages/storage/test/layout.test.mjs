import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseDir, assetFileName, assertSiteId } from "../dist/index.js";

const SITE = "9b2d6c1e-4f3a-4b8e-9c1d-2a3b4c5d6e7f";

test("builds release path inside the site folder", () => {
  assert.equal(releaseDir("/data/sites", SITE, 3), `/data/sites/${SITE}/releases/v3`);
});

test("rejects non-UUID site ids and traversal attempts", () => {
  assert.throws(() => assertSiteId("../etc"));
  assert.throws(() => releaseDir("/data/sites", "../../etc", 1));
});

test("rejects invalid versions", () => {
  assert.throws(() => releaseDir("/data/sites", SITE, 0));
});

test("asset names are generated, not user-chosen", () => {
  const n = assetFileName("png");
  assert.match(n, /^[0-9a-f-]{36}\.png$/);
});
