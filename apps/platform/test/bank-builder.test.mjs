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
    saveCache: async ({ photo, content, mime }) => {
      store.set(photo.id, { meta: { mime }, content });
      return { id: photo.id };
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

  startBankBuild(
    { sectors: ["despacho"], hero: 2, gallery: 0 },
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
