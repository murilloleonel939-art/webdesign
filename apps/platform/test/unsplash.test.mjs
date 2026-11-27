import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUnsplashConfigured,
  searchUnsplash,
  downloadUnsplash,
  notifyUnsplashDownload,
  MAX_PHOTO_BYTES,
} from "../dist/unsplash.js";

// Unsplash: busqueda, descarga y aviso SIN red real.
//
// Todo `fetch` se inyecta. Ninguna prueba de este archivo abre una conexion: si
// alguna lo hiciera, se veria como un fallo intermitente en CI. Lo que se fija
// aqui es el contrato de fallo (un tercero caido no rompe una subida de fotos)
// y la regla de la clave: no sale de `process.env`.

const CLAVE = "clave-de-prueba-no-real";
process.env.UNSPLASH_API_KEY = CLAVE;

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

const REGULAR = "https://images.unsplash.com/photo-1?ixid=abc";

function crudo(extra = {}) {
  return {
    id: "v-KZt2CRU6Y",
    width: 4000,
    height: 2250,
    alt_description: "Sala de reuniones con mesa larga",
    urls: { raw: `${REGULAR}&w=raw`, regular: REGULAR, small: `${REGULAR}&w=400` },
    links: {
      html: "https://unsplash.com/photos/v-KZt2CRU6Y",
      download_location: "https://api.unsplash.com/photos/v-KZt2CRU6Y/download?ixid=abc",
    },
    user: { name: "Deliberately AI", links: { html: "https://unsplash.com/@msordille" } },
    ...extra,
  };
}

function foto(extra = {}) {
  return {
    id: "v-KZt2CRU6Y",
    width: 1600,
    height: 900,
    alt: "",
    url: "https://unsplash.com/photos/v-KZt2CRU6Y",
    downloadLocation: "https://api.unsplash.com/photos/v-KZt2CRU6Y/download?ixid=abc",
    photographer: "Deliberately AI",
    photographerUrl: "https://unsplash.com/@msordille",
    sourceUrl: "https://unsplash.com/photos/v-KZt2CRU6Y",
    regularUrl: `${REGULAR}&w=1600&h=900&fit=crop&q=80&fm=jpg`,
    ...extra,
  };
}

test("1. sin clave: isUnsplashConfigured false y searchUnsplash [] sin llamar a fetch", async () => {
  const previa = process.env.UNSPLASH_API_KEY;
  delete process.env.UNSPLASH_API_KEY;
  assert.equal(isUnsplashConfigured(), false);

  let llamado = false;
  const fetchFalso = async () => {
    llamado = true;
    return Response.json({ results: [crudo()] });
  };
  assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 5 }, fetchFalso), []);
  assert.equal(llamado, false, "sin clave no se hace ni una peticion");

  // Y una clave en blanco cuenta como ausente.
  process.env.UNSPLASH_API_KEY = "   ";
  assert.equal(isUnsplashConfigured(), false);
  assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 5 }, fetchFalso), []);
  assert.equal(llamado, false);

  process.env.UNSPLASH_API_KEY = previa;
  assert.equal(isUnsplashConfigured(), true);
});

test("2. con clave: Authorization Client-ID y los parametros pedidos", async () => {
  let visto;
  const fetchFalso = async (url, init) => {
    visto = { url: String(url), init };
    return Response.json({ results: [] });
  };
  await searchUnsplash("  sala de reuniones  ", { orientation: "squarish", perPage: 7 }, fetchFalso);

  assert.match(visto.url, /^https:\/\/api\.unsplash\.com\/search\/photos\?/);
  const params = new URL(visto.url).searchParams;
  assert.equal(params.get("query"), "sala de reuniones", "la consulta va recortada");
  assert.equal(params.get("per_page"), "7");
  assert.equal(params.get("orientation"), "squarish");
  assert.equal(visto.init.headers.Authorization, `Client-ID ${CLAVE}`);
  assert.equal(visto.init.method, "GET");
  assert.ok(visto.init.signal, "la peticion lleva senal de timeout");
});

