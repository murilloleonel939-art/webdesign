import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// T-032c-cache: Unsplash conectado a la ruta interna de fotos, con cache en
// disco. SIN red y SIN Postgres: `globalThis.fetch` es un doble y el pool imita
// a `pg`. Ninguna prueba toca /data, deploy/photo-bank ni claves reales.

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "55555555-5555-4555-8555-555555555555";
const USER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const JTI = "44444444-4444-4444-8444-444444444444";

const CLAVE = "clave-de-prueba-no-real";
const LIB = await mkdtemp(join(tmpdir(), "ip-unsplash-lib-"));
const bank = await mkdtemp(join(tmpdir(), "ip-unsplash-bank-"));
const sitesRoot = await mkdtemp(join(tmpdir(), "ip-unsplash-sites-"));
process.env.MEDIA_LIBRARY_ROOT = LIB;
process.env.PHOTO_BANK_ROOT = bank;
delete process.env.PEXELS_API_KEY;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 0x20), Buffer.from([0xff, 0xd9])]);

// Banco mínimo: UNA foto landscape en `salud` (el sector del brief). Con
// `count` 1 el banco cubre; con 3 no cubre y es cuando entra Unsplash.
const entry = (id, file, orientation) => ({
  id, file, sector: "salud", orientation, width: 1600, height: 900, alt: `foto ${id}`,
  photographer: { name: "Banco Test" }, photoPageUrl: `https://unsplash.com/photos/${id}`,
});
await mkdir(join(bank, "unsplash", "salud"), { recursive: true });
const photos = [entry("h1", "salud/hero-01.jpg", "landscape")];
for (let i = 1; i <= 4; i++) photos.push(entry(`s${i}`, `salud/sq-0${i}.jpg`, "squarish"));
for (const p of photos) await writeFile(join(bank, "unsplash", p.file), JPEG);
await writeFile(join(bank, "unsplash", "manifest.json"), JSON.stringify({ license: "Unsplash License", photos }));

const { handleInternalPhotos } = await import("../dist/internal-photos.js");

// ---- doble de `fetch` -------------------------------------------------------

