import { test } from "node:test";
import assert from "node:assert/strict";
import { slugToFile } from "../dist/index.js";

test("slug maps to a file name", () => {
  assert.equal(slugToFile("/"), "index.html");
  assert.equal(slugToFile("/precios"), "precios/index.html");
  assert.equal(slugToFile("/a/b/"), "a/b/index.html");
});