test("3. respuesta valida: se mapean todos los campos", async () => {
  const fetchFalso = async () => Response.json({ results: [crudo()], total: 1, total_pages: 1 });
  const out = await searchUnsplash("oficina", { orientation: "landscape", perPage: 3 }, fetchFalso);
  assert.equal(out.length, 1);
  const p = out[0];
  assert.equal(p.id, "v-KZt2CRU6Y");
  assert.equal(p.width, 4000);
  assert.equal(p.height, 2250);
  assert.equal(p.alt, "Sala de reuniones con mesa larga");
  assert.equal(p.url, "https://unsplash.com/photos/v-KZt2CRU6Y");
  assert.equal(p.sourceUrl, "https://unsplash.com/photos/v-KZt2CRU6Y");
  assert.equal(p.downloadLocation, "https://api.unsplash.com/photos/v-KZt2CRU6Y/download?ixid=abc");
  assert.equal(p.photographer, "Deliberately AI");
  assert.equal(p.photographerUrl, "https://unsplash.com/@msordille");
  // La URL del binario lleva el recorte y conserva la query original.
  assert.match(p.regularUrl, /^https:\/\/images\.unsplash\.com\/photo-1\?ixid=abc&w=1600&h=900&fit=crop&q=80&fm=jpg$/);
  // Ni la clave ni la cabecera acaban en el resultado.
  assert.equal(JSON.stringify(out).includes(CLAVE), false);
});

test("4. results que no es array (o falta) devuelve []", async () => {
  for (const cuerpo of [
    { results: {} },
    { results: "nada" },
    { results: null },
    {},
    { results: 7 },
  ]) {
    const fetchFalso = async () => Response.json(cuerpo);
    assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 3 }, fetchFalso), [], JSON.stringify(cuerpo));
  }
});

test("5. consulta vacia o solo espacios devuelve [] sin llamar", async () => {
  let llamado = false;
  const fetchFalso = async () => {
    llamado = true;
    return Response.json({ results: [crudo()] });
  };
  for (const q of ["", "   ", "\n\t "]) {
    assert.deepEqual(await searchUnsplash(q, { orientation: "landscape", perPage: 3 }, fetchFalso), []);
  }
  assert.equal(llamado, false, "una consulta vacia no gasta una peticion");
});

test("6. perPage fuera de rango se acota (100 -> 30, 0 -> 1)", async () => {
  const vistos = [];
  const fetchFalso = async (url) => {
    vistos.push(new URL(String(url)).searchParams.get("per_page"));
    return Response.json({ results: [] });
  };
  await searchUnsplash("oficina", { orientation: "landscape", perPage: 100 }, fetchFalso);
  await searchUnsplash("oficina", { orientation: "landscape", perPage: 0 }, fetchFalso);
  await searchUnsplash("oficina", { orientation: "landscape", perPage: -5 }, fetchFalso);
  await searchUnsplash("oficina", { orientation: "landscape", perPage: Number.NaN }, fetchFalso);
  assert.deepEqual(vistos, ["30", "1", "1", "10"]);
});

test("7. downloadUnsplash decide el MIME por bytes", async () => {
  for (const [bytes, esperado] of [
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
  ]) {
    const out = await downloadUnsplash(foto(), async () => new Response(bytes, { status: 200 }));
    assert.equal(out.mime, esperado);
    assert.deepEqual(out.content, Buffer.from(bytes));
  }

  // Ni SVG (aunque se llame .jpg) ni HTML ni texto pasan.
  for (const cuerpo of ["<svg><script>alert(1)</script></svg>", "<!doctype html>", "no soy una imagen"]) {
    const out = await downloadUnsplash(foto(), async () => new Response(cuerpo, { status: 200 }));
    assert.equal(out, undefined, cuerpo);
  }

  // El tipo declarado en la cabecera no manda: bytes de texto con content-type
  // de JPEG se rechazan igual.
  const mentiroso = await downloadUnsplash(foto(), async () =>
    new Response("no soy una imagen", { status: 200, headers: { "content-type": "image/jpeg" } }));
  assert.equal(mentiroso, undefined, "la cabecera se falsifica, manda el contenido");

  // Todo se pide con redirect: "error" y una senal de timeout.
  let init;
  await downloadUnsplash(foto(), async (_url, i) => {
    init = i;
    return new Response(JPEG, { status: 200 });
  });
  assert.equal(init.redirect, "error");
  assert.ok(init.signal);
});

