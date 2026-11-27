// Constructor del banco de fotos (T-034), SIN red y SIN /data.
//
// Todo lo que toca el mundo exterior se inyecta: `fetch` falso, raíz del banco en
// `os.tmpdir()` y una caché en memoria. Ninguna prueba abre una conexión ni
// escribe fuera de su carpeta temporal; si alguna lo hiciera, se vería como un
// fallo intermitente en CI.
//
// Lo que se fija aquí es el contrato: el banco solo crece, nunca se sobrescribe
// un fichero, el presupuesto se respeta, el alt se juzga en inglés y se publica
// en castellano, y una foto que no se puede bajar no tumba la ejecución.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../dist/server.js";
import {
  BankBuildBusyError,
  BankBuildInputError,
  bankInventory,
  getBankBuildState,
  parseBankBuildOptions,
  startBankBuild,
} from "../dist/bank-builder.js";
import { filterPhoto } from "../dist/photo-filter.js";

// `searchUnsplash` exige la clave para hacer algo; el valor no es real y no sale
// de este proceso.
process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let seq = 0;

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "bank-build-"));
  await mkdir(join(dir, "unsplash"), { recursive: true });
  return dir;
}

/** JPEG mínimo con un SOF0 que declara `width`x`height`: el parser lo lee. */
function jpeg(width, height) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

/** Foto tal como la devuelve la API de Unsplash (respuesta cruda). */
function rawPhoto({ id, alt, width = 4000, height = 2250, artist = "Autora de prueba" }) {
  return {
    id,
    width,
    height,
    alt_description: alt,
    urls: { regular: `https://images.unsplash.com/photo-${id}?ixid=firma` },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=firma`,
    },
    user: { name: artist, links: { html: `https://unsplash.com/@${id}` } },
  };
}

/**
 * `fetch` falso: busca, descarga y aviso, todo en memoria.
 *
 * La imagen que sirve respeta el recorte que pide la URL (`w`/`h`), así que el
 * tamaño que acaba en el manifiesto es el del fichero de verdad.
 */
