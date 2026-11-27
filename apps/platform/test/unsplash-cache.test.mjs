import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, truncate, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Caché de Unsplash: tope de tamaño al leer de disco.
//
// La descarga de red ya está capada a `MAX_PHOTO_BYTES` (unsplash.ts), pero la
// caché es un fichero del volumen de datos: lo puede dejar cualquiera que
// escriba ahí, o un guardado anterior que se cortó a medias. `readFile` sin tope
// se traga lo que haya y `bank-builder` copia el contenido tal cual al banco, así
// que un fichero gigante agotaba la memoria del panel. Estas pruebas fijan el
// comportamiento: se pregunta el tamaño antes de leer y, si no cabe, se descarta
// sin leerlo y sin lanzar.

const LIB = await mkdtemp(join(tmpdir(), "unsplash-cache-tope-"));
process.env.MEDIA_LIBRARY_ROOT = LIB;

const { MAX_PHOTO_BYTES } = await import("../dist/unsplash.js");
const { readFromUnsplashCache } = await import("../dist/unsplash-cache.js");

// Cabecera JPEG real: la caché comprueba los primeros bytes y no sirve nada cuyo
// tipo real no coincida con el de `meta.json`.
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** Crea una entrada de caché con su `meta.json` y devuelve la ruta del binario. */
async function entry(id, { conBinario = true } = {}) {
  const dir = join(LIB, "unsplash-cache", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({
      id,
      alt: `alt de ${id}`,
      photographer: "Foto Grafo",
      photographerUrl: "https://unsplash.com/@fotografo",
      sourceUrl: `https://unsplash.com/photos/${id}`,
      downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
      mime: "image/jpeg",
      query: "clinica dental",
      savedAt: new Date().toISOString(),
    }),
  );
  const file = join(dir, `${id}.jpg`);
  // El binario se crea vacío: `truncate` necesita que el fichero exista, y las
  // pruebas que quieren contenido real lo escriben después.
  if (conBinario) await writeFile(file, "");
  return file;
}

/** Ejecuta la lectura capturando los avisos de consola. */
async function leer(id) {
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => avisos.push(args);
  try {
    return { salida: await readFromUnsplashCache(id), avisos };
  } finally {
    console.warn = original;
  }
}

test("caché: un fichero gigante se descarta por tamaño, sin leerlo entero y sin lanzar", async () => {
  const id = "gigante-disperso";
  const file = await entry(id);
  // Fichero DISPERSO: `truncate` fija el tamaño declarado sin escribir los bytes.
  // En disco no ocupa nada; si alguien lo leyera entero, ocuparía en memoria ese
  // tamaño. 512 MB es holgadamente mayor que el tope.
  const TAMANO = 512 * 1024 * 1024;
  await truncate(file, TAMANO);
  assert.equal((await stat(file)).size, TAMANO, "el fichero declara 512 MB sin ocuparlos en disco");

  const rssAntes = process.memoryUsage().rss;
  const { salida, avisos } = await leer(id);
  const rssDespues = process.memoryUsage().rss;

  assert.equal(salida, undefined, "una entrada por encima del tope no se sirve");

  const aviso = avisos.find((args) => args[0] === "unsplash_cache_too_large");
  assert.ok(aviso, `no se avisó del tamaño: ${JSON.stringify(avisos)}`);
  assert.equal(aviso[1].size, TAMANO, "el aviso lleva el tamaño real, así que se consultó antes de leer");

  // La prueba de que NO se leyó entero: leer 512 MB habría subido el RSS en
  // cientos de MB. El margen es amplio a propósito para no depender del GC.
  const subidaMb = Math.round((rssDespues - rssAntes) / (1024 * 1024));
  assert.ok(subidaMb < 200, `el RSS subió ${subidaMb} MB: se leyó el fichero en vez de descartarlo por tamaño`);

  // Se retira la entrada inservible para que la próxima vez se vuelva a bajar.
  assert.equal(existsSync(join(LIB, "unsplash-cache", id)), false, "la entrada se borra");
});

test("caché: justo en el tope sí se sirve; un byte más, no", async () => {
  // Control del borde: el tope no puede rechazar una foto legítima del tamaño
  // máximo (rompería fotos reales) ni dejar pasar una que se pase por un byte.
  const justo = "justo-en-el-tope";
  const justoFile = await entry(justo);
  await writeFile(justoFile, Buffer.concat([JPEG_HEAD, Buffer.alloc(MAX_PHOTO_BYTES - JPEG_HEAD.length, 0x20)]));
  const servida = await leer(justo);
  assert.ok(servida.salida, `una entrada de exactamente ${MAX_PHOTO_BYTES} bytes tiene que servirse`);
  assert.equal(servida.salida.content.byteLength, MAX_PHOTO_BYTES);

  const pasado = "un-byte-de-mas";
  const pasadoFile = await entry(pasado);
  await writeFile(pasadoFile, Buffer.concat([JPEG_HEAD, Buffer.alloc(MAX_PHOTO_BYTES - JPEG_HEAD.length + 1, 0x20)]));
  const descartada = await leer(pasado);
  assert.equal(descartada.salida, undefined, "un byte por encima del tope no se sirve");
  assert.equal(existsSync(join(LIB, "unsplash-cache", pasado)), false, "la entrada se borra");
});

test("caché: un meta sin fichero se descarta igual, sin lanzar", async () => {
  const id = "meta-sin-fichero";
  await entry(id, { conBinario: false });
  const { salida } = await leer(id);
  assert.equal(salida, undefined);
  assert.equal(existsSync(join(LIB, "unsplash-cache", id)), false, "la entrada se borra");
});
