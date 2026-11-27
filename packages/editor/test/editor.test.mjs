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

test("ownerProvided is not an editable field in testimonials either", () => {
  // T-028: el mismo error estaba en los dos tipos. `ownerProvided` significa
  // «esto lo aportó el dueño y es verificable»: si se puede marcar desde el
  // sidebar, deja de probar nada.
  assert.ok(!("ownerProvided" in (cfg.components.testimonials.fields ?? {})));
});

test("ownerProvided se explica con un aviso de solo lectura, no con un input", () => {
  // Se quedó visible a propósito, pero sin nada que escribir: el valor lo fija
  // la pestaña «Contenido» del panel al confirmar el texto.
  for (const name of ["testimonial", "testimonials"]) {
    const fields = cfg.components[name].fields ?? {};
    const nota = fields.ownerProvidedNote;
    assert.ok(nota, `${name}: falta el aviso de publicación`);
    assert.equal(nota.type, "custom", `${name}: el aviso no puede ser un campo editable`);
    assert.equal(typeof nota.render, "function", `${name}: el aviso no pinta nada`);
    // Y el valor por defecto nunca publica: sólo lo pone el dueño al confirmar.
    assert.equal(cfg.components[name].defaultProps.ownerProvided, false, name);
  }
});
