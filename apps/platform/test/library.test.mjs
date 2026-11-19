import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Biblioteca de Pexels: SIEMPRE con un directorio temporal. Ninguna prueba toca
// /data ni el `.data` del repo, y ninguna abre una conexion: aqui solo se prueba
// el disco (guardar, releer, descartar una entrada truncada y el README).
const raiz = await mkdtemp(join(tmpdir(), "biblioteca-pexels-"));
process.env.MEDIA_LIBRARY_ROOT = raiz;

const { saveToLibrary, readFromLibrary, libraryReadme, libraryStats } = await import("../dist/library.js");

const JPEG = Buffer.from(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]));

function photo(id, extra = {}) {
  return {
    id,
    width: 1200,
    height: 800,
    url: `https://www.pexels.com/photo/x-${id}/`,
    photographer: "Ana Pérez",
    photographerUrl: "https://www.pexels.com/@ana",
    alt: "una calle",
    src: {
      original: "https://images.pexels.com/photos/1/a.jpg",
      large2x: "https://images.pexels.com/photos/1/a.jpg",
      large: "https://images.pexels.com/photos/1/a.jpg",
      medium: "https://images.pexels.com/photos/1/a.jpg",
      tiny: "https://images.pexels.com/photos/1/a.jpg",
    },
    ...extra,
  };
}

const entrada = (id, siteId) => ({
  photo: photo(id), content: JPEG, mime: "image/jpeg", query: "calle", siteId,
});

test("saveToLibrary crea pexels/<id>/<id>.jpg y meta.json", async () => {
  const meta = await saveToLibrary(entrada(101, "sitio-a"));
  assert.equal(meta.id, 101);
  assert.equal(meta.file, "101.jpg");
  assert.equal(meta.license, "Pexels License");
  assert.deepEqual(meta.sites, ["sitio-a"]);

  const dir = join(raiz, "pexels", "101");
  assert.deepEqual((await readdir(dir)).sort(), ["101.jpg", "meta.json"]);
  const guardado = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  assert.equal(guardado.photographer, "Ana Pérez");
  assert.equal(guardado.licenseUrl, "https://www.pexels.com/license/");
});

test("la segunda llamada no reescribe firstSeenAt y suma el sitio nuevo", async () => {
  const primera = await saveToLibrary(entrada(102, "sitio-a"));
  // El fichero bueno no se toca: se cambia el contenido de la segunda llamada y
  // aun asi se conserva el primero.
  const otro = Buffer.from(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x39, 0x39]));
  const segunda = await saveToLibrary({ ...entrada(102, "sitio-b"), content: otro });

  assert.equal(segunda.firstSeenAt, primera.firstSeenAt);
  assert.deepEqual(segunda.sites, ["sitio-a", "sitio-b"]);
  const enDisco = await readFile(join(raiz, "pexels", "102", "102.jpg"));
  assert.equal(enDisco.byteLength, JPEG.byteLength);
});

test("readFromLibrary devuelve el Buffer guardado", async () => {
  await saveToLibrary(entrada(103, "sitio-a"));
  const leido = await readFromLibrary(103);
  assert.ok(leido);
  assert.equal(leido.meta.id, 103);
  assert.deepEqual(leido.content, JPEG);
  // Una foto que no esta: `undefined`, sin lanzar.
  assert.equal(await readFromLibrary(999), undefined);
});

test("un fichero truncado se descarta y la entrada desaparece", async () => {
  await saveToLibrary(entrada(104, "sitio-a"));
  await writeFile(join(raiz, "pexels", "104", "104.jpg"), JPEG.subarray(0, 3));
  assert.equal(await readFromLibrary(104), undefined);
  assert.equal(existsSync(join(raiz, "pexels", "104")), false);
});

test("libraryReadme lleva autor, licencia y la nota de creditos", () => {
  const md = libraryReadme([
    { id: 7, kind: "photo", file: "7.jpg", mime: "image/jpeg", width: 10, height: 10,
      photographer: "Ana Pérez", photographerUrl: "https://www.pexels.com/@ana",
      sourceUrl: "https://www.pexels.com/photo/x-7/", license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/", query: "calle",
      firstSeenAt: "2026-01-05T10:00:00.000Z", lastUsedAt: "2026-01-05T10:00:00.000Z", sites: ["sitio-a"] },
  ]);
  assert.match(md, /^\| Id \| Autor \| Enlace \| Licencia \| Primera descarga \| Sitios \|$/m);
  assert.match(md, /Ana Pérez/);
  assert.match(md, /Pexels License/);
  assert.match(md, /2026-01-05/);
  assert.match(md, /sitio-a/);
  assert.match(md, /no exige crédito visible/);
});

test("libraryStats cuenta fotos y bytes; el README de la biblioteca existe", async () => {
  const stats = await libraryStats();
  assert.ok(stats.photos >= 2);
  assert.ok(stats.bytes >= JPEG.byteLength);
  const readme = await readFile(join(raiz, "pexels", "README.md"), "utf8");
  assert.match(readme, /Biblioteca de imágenes de Pexels/);
});

test("una entrada sin meta.json no se lee y no se inventa", async () => {
  await mkdir(join(raiz, "pexels", "105"), { recursive: true });
  await writeFile(join(raiz, "pexels", "105", "105.jpg"), JPEG);
  assert.equal(await readFromLibrary(105), undefined);
});

// Limpieza del directorio temporal al final del archivo.
test.after(async () => {
  await rm(raiz, { recursive: true, force: true });
});