/** Resultado crudo de la API de búsqueda para un id dado. */
function crudo(id, nombre = "Foto Grafo") {
  const regular = `https://images.unsplash.com/photo-${id}?ixid=abc`;
  return {
    id,
    width: 4000,
    height: 2250,
    alt_description: `alt de ${id}`,
    urls: { regular },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc`,
    },
    user: { name: nombre, links: { html: "https://unsplash.com/@fotografo" } },
  };
}

/**
 * Doble de fetch que SepARA por host: busca, descarga y aviso se cuentan aparte
 * porque el contrato es distinto (una búsqueda por petición, cero descargas si
 * la foto ya está en la caché).
 */
function espiaFetch({ ids = ["u-one", "u-two"], nombre } = {}) {
  const llamadas = { search: 0, download: 0, notify: 0, total: 0, urls: [] };
  const impl = async (input) => {
    // El cliente pasa `string` en la búsqueda y `URL` en la descarga.
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    llamadas.total += 1;
    llamadas.urls.push(url);
    if (url.startsWith("https://api.unsplash.com/search/photos")) {
      llamadas.search += 1;
      return Response.json({ results: ids.map((id) => crudo(id, nombre)) });
    }
    if (url.startsWith("https://api.unsplash.com/photos/") && url.includes("/download")) {
      llamadas.notify += 1;
      return new Response("{}", { status: 200 });
    }
    if (url.startsWith("https://images.unsplash.com/")) {
      llamadas.download += 1;
      return new Response(JPEG, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(JPEG.byteLength) },
      });
    }
    throw new Error(`fetch inesperado: ${url}`);
  };
  globalThis.fetch = impl;
  return llamadas;
}

// ---- doble de `pg` ----------------------------------------------------------

/** Fila con las claves que `pg` pondria: alias si hay `AS "x"`, si no la columna. */
function pgRow(sql, values) {
  const out = {};
  const cols = /SELECT([\s\S]+?)FROM/i.exec(sql)[1].split(",").map((s) => s.trim());
  cols.forEach((c, i) => {
    const alias = /AS\s+"([^"]+)"/i.exec(c);
    out[alias ? alias[1] : c] = values[i];
  });
  return out;
}

function fakePool({ siteId = SITE_A, usados = [] } = {}) {
  const inserts = [];
  const query = async (sql, values = []) => {
    if (/app_agent_token_check/.test(sql)) {
      return { rows: [pgRow(sql, [RUN, USER, siteId])], rowCount: 1 };
    }
    if (/SELECT source_url, credit_text FROM assets/.test(sql)) {
      return { rows: usados.map((u) => ({ source_url: u, credit_text: null })), rowCount: usados.length };
    }
    if (/FROM sites WHERE id = \$1 AND owner_id/.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (/SUM\(bytes\)/.test(sql)) return { rows: [{ total: "0", n: "0" }], rowCount: 1 };
    if (/INSERT INTO assets/.test(sql)) { inserts.push(values); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  };
  return { inserts, query, connect: async () => ({ query, release() {} }) };
}

function request(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = { authorization: `Bearer ${JTI}` };
  return req;
}

function response() {
  const res = { status: 0, body: "" };
  res.writeHead = (s) => { res.status = s; };
  res.end = (b) => { res.body = b ?? ""; };
  return res;
}

const fotos = (siteId) => new URL(`http://p/api/internal/sites/${siteId}/photos`);

async function pedir({ siteId = SITE_A, body, pool = fakePool({ siteId }) }) {
  const res = response();
  await handleInternalPhotos(pool, sitesRoot, request(body), res, fotos(siteId));
  return { res, pool, json: JSON.parse(res.body) };
}

/** Eventos de consola capturados: es la única prueba de "esto vino de la caché". */
async function conLogs(fn) {
  const info = [];
  const warn = [];
  const oi = console.info;
  const ow = console.warn;
  console.info = (...a) => info.push(a);
  console.warn = (...a) => warn.push(a);
  try { return { value: await fn(), info, warn }; } finally { console.info = oi; console.warn = ow; }
}

const cacheDir = (id) => join(LIB, "unsplash-cache", id);

test.beforeEach(() => { process.env.UNSPLASH_API_KEY = CLAVE; });

test("el banco cubre el count: NO se llama a Unsplash", async () => {
  const llamadas = espiaFetch();
  const { res, json } = await pedir({ body: { query: "clinica", orientation: "landscape", count: 1, sector: "salud" } });
  assert.equal(res.status, 200, res.body);
  assert.equal(json.photos.length, 1);
  assert.equal(llamadas.total, 0, `fetch inesperado: ${JSON.stringify(llamadas.urls)}`);
});

test("el banco no cubre: una búsqueda, descarga y queda en unsplash-cache/<id>/", async () => {
  const llamadas = espiaFetch();
  const { res, json } = await pedir({ body: { query: "clinica dental", orientation: "landscape", count: 3, sector: "salud" } });
  assert.equal(res.status, 200, res.body);
  assert.equal(json.photos.length, 3);
  assert.equal(llamadas.search, 1, "una sola búsqueda");
  assert.equal(llamadas.download, 2, "una descarga por foto nueva");
  assert.equal(llamadas.notify, 2, "un aviso por descarga nueva");
  // perPage = min(30, count * 3) = 9.
  const busqueda = llamadas.urls.find((u) => u.includes("/search/photos"));
  assert.match(busqueda, /per_page=9(&|$)/);

  for (const id of ["u-one", "u-two"]) {
    const ficheros = (await readdir(cacheDir(id))).sort();
    assert.deepEqual(ficheros, [`${id}.jpg`, "meta.json"].sort());
    const meta = JSON.parse(await readFile(join(cacheDir(id), "meta.json"), "utf8"));
    assert.equal(meta.id, id);
    assert.equal(meta.photographer, "Foto Grafo");
    assert.equal(meta.sourceUrl, `https://unsplash.com/photos/${id}`);
    assert.equal(meta.downloadLocation, `https://api.unsplash.com/photos/${id}/download?ixid=abc`);
    assert.equal(meta.mime, "image/jpeg");
    assert.equal(meta.query, "clinica dental");
    assert.equal(meta.alt, `alt de ${id}`);
    assert.ok(Date.parse(meta.savedAt) > 0, "savedAt es una fecha");
    // El binario es el que se bajó, no un fichero vacío.
    assert.equal((await readFile(join(cacheDir(id), `${id}.jpg`))).byteLength, JPEG.byteLength);
  }
});

test("segunda petición con el mismo id: cero descargas, sale de la caché", async () => {
  assert.ok(existsSync(cacheDir("u-one")), "la prueba anterior dejó la caché");
  const llamadas = espiaFetch();
  const { value, info } = await conLogs(() =>
    pedir({ siteId: SITE_B, body: { query: "clinica dental", orientation: "landscape", count: 3, sector: "salud" } }),
  );
  assert.equal(value.res.status, 200, value.res.body);
  assert.equal(value.json.photos.length, 3);
  assert.equal(llamadas.download, 0, "no se vuelve a bajar del CDN");
  assert.equal(llamadas.notify, 0, "un acierto de caché no es una descarga nueva");
  assert.equal(llamadas.search, 1, "la búsqueda es una por petición");
  const hits = info.filter(([t]) => t === "unsplash_cache_hit").map(([, d]) => d.id);
  assert.deepEqual(hits.sort(), ["u-one", "u-two"]);
});

test("sin clave: se salta sin lanzar y responde con lo del banco", async () => {
  delete process.env.UNSPLASH_API_KEY;
  const llamadas = espiaFetch();
  const { res, json } = await pedir({ body: { query: "clinica", orientation: "landscape", count: 3, sector: "salud" } });
  assert.equal(res.status, 200, res.body);
  assert.equal(json.photos.length, 1, "solo la del banco");
  assert.equal(llamadas.total, 0);
});

test("rights que llega a registerAsset lleva autor, licencia y sourceUrl", async () => {
  espiaFetch({ ids: ["u-rights"], nombre: "Autora Derechos" });
  const { pool } = await pedir({
    siteId: SITE_A,
    body: { query: "clinica", orientation: "landscape", count: 2, sector: "salud" },
    pool: fakePool({ siteId: SITE_A }),
  });
  // INSERT: id, siteId, rel, kind, bytes, mime, source, license, author, source_url, credit_text
  const fila = pool.inserts.find((v) => v[8] === "Autora Derechos");
  assert.ok(fila, `sin fila de Unsplash: ${JSON.stringify(pool.inserts.map((v) => v[8]))}`);
  assert.equal(fila[7], "Unsplash License");
  assert.equal(fila[8], "Autora Derechos");
  assert.equal(fila[9], "https://unsplash.com/photos/u-rights");
  assert.match(fila[10], /Autora Derechos · Unsplash License · https:\/\/unsplash\.com\/photos\/u-rights/);
});

test("la caché corrupta (fichero vacío) se ignora y se vuelve a descargar", async () => {
  const id = "u-corrupt";
  await mkdir(cacheDir(id), { recursive: true });
  await writeFile(join(cacheDir(id), `${id}.jpg`), "");
  await writeFile(join(cacheDir(id), "meta.json"), JSON.stringify({
    id, alt: "", photographer: "Viejo", photographerUrl: "", sourceUrl: `https://unsplash.com/photos/${id}`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download`, mime: "image/jpeg",
    query: "roto", savedAt: "2026-01-01T00:00:00.000Z",
  }));
  const llamadas = espiaFetch({ ids: [id] });
  const { res, json } = await pedir({
    siteId: SITE_A,
    body: { query: "roto", orientation: "landscape", count: 2, sector: "salud" },
  });
  assert.equal(res.status, 200, res.body);
  assert.ok(json.photos.some((p) => typeof p.assetId === "string"));
  assert.equal(llamadas.download, 1, "un fichero vacío se vuelve a bajar");
  const meta = JSON.parse(await readFile(join(cacheDir(id), "meta.json"), "utf8"));
  assert.equal(meta.query, "roto", "meta reescrita por la descarga nueva");
  assert.equal((await readFile(join(cacheDir(id), `${id}.jpg`))).byteLength, JPEG.byteLength);
});

test("banco y Unsplash conviven: la foto ya usada se descarta sin arrastrar al banco", async () => {
  const llamadas = espiaFetch({ ids: ["u-dup", "u-nueva"] });
  // En el sitio ya hay una foto de Unsplash con id `u-dup`, y la página del
  // banco: el dedupe de Unsplash no puede saltarse la del banco ni al revés.
  const pool = fakePool({ siteId: SITE_A, usados: ["https://unsplash.com/photos/u-dup"] });
  const { res, json } = await pedir({
    siteId: SITE_A,
    body: { query: "clinica", orientation: "landscape", count: 3, sector: "salud" },
    pool,
  });
  assert.equal(res.status, 200, res.body);
  // banco (1) + u-nueva: `u-dup` se descarta por su id.
  assert.equal(json.photos.length, 2);
  assert.equal(llamadas.download, 1, "solo se baja la que no estaba usada");
  const ids = llamadas.urls.filter((u) => u.startsWith("https://images.unsplash.com/")).map((u) => u.split("photo-")[1].split("?")[0]);
  assert.deepEqual(ids, ["u-nueva"]);
});

test("un id que no sirve para una carpeta se descarta sin tumbar la petición", async () => {
  const llamadas = espiaFetch({ ids: ["../../etc/passwd", "u-sana"] });
  const { res, json } = await pedir({
    siteId: SITE_A,
    body: { query: "clinica", orientation: "landscape", count: 3, sector: "salud" },
  });
  assert.equal(res.status, 200, res.body);
  // banco (1) + u-sana; el id con `/` no llega ni a descargarse.
  assert.equal(json.photos.length, 2);
  assert.equal(llamadas.download, 1);
  const descargadas = llamadas.urls.filter((u) => u.startsWith("https://images.unsplash.com/"));
  assert.equal(descargadas.length, 1);
  assert.match(descargadas[0], /photo-u-sana/);
});

test.after(async () => {
  for (const dir of [LIB, bank, sitesRoot]) await rm(dir, { recursive: true, force: true });
});
