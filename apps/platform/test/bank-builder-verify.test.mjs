// Verificación independiente del constructor del banco (T-034). SIN red, SIN /data.
// Raíz temporal con mkdtemp; fetch falso; clave ficticia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BankBuildBusyError,
  BankBuildInputError,
  bankInventory,
  getBankBuildState,
  parseBankBuildOptions,
  startBankBuild,
} from "../dist/bank-builder.js";

process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "bank-verify-"));
  await mkdir(join(dir, "unsplash"), { recursive: true });
  return dir;
}

function jpeg(width, height) {
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

function rawPhoto({ id, alt, width = 4000, height = 2250 }) {
  return {
    id, width, height, alt_description: alt,
    urls: { regular: `https://images.unsplash.com/photo-${id}?ixid=firma` },
    links: { html: `https://unsplash.com/photos/${id}`, download_location: `https://api.unsplash.com/photos/${id}/download?ixid=firma` },
    user: { name: "Autora", links: { html: `https://unsplash.com/@${id}` } },
  };
}

function fakeFetch({ search, image }) {
  const calls = [];
  const impl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "api.unsplash.com" && url.pathname === "/search/photos") {
      const list = (await search?.()) ?? [];
      return new Response(JSON.stringify({ results: list }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "images.unsplash.com") {
      const bytes = image ? image(url) : jpeg(Number(url.searchParams.get("w")), Number(url.searchParams.get("h")));
      if (bytes === undefined) return new Response("no", { status: 404 });
      return new Response(bytes, { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

function memoryCache() {
  const store = new Map();
  return {
    store,
    readCache: async (id) => store.get(id),
    saveCache: async ({ photo, content, mime }) => { store.set(photo.id, { meta: { mime }, content }); return {}; },
  };
}

async function settle(ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = getBankBuildState();
    if (s.run === null) return s.last;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no terminó");
}

async function readManifest(root) {
  return JSON.parse(await readFile(join(root, "unsplash", "manifest.json"), "utf8"));
}

const ALT = "Modern office interior with wooden desks";

// --- Manifiesto ya completo: 0 peticiones ---------------------------------
test("V1. banco ya completo: 0 peticiones y done", async () => {
  const root = await tempRoot();
  const photos = [];
  for (let i = 1; i <= 6; i++) photos.push({ id: `h${i}`, file: `despacho/hero-0${i}.jpg`, sector: "despacho", orientation: "landscape", width: 1600, height: 900, alt: "Espacio" });
  for (let i = 1; i <= 8; i++) photos.push({ id: `g${i}`, file: `despacho/gallery-0${i}.jpg`, sector: "despacho", orientation: "squarish", width: 1200, height: 1200, alt: "Espacio" });
  await writeFile(join(root, "unsplash", "manifest.json"), JSON.stringify({ photos }));
  const f = fakeFetch({ search: () => { throw new Error("no debería buscar"); } });
  startBankBuild({ sectors: ["despacho"], hero: 6, gallery: 8 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(run.requestsUsed, 0);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(run.sectors[0].missing, { hero: 0, gallery: 0 });
});

// --- hero:0 y gallery:0 ---------------------------------------------------
test("V2. hero:0 gallery:0 no hace nada", async () => {
  const root = await tempRoot();
  const f = fakeFetch({ search: () => { throw new Error("no debería buscar"); } });
  startBankBuild({ sectors: ["despacho"], hero: 0, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(f.calls.length, 0);
});

// --- sectors: [] y sector inválido ----------------------------------------
test("V3. sectors vacío, no-array o inválido -> BankBuildInputError", () => {
  assert.throws(() => parseBankBuildOptions({ sectors: [] }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ sectors: "despacho" }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ sectors: ["oficina"] }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ sectors: [null] }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ sectors: ["__proto__"] }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ sectors: ["constructor"] }), BankBuildInputError);
});

test("V3b. sectors duplicados se deduplican", () => {
  const o = parseBankBuildOptions({ sectors: ["salud", "salud"] });
  assert.deepEqual(o.sectors, ["salud"]);
});

// --- maxRequests fuera de rango -------------------------------------------
test("V4. maxRequests 0 y 999 -> 400; 1 válido", () => {
  assert.throws(() => parseBankBuildOptions({ maxRequests: 0 }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ maxRequests: 999 }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ maxRequests: "5" }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ maxRequests: NaN }), BankBuildInputError);
  assert.throws(() => parseBankBuildOptions({ maxRequests: Infinity }), BankBuildInputError);
  assert.equal(parseBankBuildOptions({ maxRequests: 1 }).maxRequests, 1);
});

// --- maxRequests: 1 ---------------------------------------------------------
test("V5. maxRequests:1 -> una sola petición (búsqueda) y budget_exhausted", async () => {
  const root = await tempRoot();
  const candidatos = [rawPhoto({ id: "a1", alt: ALT })];
  const f = fakeFetch({ search: () => candidatos, image: undefined });
  startBankBuild({ sectors: ["despacho"], hero: 2, gallery: 0, maxRequests: 1 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "done");
  assert.equal(run.requestsUsed, 1);
  assert.equal(run.reason, "budget_exhausted");
  assert.equal(f.calls.filter((u) => u.hostname === "images.unsplash.com").length, 0, "sin presupuesto no descarga");
  assert.deepEqual(run.sectors[0].added, { hero: 0, gallery: 0 });
});

// --- manifiesto corrupto o ausente ---------------------------------------
test("V6. manifiesto corrupto -> failed, no lanza síncrono, no sobrescribe", async () => {
  const root = await tempRoot();
  const corrupto = "{ esto no es json";
  await writeFile(join(root, "unsplash", "manifest.json"), corrupto);
  const f = fakeFetch({ search: () => [rawPhoto({ id: "x", alt: ALT })], image: undefined });
  assert.doesNotThrow(() => startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() }));
  const run = await settle();
  assert.equal(run.status, "failed");
  assert.equal(await readFile(join(root, "unsplash", "manifest.json"), "utf8"), corrupto, "el manifiesto corrupto no se toca");
});

test("V7. manifiesto sin array photos -> failed", async () => {
  const root = await tempRoot();
  await writeFile(join(root, "unsplash", "manifest.json"), JSON.stringify({ photos: "no-array" }));
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: fakeFetch({ search: () => [] }), ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "failed");
});

