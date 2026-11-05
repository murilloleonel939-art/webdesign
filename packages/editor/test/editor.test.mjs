import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEditorConfig } from "../dist/config.js";
import { SECTION_TYPES } from "@webdesign/site-schema";

const cfg = buildEditorConfig({ hostedFonts: ["Inter"] });

test("Puck config has exactly the section types of the schema", () => {
  assert.deepEqual(Object.keys(cfg.components).sort(), [...SECTION_TYPES].sort());
});

test("every component has a label, default props and a render", () => {
  for (const [name, c] of Object.entries(cfg.components)) {
    assert.ok(c.label, name);
    assert.equal(typeof c.render, "function", name);
    assert.deepEqual(c.defaultProps, c.defaultProps, name);
  }
});

test("ownerProvided is not an editable field", () => {
  assert.ok(!("ownerProvided" in (cfg.components.testimonial.fields ?? {})));
});
