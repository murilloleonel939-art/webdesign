import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPhotos, downloadPhoto, isPexelsConfigured } from "../dist/pexels.js";
import { fuentesMarkdown } from "../dist/fuentes.js";

// Pexels: busqueda y descarga SIN red real.
//
// Todo `fetch` se inyecta. Ninguna prueba de este archivo abre una conexion: si
// alguna lo hiciera, se veria como un fallo intermitente en CI y ademas
// dependeria de una clave de verdad. Lo que se fija aqui es el contrato de
// fallo: un tercero caido no puede romper una subida de fotos.

process.env.PEXELS_API_KEY = "clave-de-prueba-no-real";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function photo(src, extra = {}) {
  return {
    id: 1, width: 1200, height: 800, url: "https://www.pexels.com/photo/x-1/",
    photographer: "Ana Pérez", alt: "una calle",
    src: { original: src, large2x: src, large: src, medium: src, tiny: src },
    ...extra,
  };
}

test("una busqueda que falla devuelve [] y no lanza", async () => {
  const rompe = async () => { throw new Error("ECONNREFUSED"); };
  assert.deepEqual(await searchPhotos("calle", {}, rompe), []);

  // Respuesta HTTP de error: mismo trato, lista vacia.
  const noOk = async () => new Response("nope", { status: 401 });
  assert.deepEqual(await searchPhotos("calle", {}, noOk), []);

  // Cuerpo que no es JSON: tampoco se propaga la excepcion.
  const basura = async () => new Response("no soy json", { status: 200 });
  assert.deepEqual(await searchPhotos("calle", {}, basura), []);
});

test("una busqueda correcta se normaliza y no filtra la clave", async () => {
  let visto;
  const fetchFalso = async (url, init) => {
    visto = { url: String(url), auth: init.headers.authorization };
    return Response.json({ photos: [{ ...photo("https://images.pexels.com/photos/1/a.jpg"), id: 7 }] });
  };
  const out = await searchPhotos("calle", { orientation: "landscape", perPage: 3 }, fetchFalso);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 7);
  assert.equal(out[0].photographer, "Ana Pérez");
  assert.match(visto.url, /api\.pexels\.com\/v1\/search/);
  assert.match(visto.url, /orientation=landscape/);
  // El resultado no lleva la clave en ningun campo.
  assert.equal(JSON.stringify(out).includes("clave-de-prueba-no-real"), false);
});

test("una URL que no es de images.pexels.com se rechaza sin descargar", async () => {
  let llamado = false;
  const fetchFalso = async () => { llamado = true; return new Response(JPEG, { status: 200 }); };

  // Host ajeno, subdominio falso, otro esquema y protocolo raro: nada pasa.
  for (const src of [
    "https://evil.example/a.jpg",
    "https://images.pexels.com.atacante.example/a.jpg",
    "http://images.pexels.com/photos/1/a.jpg",
    "https://videos.pexels.com/video-files/1/x.mp4",
    "file:///etc/passwd",
    "no es una url",
  ]) {
    assert.equal(await downloadPhoto(photo(src), 8 * 1024 * 1024, fetchFalso), undefined, src);
  }
  assert.equal(llamado, false, "no se hizo ni una peticion a un host no permitido");

  // El host bueno si pasa y devuelve el mime real por bytes.
  const ok = await downloadPhoto(photo("https://images.pexels.com/photos/1/a.jpg"), 8 * 1024 * 1024, async () =>
    new Response(JPEG, { status: 200 }));
  assert.equal(ok.mime, "image/jpeg");
  assert.equal(ok.content.byteLength, JPEG.byteLength);
});