test("8. content-length por encima de 6 MB se rechaza sin leer el cuerpo", async () => {
  // Se cuenta `getReader()`/`arrayBuffer()`, no el `pull` del stream: un
  // ReadableStream se rellena en cuanto se construye la Response, asi que el
  // `pull` no distingue entre "nadie lo leyo" y "alguien empezo a leer".
  let lecturas = 0;
  const res = {
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(MAX_PHOTO_BYTES + 1) }),
    body: {
      getReader() {
        lecturas += 1;
        throw new Error("no se debe leer el cuerpo");
      },
    },
    async arrayBuffer() {
      lecturas += 1;
      throw new Error("no se debe leer el cuerpo");
    },
  };
  assert.equal(await downloadUnsplash(foto(), async () => res), undefined);
  assert.equal(lecturas, 0, "no se leyo ni un trozo del cuerpo");

  // Sin content-length fiable, el corte ocurre al leer: un cuerpo mayor que el
  // tope se descarta entero en vez de acumularse en memoria.
  const enorme = new Uint8Array(MAX_PHOTO_BYTES + 1024);
  enorme.set([0xff, 0xd8, 0xff], 0);
  const sinCabecera = await downloadUnsplash(foto(), async () => new Response(enorme, { status: 200 }));
  assert.equal(sinCabecera, undefined, "un cuerpo demasiado grande se descarta");

  // Y el limite exacto si pasa: la prueba no es un rechazo a todo.
  const justo = new Uint8Array(MAX_PHOTO_BYTES);
  justo.set([0xff, 0xd8, 0xff], 0);
  const borde = await downloadUnsplash(foto(), async () => new Response(justo, { status: 200 }));
  assert.equal(borde.mime, "image/jpeg");
});

test("9. notifyUnsplashDownload no lanza aunque fetch falle", async () => {
  // `fetch` que lanza, respuesta HTTP de error y URL inaceptable: ninguno lanza.
  await notifyUnsplashDownload(foto(), async () => {
    throw new Error("ECONNREFUSED");
  });
  await notifyUnsplashDownload(foto(), async () => new Response("nope", { status: 500 }));

  // El aviso solo sale hacia api.unsplash.com y con la cabecera de Unsplash.
  let visto;
  await notifyUnsplashDownload(foto(), async (url, init) => {
    visto = { url: String(url), init };
    return Response.json({});
  });
  assert.equal(visto.url, "https://api.unsplash.com/photos/v-KZt2CRU6Y/download?ixid=abc");
  assert.equal(visto.init.headers.Authorization, `Client-ID ${CLAVE}`);

  // Un `download_location` de otro host no se pide.
  let llamado = false;
  await notifyUnsplashDownload(foto({ downloadLocation: "https://evil.example/x" }), async () => {
    llamado = true;
    return Response.json({});
  });
  assert.equal(llamado, false);

  // Sin clave no hay aviso posible, y tampoco lanza.
  const previa = process.env.UNSPLASH_API_KEY;
  delete process.env.UNSPLASH_API_KEY;
  let llamadoSinClave = false;
  await notifyUnsplashDownload(foto(), async () => {
    llamadoSinClave = true;
    return Response.json({});
  });
  assert.equal(llamadoSinClave, false);
  process.env.UNSPLASH_API_KEY = previa;
});

test("10. un error HTTP de la API devuelve [] sin lanzar", async () => {
  for (const status of [401, 403, 429, 500, 502]) {
    const fetchFalso = async () => new Response("error", { status });
    assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 3 }, fetchFalso), [], String(status));
  }

  // Red caida y cuerpo que no es JSON: mismo trato.
  const rompe = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 3 }, rompe), []);
  const basura = async () => new Response("no soy json", { status: 200 });
  assert.deepEqual(await searchUnsplash("oficina", { orientation: "landscape", perPage: 3 }, basura), []);
});

test("extra: downloadUnsplash no baja de hosts ajenos ni por http", async () => {
  let llamado = false;
  const fetchFalso = async () => {
    llamado = true;
    return new Response(JPEG, { status: 200 });
  };
  for (const url of [
    "https://evil.example/a.jpg",
    "https://images.unsplash.com.atacante.example/a.jpg",
    "http://images.unsplash.com/photo-1",
    "file:///etc/passwd",
    "no es una url",
    "",
  ]) {
    assert.equal(await downloadUnsplash(foto({ regularUrl: url }), fetchFalso), undefined, url);
  }
  assert.equal(llamado, false, "no se hizo ni una peticion a un host no permitido");

  // Un error de descarga HTTP tampoco lanza.
  const noOk = await downloadUnsplash(foto(), async () => new Response("nope", { status: 404 }));
  assert.equal(noOk, undefined);
});