function fakeFetch(plan = {}) {
  const calls = [];
  const impl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "api.unsplash.com" && url.pathname === "/search/photos") {
      // `await`: el plan puede tardar a propósito (prueba de concurrencia).
      const list = (await plan.search?.(url.searchParams.get("query") ?? "", url.searchParams.get("orientation") ?? "")) ?? [];
      return new Response(JSON.stringify({ results: list }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.hostname === "images.unsplash.com") {
      const bytes = plan.image?.(url);
      if (bytes === undefined) return new Response("no", { status: 404 });
      return new Response(bytes, { status: 200 });
    }
    // Aviso de descarga (`api.unsplash.com/photos/<id>/download`).
    return new Response("{}", { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

/** Fichero que sirve el fake por defecto: el tamaño que pide la URL. */
function imageFromUrl(url) {
  return jpeg(Number(url.searchParams.get("w") ?? 1600), Number(url.searchParams.get("h") ?? 900));
}

/** Caché en memoria con la misma forma que la de disco. */
function memoryCache() {
  const store = new Map();
  return {
    store,
    readCache: async (id) => store.get(id),
    saveCache: async ({ photo, content, mime, query }) => {
      store.set(photo.id, {
        meta: {
          id: photo.id,
          alt: photo.alt,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          sourceUrl: photo.sourceUrl,
          downloadLocation: photo.downloadLocation,
          mime,
          query,
          savedAt: new Date().toISOString(),
        },
        content,
      });
      return { id: photo.id };
    },
    // La caché es la lista de ids que hay en disco; aquí, las claves del mapa.
    listCache: async () => [...store.keys()],
    markNotified: async (id) => {
      const entry = store.get(id);
      if (entry) entry.meta = { ...entry.meta, notifiedAt: new Date().toISOString() };
    },
  };
}

/** Manifiesto con la misma forma que el real. */
function manifestDoc(photos, extra = {}) {
  return {
    source: "Unsplash",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    attributionRequired: true,
    utmSource: "zottaweb",
    ...extra,
    photos,
  };
}

function entry({ id, file, sector, orientation = "landscape", alt = "Espacio de trabajo", width = 1600, height = 900 }) {
  return {
    id,
    file,
    sector,
    orientation,
    width,
    height,
    alt,
    photographer: { name: "Autora", profileUrl: "https://unsplash.com/@autora" },
    unsplashUrl: "https://unsplash.com/?utm_source=zottaweb&utm_medium=referral",
    photoPageUrl: `https://unsplash.com/photos/${id}`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
  };
}

async function writeManifest(root, doc) {
  await writeFile(join(root, "unsplash", "manifest.json"), JSON.stringify(doc, null, 2), "utf8");
}

async function readManifest(root) {
  return JSON.parse(await readFile(join(root, "unsplash", "manifest.json"), "utf8"));
}

/** Espera a que la ejecución en curso termine y devuelve su estado final. */
async function settle(ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = getBankBuildState();
    if (state.run === null) return state.last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("la construcción no terminó a tiempo");
}

const HERO_ALT = "Modern office interior with wooden desks";

const execFileAsync = promisify(execFile);

/**
 * Pool falso para las rutas del panel: solo las dos consultas que hacen falta
 * (sesión y rol). Ni base de datos ni red.
 */
function fakeOperatorPool() {
  const query = async (sql) => {
    if (/auth_lookup_session/.test(sql)) {
      return { rows: [{ id: "33333333-3333-4333-8333-333333333333", user_id: "22222222-2222-4222-8222-222222222222" }] };
    }
    if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: "operator" }] };
    return { rows: [] };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

// ---------------------------------------------------------------------------
// 1. Añade hasta el objetivo y no repite lo que ya está
// ---------------------------------------------------------------------------

test("1. añade hasta el objetivo por sector y no repite ids del manifiesto", async () => {
  const root = await tempRoot();
  const cache = memoryCache();

  // Banco de partida: una portada de despacho ya publicada.
  await mkdir(join(root, "unsplash", "despacho"), { recursive: true });
  await writeFile(join(root, "unsplash", "despacho", "hero-01.jpg"), jpeg(1600, 900));
  await writeManifest(root, manifestDoc([
    entry({ id: "ya-existe", file: "despacho/hero-01.jpg", sector: "despacho" }),
  ]));

  // Doce candidatos, uno de ellos ya en el banco.
  const candidates = [rawPhoto({ id: "ya-existe", alt: HERO_ALT })];
  for (let i = 0; i < 11; i += 1) {
    candidates.push(rawPhoto({ id: `nueva-${i}`, alt: `${HERO_ALT} numero ${i}` }));
  }
  const fetchFalso = fakeFetch({ search: () => candidates, image: imageFromUrl });

  const started = startBankBuild(
    { sectors: ["despacho"], hero: 6, gallery: 0, maxRequests: 40 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  assert.equal(started.status, "running");
  assert.deepEqual(started.sectors[0].planned, { hero: 6, gallery: 0 });

  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(run.reason, null);
  assert.deepEqual(run.sectors[0].added, { hero: 5, gallery: 0 });
  assert.deepEqual(run.sectors[0].missing, { hero: 0, gallery: 0 });
  // La repetida se cuenta como tal, no se vuelve a bajar.
  assert.equal(run.sectors[0].skipped.duplicate, 1);

  const doc = await readManifest(root);
  const propias = doc.photos.filter((p) => p.sector === "despacho" && p.orientation === "landscape");
  assert.equal(propias.length, 6, "seis portadas en el sector");
  assert.equal(new Set(doc.photos.map((p) => p.id)).size, doc.photos.length, "sin ids repetidos");
  assert.ok(doc.photos.some((p) => p.id === "ya-existe"), "la entrada previa sigue ahí");

  // Los ficheros empiezan en 02 porque 01 ya estaba.
  const ficheros = (await readdir(join(root, "unsplash", "despacho"))).sort();
  assert.deepEqual(ficheros, ["hero-01.jpg", "hero-02.jpg", "hero-03.jpg", "hero-04.jpg", "hero-05.jpg", "hero-06.jpg"]);

  // Dimensiones reales del fichero y atribución con utm.
  const nueva = propias.find((p) => p.id !== "ya-existe");
  assert.equal(nueva.width, 1600);
  assert.equal(nueva.height, 900);
  assert.match(nueva.photographer.profileUrl, /utm_source=zottaweb&utm_medium=referral$/);
  assert.match(nueva.photoPageUrl, /utm_source=zottaweb&utm_medium=referral$/);

  // El inventario lee lo mismo que el manifiesto.
  const inventario = await bankInventory(root);
  assert.equal(inventario.sectors.find((s) => s.sector === "despacho").hero, 6);
  assert.equal(inventario.total, 6);

  // Y queda como última ejecución para el panel.
  assert.equal(getBankBuildState().run, null);
  assert.equal(getBankBuildState().last.id, run.id);
  assert.ok(run.finishedAt, "la ejecución tiene fecha de cierre");
});

// ---------------------------------------------------------------------------
// 2. Presupuesto
// ---------------------------------------------------------------------------

test("2. con el presupuesto agotado termina en done y deja missing correcto", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const candidatos = [];
  for (let i = 0; i < 10; i += 1) candidatos.push(rawPhoto({ id: `comercio-${i}`, alt: "Boutique store interior with shelves" }));
  const fetchFalso = fakeFetch({ search: () => candidatos, image: imageFromUrl });

  startBankBuild(
    { sectors: ["comercio"], hero: 6, gallery: 0, maxRequests: 3 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();

  assert.equal(run.status, "done");
  assert.equal(run.reason, "budget_exhausted");
  assert.equal(run.requestsUsed, 3);
  assert.equal(run.budget, 3);
  // Búsqueda (1) + descarga (2) + aviso (3): entra una foto y no queda para más.
  assert.deepEqual(run.sectors[0].added, { hero: 1, gallery: 0 });
  assert.deepEqual(run.sectors[0].missing, { hero: 5, gallery: 0 });
  assert.equal(run.sectors[0].error, undefined);
});

// ---------------------------------------------------------------------------
// 3. Nunca sobrescribe ni pierde lo que había
// ---------------------------------------------------------------------------

test("3. no pisa ficheros existentes y conserva cabecera y entradas previas", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  await mkdir(join(root, "unsplash", "despacho"), { recursive: true });

  // Fichero huérfano: está en el disco pero no en el manifiesto (una ejecución
  // anterior murió antes de anotarlo). No se puede pisar.
  const sentinela = Buffer.from("no me pises");
  await writeFile(join(root, "unsplash", "despacho", "hero-02.jpg"), sentinela);
  await writeManifest(root, manifestDoc(
    [entry({ id: "vieja", file: "despacho/hero-99.jpg", sector: "despacho" })],
    { nota: "cabecera que no se puede perder" },
  ));

  const candidatos = [0, 1, 2].map((i) => rawPhoto({ id: `nueva3-${i}`, alt: `${HERO_ALT} ${i}` }));
  startBankBuild(
    { sectors: ["despacho"], hero: 3, gallery: 0 },
    { bankRoot: root, fetch: fakeFetch({ search: () => candidatos, image: imageFromUrl }), ...cache },
  );
  const run = await settle();
  assert.equal(run.reason, null);
  // El manifiesto ya contaba una portada (`vieja`), así que solo faltaban dos.
  assert.deepEqual(run.sectors[0].added, { hero: 2, gallery: 0 });

  assert.deepEqual(await readFile(join(root, "unsplash", "despacho", "hero-02.jpg")), sentinela);

  const doc = await readManifest(root);
  assert.equal(doc.nota, "cabecera que no se puede perder");
  for (const key of ["source", "license", "licenseUrl", "attributionRequired", "utmSource"]) {
    assert.ok(doc[key] !== undefined, `la cabecera conserva ${key}`);
  }
  assert.ok(doc.photos.some((p) => p.id === "vieja"), "la entrada previa sigue ahí");
  const nuevos = doc.photos.filter((p) => p.id.startsWith("nueva3-")).map((p) => p.file).sort();
  assert.deepEqual(nuevos, ["despacho/hero-03.jpg", "despacho/hero-04.jpg"]);
});

// ---------------------------------------------------------------------------
// 4. Alt: se filtra en inglés y se publica en castellano
// ---------------------------------------------------------------------------

test("4. filtra con el alt inglés y escribe el alt en castellano", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const ingles = "Modern office with a wooden desk";
  const candidatos = [rawPhoto({ id: "idioma-1", alt: ingles })];
  startBankBuild(
    { sectors: ["despacho"], hero: 1, gallery: 0 },
    { bankRoot: root, fetch: fakeFetch({ search: () => candidatos, image: imageFromUrl }), ...cache },
  );
  const run = await settle();
  assert.deepEqual(run.sectors[0].added, { hero: 1, gallery: 0 });

  const doc = await readManifest(root);
  const nueva = doc.photos.find((p) => p.id === "idioma-1");
  assert.equal(nueva.alt, "Espacio de trabajo");
  assert.notEqual(nueva.alt, ingles);

  // Y el porqué: con el alt ya traducido, el mismo filtro cae en `off_topic`.
  const foto = {
    id: "idioma-1",
    width: 4000,
    height: 2250,
    alt: nueva.alt,
    url: "",
    downloadLocation: "",
    photographer: "",
    photographerUrl: "",
    sourceUrl: "",
    regularUrl: "",
  };
  const veredicto = filterPhoto({ photo: foto, sector: "despacho", orientation: "landscape", knownIds: new Set() });
  assert.equal(veredicto.accepted, false);
  assert.equal(veredicto.reason, "off_topic");
});

// ---------------------------------------------------------------------------
// 5. Rechazos por motivo
// ---------------------------------------------------------------------------

test("5. cuenta los rechazos por motivo", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  await writeManifest(root, manifestDoc([
    entry({ id: "ya-existe", file: "despacho/hero-01.jpg", sector: "despacho" }),
  ]));

  const candidatos = [
    rawPhoto({ id: "ya-existe", alt: HERO_ALT }),                          // duplicate
    rawPhoto({ id: "pequena", alt: HERO_ALT, width: 800 }),               // too_small
    rawPhoto({ id: "sin-alt", alt: "" }),                                 // no_description
    rawPhoto({ id: "retrato", alt: "Portrait of a smiling woman in an office" }), // portrait_or_people
    rawPhoto({ id: "marca", alt: "Office desk with an Apple laptop" }),   // brand
    rawPhoto({ id: "cuadrada", alt: HERO_ALT, width: 4000, height: 4000 }), // aspect_mismatch
    rawPhoto({ id: "bici", alt: "A red bicycle parked on a street" }),    // off_topic
  ];
  // Se sirve la lista una vez y luego vacío: así cada rechazo cuenta una vez y
  // no tres (una por consulta del sector).
  let servido = false;
  const fetchFalso = fakeFetch({
    search: () => {
      if (servido) return [];
      servido = true;
      return candidatos;
    },
    image: imageFromUrl,
  });

  startBankBuild(
    { sectors: ["despacho"], hero: 6, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();
  assert.deepEqual(run.sectors[0].added, { hero: 0, gallery: 0 });
  const skipped = run.sectors[0].skipped;
  for (const motivo of ["duplicate", "too_small", "no_description", "portrait_or_people", "brand", "aspect_mismatch", "off_topic"]) {
    assert.equal(skipped[motivo], 1, `un rechazo por ${motivo}`);
  }
  // La entrada previa del manifiesto ya cuenta como una portada de las seis.
  assert.equal(run.sectors[0].missing.hero, 5);
});

// ---------------------------------------------------------------------------
// 6. Un fallo de descarga no tumba nada
// ---------------------------------------------------------------------------

test("6. un fallo de descarga se cuenta y no corrompe el manifiesto", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const previa = entry({ id: "previa", file: "despacho/hero-01.jpg", sector: "despacho" });
  await writeManifest(root, manifestDoc([previa]));

  const candidatos = [rawPhoto({ id: "rota", alt: HERO_ALT }), rawPhoto({ id: "buena", alt: `${HERO_ALT} luminoso` })];
  let servido = false;
  const fetchFalso = fakeFetch({
    search: () => {
      if (servido) return [];
      servido = true;
      return candidatos;
    },
    // La primera foto no se puede bajar; las demás sí.
    image: (url) => (url.pathname.includes("rota") ? undefined : imageFromUrl(url)),
  });

  // Se piden tres portadas: el manifiesto ya trae una, así que hay dos huecos y
  // las dos candidatas se intentan (el orden lo decide el ranking, no la API).
  startBankBuild(
    { sectors: ["despacho"], hero: 3, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();

  assert.equal(run.status, "done");
  assert.equal(run.sectors[0].skipped.download_failed, 1);
  assert.deepEqual(run.sectors[0].added, { hero: 1, gallery: 0 });

  const doc = await readManifest(root);
  assert.equal(doc.photos.length, 2, "manifiesto legible y con la entrada nueva");
  assert.ok(doc.photos.some((p) => p.id === "previa"));
  assert.ok(doc.photos.some((p) => p.id === "buena"));
  assert.ok(!doc.photos.some((p) => p.id === "rota"), "la que falló no se anota");
});

// ---------------------------------------------------------------------------
// 7. Una sola ejecución a la vez
// ---------------------------------------------------------------------------

test("7. no arranca una segunda ejecución mientras la primera corre", async () => {
  const root = await tempRoot();
  const cache = memoryCache();

  let abrir = () => {};
  const cerrojo = new Promise((resolve) => { abrir = resolve; });
  const fetchFalso = fakeFetch({
    search: async () => {
      await cerrojo;
      return [];
    },
  });

  startBankBuild(
    { sectors: ["salud"], hero: 2, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  // La ejecución está en el aire: la búsqueda no ha respondido.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(getBankBuildState().run?.status, "running");
  assert.throws(
    () => startBankBuild({ sectors: ["salud"], hero: 2 }, { bankRoot: root, fetch: fetchFalso, ...cache }),
    BankBuildBusyError,
  );

  abrir();
  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(getBankBuildState().run, null);
});

// ---------------------------------------------------------------------------
// 8. Tope de tiempo y validación de opciones
// ---------------------------------------------------------------------------

test("8. se para por tiempo y deja la ejecución cerrada", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const fetchFalso = fakeFetch({ search: () => [rawPhoto({ id: "tarde", alt: HERO_ALT })], image: imageFromUrl });

  startBankBuild(
    { sectors: ["despacho"], hero: 2, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, timeoutMs: 0, ...cache },
  );
  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(run.reason, "timeout");
  assert.equal(run.requestsUsed, 0, "sin tiempo no se gasta ni una petición");
  assert.equal(fetchFalso.calls.length, 0);
});

test("9. las opciones inválidas se rechazan y no dejan nada a medias", async () => {
  for (const malo of [
    { sectors: ["cocina"] },
    { sectors: [] },
    { sectors: "despacho" },
    { hero: 13 },
    { hero: -1 },
    { gallery: 2.5 },
    { maxRequests: 0 },
    { maxRequests: 201 },
    { hero: "6" },
    "no soy un objeto",
  ]) {
    assert.throws(() => parseBankBuildOptions(malo), BankBuildInputError, JSON.stringify(malo));
    assert.throws(() => startBankBuild(malo), BankBuildInputError, JSON.stringify(malo));
  }

  // Sin cuerpo vale todo por defecto.
  const opciones = parseBankBuildOptions(undefined);
  assert.equal(opciones.hero, 6);
  assert.equal(opciones.gallery, 8);
  assert.equal(opciones.maxRequests, 40);
  assert.equal(opciones.sectors.length, 7);

  // Y una petición inválida no deja ninguna ejecución en curso.
  assert.equal(getBankBuildState().run, null);
});

// ---------------------------------------------------------------------------
// 10. Galería: búsqueda cuadrada, recorte 1200x1200 y CREDITS.md
// ---------------------------------------------------------------------------

test("10. la galería se busca en cuadrado y se guarda a 1200x1200", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const candidatos = [
    rawPhoto({ id: "salon-1", alt: "Hair salon interior with mirrors", width: 3000, height: 3000 }),
    rawPhoto({ id: "salon-2", alt: "Beauty salon interior with chairs", width: 3000, height: 3000 }),
  ];
  const fetchFalso = fakeFetch({ search: () => candidatos, image: imageFromUrl });

  startBankBuild(
    { sectors: ["belleza"], hero: 0, gallery: 2 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();
  assert.deepEqual(run.sectors[0].added, { hero: 0, gallery: 2 });
  assert.deepEqual(run.sectors[0].missing, { hero: 0, gallery: 0 });

  // La búsqueda se pidió en cuadrado, que es lo que Unsplash entiende.
  const busquedas = fetchFalso.calls.filter((u) => u.pathname === "/search/photos");
  assert.ok(busquedas.length > 0);
  assert.equal(busquedas[0].searchParams.get("orientation"), "squarish");
  assert.equal(busquedas[0].searchParams.get("per_page"), "30");

  // Y la descarga pidió el recorte de galería.
  const descargas = fetchFalso.calls.filter((u) => u.hostname === "images.unsplash.com");
  assert.ok(descargas.every((u) => u.searchParams.get("w") === "1200" && u.searchParams.get("h") === "1200"));

  const doc = await readManifest(root);
  for (const foto of doc.photos) {
    assert.equal(foto.orientation, "squarish");
    assert.equal(foto.width, 1200);
    assert.equal(foto.height, 1200);
    assert.match(foto.file, /^belleza\/gallery-0[12]\.jpg$/);
  }

  // CREDITS.md con el mismo formato que el del banco.
  const creditos = await readFile(join(root, "unsplash", "CREDITS.md"), "utf8");
  assert.match(creditos, /^# Créditos de las fotos\n/);
  assert.match(creditos, /\| Foto \| Autor \| Licencia \|/);
  assert.match(creditos, /\| `belleza\/gallery-01\.jpg` \| \[Autora de prueba\]\(https:\/\/unsplash\.com\/@salon-1\?utm_source=zottaweb&utm_medium=referral\) \| \[Unsplash License\]\(https:\/\/unsplash\.com\/license\) \|/);
});

test("11. un banco que aún no existe se inventaría sin lanzar", async () => {
  const root = await tempRoot();
  const inventario = await bankInventory(root);
  assert.equal(inventario.total, 0);
  assert.equal(inventario.sectors.length, 7);
  assert.ok(inventario.sectors.every((s) => s.hero === 0 && s.gallery === 0));
  assert.equal(getBankBuildState().run, null);
});

// ---------------------------------------------------------------------------
// 12. Manifiesto corrupto: el módulo lanza, la ruta responde 500 y el proceso vive
// ---------------------------------------------------------------------------

test("12. un manifiesto corrupto no tumba el servidor: GET /api/operator/bank da 500", async () => {
  const dir = await tempRoot();
  await writeFile(join(dir, "unsplash", "manifest.json"), "{roto");

  // El módulo es estricto a propósito: un banco ilegible es un fallo que hay que
  // ver, no un banco vacío.
  await assert.rejects(() => bankInventory(dir), /manifest_unreadable/);

  const previo = process.env.PHOTO_BANK_ROOT;
  process.env.PHOTO_BANK_ROOT = dir;
  let server;
  try {
    server = createApp({ pool: fakeOperatorPool(), sitesRoot: dir }).listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    // La ruta traduce la excepción a un error controlado. Si no lo hiciera, la
    // promesa rechazada no tendría quien la recoja y mataría el proceso.
    const r = await fetch(`${base}/api/operator/bank`, { headers: { cookie: "sid=token-de-prueba" } });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "inventory_unreadable" });

    // Y sigue atendiendo: el detalle va al registro, no a la respuesta.
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    server?.close();
    if (previo === undefined) delete process.env.PHOTO_BANK_ROOT;
    else process.env.PHOTO_BANK_ROOT = previo;
  }
});

// ---------------------------------------------------------------------------
// 13. Dos procesos sobre el MISMO volumen: temporales exclusivos
// ---------------------------------------------------------------------------

// Guion que corre en un proceso aparte: una construcción corta que reescribe el
// manifiesto y CREDITS.md varias veces. Dos de estos a la vez sobre la misma
// carpeta es lo que pasa con más de una réplica de la plataforma.
const CHILD_SCRIPT = `
import { startBankBuild, getBankBuildState } from __DIST__;
const root = process.argv[1];
const tag = process.argv[2];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x06, 0x40, 0x03,
  1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
const items = [0, 1, 2, 3].map((i) => ({
  id: tag + "-" + i,
  width: 4000,
  height: 2250,
  alt_description: "Modern office interior with wooden desks " + i,
  urls: { regular: "https://images.unsplash.com/photo-" + tag + "-" + i },
  links: {
    html: "https://unsplash.com/photos/" + tag + "-" + i,
    download_location: "https://api.unsplash.com/photos/" + tag + "-" + i + "/download",
  },
  user: { name: "Autora en paralelo", links: { html: "https://unsplash.com/@paralelo" } },
}));
const fetchFalso = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === "/search/photos") {
    return new Response(JSON.stringify({ results: items }), { status: 200 });
  }
  if (url.hostname === "images.unsplash.com") return new Response(jpeg, { status: 200 });
  return new Response("{}", { status: 200 });
};
startBankBuild(
  { sectors: ["despacho"], hero: 4, gallery: 0, maxRequests: 40 },
  { bankRoot: root, fetch: fetchFalso, readCache: async () => undefined, saveCache: async () => ({}) },
);
while (getBankBuildState().run !== null) await new Promise((r) => setTimeout(r, 5));
`;

test("13. dos procesos escriben a la vez sin dejar temporales ni JSON a medias", async () => {
  const root = await tempRoot();
  const dist = new URL("../dist/bank-builder.js", import.meta.url).href;
  const script = CHILD_SCRIPT.replace("__DIST__", JSON.stringify(dist));

  const lanzar = (tag) =>
    execFileAsync(process.execPath, ["--input-type=module", "-e", script, root, tag], { timeout: 30000 });
  // En paralelo de verdad: dos procesos, la misma raíz.
  await Promise.all([lanzar("proc-a"), lanzar("proc-b")]);

  // Ningún temporal huérfano, ni en la raíz del banco ni en el sector.
  for (const dir of [join(root, "unsplash"), join(root, "unsplash", "despacho")]) {
    const nombres = await readdir(dir);
    assert.deepEqual(nombres.filter((n) => n.endsWith(".tmp")), [], `temporales en ${dir}`);
  }

  // El manifiesto es válido y es de uno de los dos, no una mezcla.
  const doc = JSON.parse(await readFile(join(root, "unsplash", "manifest.json"), "utf8"));
  assert.ok(Array.isArray(doc.photos), "photos sigue siendo una lista");
  assert.ok(doc.photos.length > 0, "alguna foto quedó anotada");
  assert.ok(doc.photos.every((p) => typeof p.id === "string" && typeof p.file === "string"));

  // Y los créditos se pueden leer enteros.
  const creditos = await readFile(join(root, "unsplash", "CREDITS.md"), "utf8");
  assert.match(creditos, /^\| Foto \| Autor \| Licencia \|$/m);
});

// ---------------------------------------------------------------------------
// 14. Caché primero: rellenar sin gastar ni una petición
// ---------------------------------------------------------------------------

const CONSULTA_DESPACHO = "modern office interior desks";

/** Mete una foto ya descargada en la caché en memoria. */
function enCache(cache, { id, alt, query = CONSULTA_DESPACHO, width = 1600, height = 900, notifiedAt }) {
  cache.store.set(id, {
    meta: {
      id,
      alt,
      photographer: "Autora en caché",
      photographerUrl: "https://unsplash.com/@cache",
      sourceUrl: `https://unsplash.com/photos/${id}`,
      downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
      mime: "image/jpeg",
      query,
      savedAt: new Date().toISOString(),
      ...(notifiedAt === undefined ? {} : { notifiedAt }),
    },
    content: jpeg(width, height),
  });
}

test("14. la caché rellena el sector sin buscar ni descargar (0 peticiones)", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  enCache(cache, { id: "cache-1", alt: "Modern office interior with desks" });
  enCache(cache, { id: "cache-2", alt: "Bright office workspace with chairs and desks" });

  // `fetch` que falla si alguien lo llama: la caché tiene que bastar.
  const fetchFalso = fakeFetch({
    search: () => {
      throw new Error("no se debe buscar en la red");
    },
    image: () => {
      throw new Error("no se debe descargar");
    },
  });

  startBankBuild(
    { sectors: ["despacho"], hero: 2, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();

  assert.deepEqual(run.sectors[0].added, { hero: 2, gallery: 0 });
  assert.deepEqual(run.sectors[0].fromCache, { hero: 2, gallery: 0 });
  assert.equal(run.requestsUsed, 0, "ni una petición");
  assert.equal(fetchFalso.calls.length, 0, "fetch ni se tocó");

  const doc = await readManifest(root);
  assert.deepEqual(doc.photos.map((p) => p.id).sort(), ["cache-1", "cache-2"]);
  assert.equal(doc.photos[0].width, 1600);
});

test("15. la caché que no encaja no se usa: se busca en la red", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  // Cuadrada (no vale para portada), de otro sector y con otra consulta.
  enCache(cache, { id: "cuadrada", alt: "Modern office interior with desks", width: 1200, height: 1200 });
  enCache(cache, { id: "otro-sector", alt: "Hair salon interior with mirrors" });
  enCache(cache, { id: "otra-consulta", alt: "Modern office interior with desks", query: "something else" });

  const candidatos = [rawPhoto({ id: "de-red", alt: "Modern office interior with a long desk" })];
  const fetchFalso = fakeFetch({ search: () => candidatos, image: imageFromUrl });

  startBankBuild(
    { sectors: ["despacho"], hero: 1, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();

  assert.deepEqual(run.sectors[0].added, { hero: 1, gallery: 0 });
  assert.deepEqual(run.sectors[0].fromCache, { hero: 0, gallery: 0 });
  assert.ok(fetchFalso.calls.some((u) => u.pathname === "/search/photos"), "se buscó de verdad");

  const doc = await readManifest(root);
  assert.deepEqual(doc.photos.map((p) => p.id), ["de-red"]);
});

// ---------------------------------------------------------------------------
// 16. Ranking: se guardan las mejores, no las primeras
// ---------------------------------------------------------------------------

test("16. el ranking puntúa por términos del sector y por proporción, siempre igual", async () => {
  // Se ejecuta dos veces el mismo escenario: si el orden dependiera del azar o
  // del orden de la API, las dos pasadas darían cosas distintas.
  const ejecutar = async (candidatas) => {
    const root = await tempRoot();
    const cache = memoryCache();
    let servido = false;
    const fetchFalso = fakeFetch({
      search: () => {
        if (servido) return [];
        servido = true;
        // La API las devuelve en un orden: si se guardara por llegada, ganaría
        // la primera de la lista.
        return candidatas;
      },
      image: imageFromUrl,
    });
    startBankBuild(
      { sectors: ["despacho"], hero: 2, gallery: 0 },
      { bankRoot: root, fetch: fetchFalso, ...cache },
    );
    const run = await settle();
    assert.equal(run.reason, null);
    return (await readManifest(root)).photos.map((p) => p.id);
  };

  // A) MISMOS términos del sector ("office" una vez cada una): decide la
  // proporción. La mejor lleva id posterior, así que no gana por desempate.
  const porProporcion = await ejecutar([
    rawPhoto({ id: "aaa-cruzada", alt: "Office interior with a wide view", width: 3100, height: 2000 }),
    rawPhoto({ id: "zzz-16-9", alt: "Office interior with a wide view", width: 3200, height: 1800 }),
  ]);
  assert.equal(porProporcion[0], "zzz-16-9", "misma descripción: gana la proporción del recorte");

  // B) MISMA proporción 16:9: decide el número de términos del sector. La de más
  // términos también lleva id posterior.
  const porTerminos = await ejecutar([
    rawPhoto({ id: "aaa-generica", alt: "Bright modern office at sunset", width: 3200, height: 1800 }),
    rawPhoto({ id: "zzz-especifica", alt: "Office interior with wooden desks and chairs", width: 3200, height: 1800 }),
  ]);
  assert.equal(porTerminos[0], "zzz-especifica", "misma proporción: gana la que nombra más el sector");

  // Y repetir el escenario da exactamente el mismo orden.
  assert.deepEqual(await ejecutar([
    rawPhoto({ id: "aaa-generica", alt: "Bright modern office at sunset", width: 3200, height: 1800 }),
    rawPhoto({ id: "zzz-especifica", alt: "Office interior with wooden desks and chairs", width: 3200, height: 1800 }),
  ]), porTerminos);
});

// ---------------------------------------------------------------------------
// 17. Tope de fotos por ejecución
// ---------------------------------------------------------------------------

test("17. maxPhotos corta la pasada en done/photo_cap y el siguiente clic sigue", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const candidatos = [0, 1, 2, 3].map((i) => rawPhoto({ id: `cascada-${i}`, alt: `Modern office interior with desks ${i}` }));
  let servido = false;
  const fetchFalso = fakeFetch({
    search: () => {
      if (servido) return [];
      servido = true;
      return candidatos;
    },
    image: imageFromUrl,
  });

  startBankBuild(
    { sectors: ["despacho"], hero: 4, gallery: 0, maxPhotos: 2 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const primero = await settle();

  assert.equal(primero.status, "done");
  assert.equal(primero.reason, "photo_cap");
  assert.deepEqual(primero.sectors[0].added, { hero: 2, gallery: 0 });
  assert.deepEqual(primero.sectors[0].missing, { hero: 2, gallery: 0 });
  assert.equal(primero.cap, 2);
  assert.equal((await readManifest(root)).photos.length, 2, "solo dos, aunque sobraba presupuesto");

  // Segundo clic: sin tope de peticiones, añade las siguientes.
  servido = false;
  startBankBuild(
    { sectors: ["despacho"], hero: 4, gallery: 0, maxPhotos: 2 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const segundo = await settle();
  assert.deepEqual(segundo.sectors[0].added, { hero: 2, gallery: 0 });
  assert.deepEqual(segundo.sectors[0].missing, { hero: 0, gallery: 0 });
  assert.equal((await readManifest(root)).photos.length, 4);
});

// ---------------------------------------------------------------------------
// 18. El aviso a Unsplash no se repite
// ---------------------------------------------------------------------------

test("18. el aviso se hace una vez y queda anotado; con notifiedAt no se repite", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const avisos = () => cache.store.get("foto-aviso")?.meta.notifiedAt;
  const candidatos = [rawPhoto({ id: "foto-aviso", alt: "Modern office interior with desks" })];
  let servido = false;
  const fetchFalso = fakeFetch({
    search: () => {
      if (servido) return [];
      servido = true;
      return candidatos;
    },
    image: imageFromUrl,
  });

  startBankBuild(
    { sectors: ["despacho"], hero: 1, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();
  assert.deepEqual(run.sectors[0].added, { hero: 1, gallery: 0 });

  const descargas = fetchFalso.calls.filter((u) => u.hostname === "images.unsplash.com").length;
  const avisados = fetchFalso.calls.filter((u) => u.pathname.endsWith("/download")).length;
  assert.equal(descargas, 1);
  assert.equal(avisados, 1, "un aviso por descarga");
  assert.ok(avisos(), "queda anotado en la caché");

  // Segunda pasada sobre un banco limpio: la foto ya está en la caché y ya se
  // anunció, así que ni se descarga ni se vuelve a avisar.
  const root2 = await tempRoot();
  const antes = fetchFalso.calls.length;
  startBankBuild(
    { sectors: ["despacho"], hero: 1, gallery: 0 },
    { bankRoot: root2, fetch: fetchFalso, ...cache },
  );
  const segundo = await settle();
  assert.deepEqual(segundo.sectors[0].fromCache, { hero: 1, gallery: 0 });
  const nuevos = fetchFalso.calls.slice(antes);
  assert.equal(nuevos.filter((u) => u.pathname.endsWith("/download")).length, 0, "no se avisa otra vez");
  assert.equal(nuevos.filter((u) => u.hostname === "images.unsplash.com").length, 0, "no se descarga otra vez");
});

// ---------------------------------------------------------------------------
// 19. maxPhotos inválido
// ---------------------------------------------------------------------------

test("19. maxPhotos inválido se rechaza", async () => {
  for (const malo of [0, 51, "5", 2.5, -1, null]) {
    assert.throws(() => parseBankBuildOptions({ maxPhotos: malo }), BankBuildInputError, JSON.stringify(malo));
  }
  assert.equal(parseBankBuildOptions({}).maxPhotos, 5, "por defecto, cinco");
  assert.equal(parseBankBuildOptions({ maxPhotos: 1 }).maxPhotos, 1);
  assert.equal(parseBankBuildOptions({ maxPhotos: 50 }).maxPhotos, 50);
});

// ---------------------------------------------------------------------------
// 20. La misma foto no entra dos veces (caché y red solapadas)
// ---------------------------------------------------------------------------

test("20. una foto que está en la caché y vuelve en la búsqueda entra una sola vez", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  // Caso real: una ejecución anterior murió después de guardar en la caché y
  // antes de anotar en el manifiesto, así que la foto está en disco pero no
  // consta. La búsqueda la devuelve de nuevo.
  enCache(cache, { id: "solape", alt: "Modern office interior with wooden desks" });

  let servido = false;
  const fetchFalso = fakeFetch({
    search: () => {
      if (servido) return [];
      servido = true;
      return [rawPhoto({ id: "solape", alt: "Modern office interior with wooden desks and chairs" })];
    },
    image: imageFromUrl,
  });

  startBankBuild(
    { sectors: ["despacho"], hero: 2, gallery: 0 },
    { bankRoot: root, fetch: fetchFalso, ...cache },
  );
  const run = await settle();

  // Una sola entrada y un solo fichero, aunque había dos huecos y la foto llegó
  // por los dos caminos.
  const doc = await readManifest(root);
  assert.deepEqual(doc.photos.map((p) => p.id), ["solape"]);
  assert.equal(run.sectors[0].added.hero, 1);
  assert.equal(run.sectors[0].skipped.duplicate, 1, "la segunda llegada se cuenta como repetida");
  assert.deepEqual(run.sectors[0].fromCache, { hero: 1, gallery: 0 });

  const ficheros = (await readdir(join(root, "unsplash", "despacho"))).sort();
  assert.deepEqual(ficheros, ["hero-01.jpg"], "un solo fichero en el sector");

  // Y no se bajó nada: la que vino de la red sobraba antes de pedir el binario.
  const descargas = fetchFalso.calls.filter((u) => u.hostname === "images.unsplash.com");
  assert.equal(descargas.length, 0, "ni una descarga");
});
