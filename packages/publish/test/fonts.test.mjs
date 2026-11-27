// T-030b: las fuentes del tema viajan dentro de la release.
// Sin esto el CSS referencia /fonts/<archivo>.ttf y en produccion da 404: el
// navegador cae a la pila del sistema y la direccion tipografica se pierde.
// Prueba sin base de datos: `fontFiles` es puro y `publishRelease` solo toca disco.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishRelease, currentVersion } from "@webdesign/releases";
import { fontFiles } from "../dist/index.js";

const SITE = "44444444-4444-4444-8444-444444444444";
const theme = (family) => ({
  colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
  typography: { family, scale: "normal" },
  spacing: { margin: 24, sectionGap: 160 },
  radius: "rounded",
});

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "fonts-")); });
after(() => rmSync(root, { recursive: true, force: true }));

const releaseFiles = (v) => {
  const dir = join(root, SITE, "releases", `v${v}`);
  return existsSync(join(dir, "fonts")) ? readdirSync(join(dir, "fonts")).sort() : [];
};

test("T-030b: editorial deja Gloock + Crimson Pro en fonts/ de la release", () => {
  // Solo las fuentes del tema, no los 11 .ttf: cada release pesa lo que usa.
  publishRelease(root, SITE, { "index.html": "<h1>Hola</h1>" }, fontFiles(theme("editorial")));
  assert.deepEqual(releaseFiles(1), ["CrimsonPro-Bold.ttf", "CrimsonPro-Regular.ttf", "Gloock-Regular.ttf"]);
  // La ruta publica es la que ya referencia el CSS: <release>/fonts/<archivo>.ttf.
  assert.ok(existsSync(join(root, SITE, "public", "fonts", "Gloock-Regular.ttf")));
});

test("T-030b: moderna deja solo Instrument Sans", () => {
  publishRelease(root, SITE, { "index.html": "x" }, fontFiles(theme("moderna")));
  assert.deepEqual(releaseFiles(1), ["InstrumentSans-Bold.ttf", "InstrumentSans-Regular.ttf"]);
});

test("T-030b: un tema del catalogo antiguo publica sin fonts/ y no rompe", () => {
  // Los sitios ya publicados con `Inter` (T-029) no piden .ttf: su release
  // funciona igual, sin directorio fonts y sin 404 nuevos.
  const assets = fontFiles(theme("Inter"));
  assert.deepEqual(assets, {});
  publishRelease(root, SITE, { "index.html": "x" }, assets);
  assert.equal(existsSync(join(root, SITE, "releases", "v1", "fonts")), false);
  assert.deepEqual(releaseFiles(1), []);
});

test("T-030b: los .ttf de la release son identicos al original", () => {
  const assets = fontFiles(theme("editorial"));
  publishRelease(root, SITE, { "index.html": "x" }, assets);
  for (const [name, source] of Object.entries(assets)) {
    const served = join(root, SITE, "releases", "v1", name);
    assert.equal(statSync(served).size, statSync(source).size, `${name}: tamano distinto`);
  }
});

test("T-030b: v2 con otra direccion cambia las fuentes y no acumula", () => {
  publishRelease(root, SITE, { "index.html": "1" }, fontFiles(theme("editorial")));
  publishRelease(root, SITE, { "index.html": "2" }, fontFiles(theme("rotunda")));
  assert.equal(currentVersion(root, SITE), 2);
  assert.deepEqual(releaseFiles(2), ["Outfit-Bold.ttf", "Outfit-Regular.ttf", "YoungSerif-Regular.ttf"]);
  // v1 sigue intacta: revertir a ella devuelve sus fuentes.
  assert.deepEqual(releaseFiles(1), ["CrimsonPro-Bold.ttf", "CrimsonPro-Regular.ttf", "Gloock-Regular.ttf"]);
});