test("V8. manifiesto ausente: se crea de cero sin lanzar", async () => {
  const root = await tempRoot();
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: fakeFetch({ search: () => [] }), ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "done");
});

test("V8b. bankInventory con manifiesto corrupto LANZA (no lo oculta)", async () => {
  const root = await tempRoot();
  await writeFile(join(root, "unsplash", "manifest.json"), "{rota");
  await assert.rejects(() => bankInventory(root));
});

// --- id con caracteres raros ---------------------------------------------
test("V9. ids raros (../, vacío, muy largo) no escapan de la carpeta del sector", async () => {
  const root = await tempRoot();
  const raros = [
    rawPhoto({ id: "../../evil", alt: ALT }),
    rawPhoto({ id: "", alt: ALT }),
    rawPhoto({ id: "x".repeat(500), alt: ALT }),
  ];
  let served = false;
  const f = fakeFetch({ search: () => { if (served) return []; served = true; return raros; } });
  startBankBuild({ sectors: ["despacho"], hero: 3, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  await settle();
  const doc = await readManifest(root).catch(() => ({ photos: [] }));
  for (const p of doc.photos) {
    assert.ok(!p.file.includes(".."), `file sin ..: ${p.file}`);
    assert.match(p.file, /^despacho\/hero-\d{2}\.(jpg|png|webp)$/);
  }
  // Ningún fichero fuera de despacho/
  const top = await readdir(join(root, "unsplash"));
  assert.ok(!top.some((n) => n.includes("evil")), "nada escrito fuera");
});

// --- foto sin alt ----------------------------------------------------------
test("V10. foto sin alt -> rechazada (no_description), no escrita", async () => {
  const root = await tempRoot();
  let served = false;
  const f = fakeFetch({ search: () => { if (served) return []; served = true; return [rawPhoto({ id: "sinalt", alt: null })]; }, image: () => jpeg(1600, 900) });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.sectors[0].skipped.no_description, 1);
  assert.equal(run.sectors[0].added.hero, 0);
});

// --- MIME no permitido -----------------------------------------------------
test("V11. contenido GIF/SVG/texto no se escribe; cuenta download_failed", async () => {
  const root = await tempRoot();
  let served = false;
  const gif = Buffer.from("GIF89a" + "x".repeat(50));
  const f = fakeFetch({
    search: () => { if (served) return []; served = true; return [rawPhoto({ id: "gif1", alt: ALT })]; },
    image: () => gif,
  });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.sectors[0].added.hero, 0);
  assert.equal(run.sectors[0].skipped.download_failed, 1);
  const files = await readdir(join(root, "unsplash", "despacho")).catch(() => []);
  assert.deepEqual(files, [], "no hay ficheros escritos");
});

