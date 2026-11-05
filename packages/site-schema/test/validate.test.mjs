import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSiteDocument } from "../dist/index.js";

test("accepts a valid document", () => {
  const r = validateSiteDocument({ schemaVersion: 1, blocks: [{ type: "hero", id: "b1" }] });
  assert.equal(r.ok, true);
});

test("rejects unknown block types", () => {
  const r = validateSiteDocument({ schemaVersion: 1, blocks: [{ type: "raw_html", id: "b1" }] });
  assert.equal(r.ok, false);
});

test("rejects missing schemaVersion and non-object input", () => {
  assert.equal(validateSiteDocument({ blocks: [] }).ok, false);
  assert.equal(validateSiteDocument(null).ok, false);
});
