import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
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
  assert.throws(() => publishRelease(root, SITE, { "../escape.html": "x" }), /invalid release path/);
});

test("una release con subdirectorios: /precios no puede perderse", () => {
  // Regresion: antes se rechazaba cualquier nombre con "/", asi que un sitio de
  // dos paginas no se podia publicar.
  const v = publishRelease(root, SITE, {
    "index.html": "<h1>Inicio</h1>",
    "precios/index.html": "<h1>Precios</h1>",
    "contacto/index.html": "<h1>Contacto</h1>",
  });
  assert.equal(v, 1);
  assert.match(readFileSync(join(root, SITE, "releases", "v1", "precios", "index.html"), "utf8"), /Precios/);
});

test("una ruta que intenta salir de la release se rechaza", () => {
  assert.throws(() => publishRelease(root, SITE, { "../../fuera.html": "x" }), /invalid release path/);
  assert.throws(() => publishRelease(root, SITE, { "/absoluto.html": "x" }), /invalid release path/);
});

test("los assets entran por hardlink, no copiados", () => {
  const assetsDir = join(root, SITE, "assets", "image");
  mkdirSync(assetsDir, { recursive: true });
  const source = join(assetsDir, "aa.png");
  writeFileSync(source, "PNG");
  publishRelease(root, SITE, { "index.html": "<img>" }, { "assets/image/aa.png": source });
  const target = join(root, SITE, "releases", "v1", "assets", "image", "aa.png");
  assert.equal(existsSync(target), true);
  // Un hardlink comparte inodo con el original: no es una copia.
  assert.equal(statSync(target).ino, statSync(source).ino);
});