test("V11b. HTML disfrazado de imagen no se escribe", async () => {
  const root = await tempRoot();
  let served = false;
  const f = fakeFetch({
    search: () => { if (served) return []; served = true; return [rawPhoto({ id: "html1", alt: ALT })]; },
    image: () => Buffer.from("<html><script>alert(1)</script></html>"),
  });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  const run = await settle();
  assert.equal(run.sectors[0].added.hero, 0);
  assert.equal((await readdir(join(root, "unsplash", "despacho")).catch(() => [])).length, 0);
});

// --- dos sectores en la misma ejecución -----------------------------------
test("V12. dos sectores en una ejecución: ficheros y manifiesto separados", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  // Cada búsqueda devuelve fotos cuyo alt encaja con el sector que la pide.
  // Se distingue por la consulta: las de salud contienen "dental"/"medical"/"physiotherapy".
  const fetchFalso = fakeFetch({
    search: (q) => {
      // La búsqueda no llega aquí con la query; se usa un contador para no depender de ella.
      return [];
    },
  });
  // Mock de búsqueda por query real: se reconstruye leyendo la URL.
  const porQuery = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/search/photos") {
      const q = url.searchParams.get("query") ?? "";
      const salud = /dental|medical|physiotherapy/.test(q);
      const list = salud
        ? [rawPhoto({ id: "salud-" + q.length + "-" + Math.random().toString(36).slice(2, 7), alt: "Dental clinic interior room with chair" })]
        : [rawPhoto({ id: "desp-" + q.length + "-" + Math.random().toString(36).slice(2, 7), alt: "Modern office interior with wooden desks" })];
      return new Response(JSON.stringify({ results: list }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "images.unsplash.com") {
      return new Response(jpeg(Number(url.searchParams.get("w")), Number(url.searchParams.get("h"))), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  startBankBuild({ sectors: ["despacho", "salud"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: porQuery, ...cache });
  const run = await settle();
  assert.equal(run.status, "done", JSON.stringify(run.sectors.map((s) => s.skipped)));
  assert.equal(run.sectors.length, 2);
  for (const s of run.sectors) assert.equal(s.added.hero, 1, `sector ${s.sector} añade 1 portada`);
  const doc = await readManifest(root);
  for (const p of doc.photos) assert.ok(p.file.startsWith(`${p.sector}/`), `${p.file} en ${p.sector}`);
  assert.deepEqual([...new Set(doc.photos.map((p) => p.sector))].sort(), ["despacho", "salud"]);
});

// --- width/height coinciden con el fichero escrito -----------------------
test("V13. width/height del manifiesto = dimensiones reales del fichero", async () => {
  const root = await tempRoot();
  let served = false;
  // Fichero real 1600x900 pero la foto de Unsplash declara 4000x2250: el manifiesto debe decir 1600x900.
  const f = fakeFetch({
    search: () => { if (served) return []; served = true; return [rawPhoto({ id: "dims", alt: ALT, width: 4000, height: 2250 })]; },
    image: () => jpeg(1600, 900),
  });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  await settle();
  const doc = await readManifest(root);
  const e = doc.photos.find((p) => p.id === "dims");
  assert.equal(e.width, 1600);
  assert.equal(e.height, 900);
});

test("V13b. fichero que declara 800x800 en hero: manifiesto refleja 800x800 (no el recorte pedido)", async () => {
  const root = await tempRoot();
  let served = false;
  const f = fakeFetch({
    search: () => { if (served) return []; served = true; return [rawPhoto({ id: "mismatch", alt: ALT })]; },
    image: () => jpeg(800, 800),
  });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  await settle();
  const doc = await readManifest(root);
  const e = doc.photos.find((p) => p.id === "mismatch");
  assert.ok(e, "entrada creada");
  // Si el fichero dice 800x800 el manifiesto debe decir 800x800 (honesto).
  assert.equal(e.width, 800);
  assert.equal(e.height, 800);
});

// --- Concurrencia: segundo arranque no arranca ----------------------------
test("V14. segundo arranque concurrente lanza BusyError y no duplica", async () => {
  const root = await tempRoot();
  let abrir;
  const cerrojo = new Promise((r) => { abrir = r; });
  const f = fakeFetch({ search: async () => { await cerrojo; return []; } });
  startBankBuild({ sectors: ["salud"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
  await new Promise((r) => setTimeout(r, 10));
  assert.throws(() => startBankBuild({ sectors: ["salud"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() }), BankBuildBusyError);
  abrir();
  await settle();
});

// --- Ráfaga de arranques: solo uno gana ------------------------------------
test("V15. ráfaga de 20 arranques simultáneos: exactamente uno arranca", async () => {
  const root = await tempRoot();
  let abrir;
  const cerrojo = new Promise((r) => { abrir = r; });
  const f = fakeFetch({ search: async () => { await cerrojo; return []; } });
  let ok = 0, busy = 0;
  for (let i = 0; i < 20; i++) {
    try { startBankBuild({ sectors: ["salud"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() }); ok++; }
    catch (e) { if (e instanceof BankBuildBusyError) busy++; else throw e; }
  }
  assert.equal(ok, 1);
  assert.equal(busy, 19);
  abrir();
  await settle();
});

// --- Ficheros de solo lectura: falla controlada ---------------------------
test("V16. directorio del sector de solo lectura: failed/omitido sin corromper manifiesto", async () => {
  const root = await tempRoot();
  const dir = join(root, "unsplash", "despacho");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o555);
  try {
    const before = JSON.stringify({ photos: [] });
    await writeFile(join(root, "unsplash", "manifest.json"), before);
    let served = false;
    const f = fakeFetch({ search: () => { if (served) return []; served = true; return [rawPhoto({ id: "ro1", alt: ALT })]; } });
    startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...memoryCache() });
    const run = await settle();
    const doc = await readManifest(root);
    // Lo importante: no se anota una foto que no existe en disco.
    for (const p of doc.photos) {
      const exists = await readFile(join(root, "unsplash", p.file)).then(() => true, () => false);
      assert.ok(exists, `entrada ${p.id} apunta a fichero existente`);
    }
    assert.ok(["done", "failed"].includes(run.status));
  } finally {
    await chmod(dir, 0o755).catch(() => {});
  }
});

// --- Id duplicado en el manifiesto no rompe ------------------------------
test("V17. manifiesto con entradas sin id ni sector no rompe el conteo", async () => {
  const root = await tempRoot();
  await writeFile(join(root, "unsplash", "manifest.json"), JSON.stringify({ photos: [null, 3, "x", {}, { sector: "despacho" }] }));
  const run0 = await bankInventory(root);
  assert.equal(run0.total, 5);
  startBankBuild({ sectors: ["despacho"], hero: 0, gallery: 0 }, { bankRoot: root, fetch: fakeFetch({ search: () => [] }), ...memoryCache() });
  const run = await settle();
  assert.equal(run.status, "done");
});

// --- El recorte no se puede elegir desde opciones ------------------------
test("V18. opciones con campo 'crop' o 'query' se ignoran y no cambian el recorte", async () => {
  const o = parseBankBuildOptions({ sectors: ["salud"], crop: "gallery", query: "cats" });
  assert.equal(o.crop, undefined);
  assert.equal(o.query, undefined);
  assert.deepEqual(Object.keys(o).sort(), ["gallery", "hero", "maxRequests", "sectors"]);
});

// --- Caché: no reconsulta lo ya guardado ----------------------------------
test("V19. foto en caché no cobra descarga ni aviso", async () => {
  const root = await tempRoot();
  const cache = memoryCache();
  const buf = jpeg(1600, 900);
  cache.store.set("cacheada", { meta: { mime: "image/jpeg" }, content: buf });
  let served = false;
  const f = fakeFetch({ search: () => { if (served) return []; served = true; return [rawPhoto({ id: "cacheada", alt: ALT })]; }, image: () => { throw new Error("no debería descargar"); } });
  startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: root, fetch: f, ...cache });
  const run = await settle();
  assert.equal(run.sectors[0].added.hero, 1);
  assert.equal(f.calls.filter((u) => u.hostname === "images.unsplash.com").length, 0);
});

// --- Timeout 0 ya cubierto; cuerpo no-objeto -----------------------------
test("V20. entradas de tipo erróneo (string, array, null, número) -> BankBuildInputError", () => {
  for (const malo of ["x", [], 42, true]) {
    assert.throws(() => parseBankBuildOptions(malo), BankBuildInputError, JSON.stringify(malo));
  }
  // null se trata como "sin cuerpo" en el código: documentamos el comportamiento.
  assert.doesNotThrow(() => parseBankBuildOptions(null));
});

test("V21. hero/gallery no enteros o negativos o fuera de 12 -> 400", () => {
  for (const v of [-1, 13, 1.5, NaN, "3", null, [1]]) {
    assert.throws(() => parseBankBuildOptions({ hero: v }), BankBuildInputError, `hero=${JSON.stringify(v)}`);
    assert.throws(() => parseBankBuildOptions({ gallery: v }), BankBuildInputError, `gallery=${JSON.stringify(v)}`);
  }
});
