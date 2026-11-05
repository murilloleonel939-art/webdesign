import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishRelease, currentVersion, listVersions, rollback, switchRelease, deleteRelease } from "../dist/index.js";

const SITE = "11111111-1111-4111-8111-111111111111";
let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rel-")); });
after(() => rmSync(root, { recursive: true, force: true }));

test("publish v1 then v2, public follows the latest", () => {
  assert.equal(publishRelease(root, SITE, { "index.html": "uno" }), 1);
  assert.equal(publishRelease(root, SITE, { "index.html": "dos" }), 2);
  assert.equal(currentVersion(root, SITE), 2);
  assert.deepEqual(listVersions(root, SITE), [1, 2]);
  assert.equal(readFileSync(join(root, SITE, "public", "index.html"), "utf8"), "dos");
});

test("rollback returns to the previous release and keeps both", () => {
  publishRelease(root, SITE, { "index.html": "uno" });
  publishRelease(root, SITE, { "index.html": "dos" });
  assert.equal(rollback(root, SITE), 1);
  assert.equal(currentVersion(root, SITE), 1);
  assert.deepEqual(listVersions(root, SITE), [1, 2]);
  assert.equal(readFileSync(join(root, SITE, "public", "index.html"), "utf8"), "uno");
});

test("rollback without previous release fails", () => {
  publishRelease(root, SITE, { "index.html": "uno" });
  assert.throws(() => rollback(root, SITE), /no previous release/);
});

test("cannot activate or delete a missing/active release", () => {
  publishRelease(root, SITE, { "index.html": "uno" });
  assert.throws(() => switchRelease(root, SITE, 9), /does not exist/);
  assert.throws(() => deleteRelease(root, SITE, 1), /active release/);
});

test("rejects path traversal in asset names", () => {
  assert.throws(() => publishRelease(root, SITE, { "../escape.html": "x" }), /invalid asset name/);
});