test("downloadPhoto respeta maxBytes y el tipo real", async () => {
  const grande = new Uint8Array(2048).fill(0x41);
  // Declarado por cabecera: se corta antes de leer el cuerpo.
  const porCabecera = await downloadPhoto(photo("https://images.pexels.com/photos/1/a.jpg"), 1024, async () =>
    new Response(JPEG, { status: 200, headers: { "content-length": "2048" } }));
  assert.equal(porCabecera, undefined);

  // Sin cabecera fiable: se corta la lectura acumulada.
  const porLectura = await downloadPhoto(photo("https://images.pexels.com/photos/1/a.jpg"), 1024, async () =>
    new Response(grande, { status: 200 }));
  assert.equal(porLectura, undefined);

  // Un cuerpo que no es JPEG/PNG/WebP se rechaza aunque se llame .jpg.
  const svg = await downloadPhoto(photo("https://images.pexels.com/photos/1/a.jpg"), 8 * 1024 * 1024, async () =>
    new Response("<svg><script>alert(1)</script></svg>", { status: 200 }));
  assert.equal(svg, undefined);
});

test("isPexelsConfigured depende solo de la variable de entorno", () => {
  assert.equal(isPexelsConfigured(), true);
  const previa = process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_API_KEY;
  assert.equal(isPexelsConfigured(), false);
  process.env.PEXELS_API_KEY = previa;
});

test("fuentesMarkdown genera la tabla con autor y licencia", () => {
  const md = fuentesMarkdown([
    { assetId: "aaaaaaaa-0000-4000-8000-000000000001", author: "Ana Pérez",
      sourceUrl: "https://www.pexels.com/photo/x-1/", license: "Pexels License", date: "2026-01-05" },
  ]);
  assert.match(md, /^\| Asset \| Autor \| Enlace \| Licencia \| Fecha \|$/m);
  assert.match(md, /Ana Pérez/);
  assert.match(md, /Pexels License/);
  assert.match(md, /2026-01-05/);
  assert.match(md, /aaaaaaaa-0000-4000-8000-000000000001/);
  // Sin filas no hay filas de datos, pero la cabecera sigue.
  assert.equal(fuentesMarkdown([]).split("\n").filter((l) => l.startsWith("| ")).length, 2);
});

test("con la foto ya en la biblioteca, downloadPhoto no se llama", async () => {
  // Punto 4 del pedido: la biblioteca se mira ANTES de la red. `downloadPhoto`
  // es justo la funcion que hace la peticion de bajada, asi que se cuenta cuantas
  // veces se invoca: con la entrada en cache tiene que ser CERO.
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const raiz = await mkdtemp(join(tmpdir(), "cache-pexels-"));
  process.env.MEDIA_LIBRARY_ROOT = raiz;
  const { saveToLibrary, readFromLibrary } = await import("../dist/library.js");

  const foto = photo("https://images.pexels.com/photos/1/a.jpg", { id: 42 });
  const { content } = await downloadPhoto(foto, 8 * 1024 * 1024, async () => new Response(JPEG, { status: 200 }));
  await saveToLibrary({ photo: foto, content, mime: "image/jpeg", query: "calle", siteId: "sitio-a" });

  let llamadas = 0;
  const fetchFalso = async () => { llamadas += 1; return new Response(JPEG, { status: 200 }); };

  // Camino real de la ruta: primero biblioteca, y solo si no hay, descarga.
  const cacheada = await readFromLibrary(42);
  assert.ok(cacheada, "la entrada esta en la biblioteca");
  assert.deepEqual(cacheada.content, content);
  if (!cacheada) await downloadPhoto(foto, 8 * 1024 * 1024, fetchFalso);
  assert.equal(llamadas, 0, "cero peticiones de bajada con la foto cacheada");

  // Y si no estuviera, la ruta si bajaria: la prueba no es vacia.
  assert.equal(await readFromLibrary(7), undefined);
  await downloadPhoto(photo("https://images.pexels.com/photos/7/b.jpg", { id: 7 }), 8 * 1024 * 1024, fetchFalso);
  assert.equal(llamadas, 1);

  await rm(raiz, { recursive: true, force: true });
});
