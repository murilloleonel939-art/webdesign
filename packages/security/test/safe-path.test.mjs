import { test } from "node:test";
import assert from "node:assert/strict";
import { safeJoin } from "../dist/index.js";

test("accepts paths inside root", () => {
  assert.equal(safeJoin("/data/sites/s1", "index.html"), "/data/sites/s1/index.html");
});

test("rejects traversal and absolute escapes", () => {
  assert.throws(() => safeJoin("/data/sites/s1", "../s2/index.html"));
  assert.throws(() => safeJoin("/data/sites/s1", "/etc/passwd"));
  assert.throws(() => safeJoin("/data/sites/s1", "a/../../s2"));
});

test("rejects null bytes", () => {
  assert.throws(() => safeJoin("/data/sites/s1", "index.html\0.png"));
});
