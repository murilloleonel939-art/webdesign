// Tests for photo-bank.ts (compiled to dist/photo-bank.js)
// No depende de fotos en el repositorio: todo en /tmp.
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Entrada del manifiesto de Unsplash con la forma real (photographer.name,
// photoPageUrl, id de cadena). Los tests escriben manifiestos de este tamaño en
// /tmp: no dependen de las fotos del repositorio.
const entry = ({ id, file, sector, orientation, alt }) => ({
  id,
  file,
  sector,
  orientation,
  width: 1600,
  height: orientation === "landscape" ? 900 : 1200,
  alt,
  photographer: { name: "Test", profileUrl: "https://unsplash.com/@test" },
  unsplashUrl: "https://unsplash.com/",
  photoPageUrl: `https://unsplash.com/photos/${id}`,
  downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
});

// Banco real del repositorio (deploy/photo-bank). Los tests corren desde
// apps/platform, así que la raíz del repo está tres niveles arriba.
const REAL_BANK = fileURLToPath(new URL("../../../deploy/photo-bank", import.meta.url));

// Manifiesto REAL, leído del disco tal cual llega: es la fuente de verdad de los
// conteos. Las pruebas no escriben números a mano (los tenían escritos y dejaron
// de ser ciertos cuando el banco creció de 37 a 98 fotos): preguntan cuántas hay
// y afirman que el módulo devuelve ese mismo número.
//
// Ojo con el vocabulario: el manifiesto usa los términos de Unsplash
// (`landscape` / `squarish`) y `photo-bank.ts` normaliza `squarish` → `square`
// al cargar. La prueba normaliza igual para poder contar por orientación.
const REAL_MANIFEST = join(REAL_BANK, "unsplash", "manifest.json");
const realManifest = JSON.parse(await readFile(REAL_MANIFEST, "utf8"));

/** La misma normalización que hace `toBankPhoto`. */
const manifestOrientation = (value) =>
  value === "landscape" ? "landscape" : value === "squarish" || value === "square" ? "square" : undefined;

/** Fotos del manifiesto de ese sector (o de todos si `sector` es undefined) y orientación. */
const manifestCount = (sector, orientation) =>
  realManifest.photos.filter(
    (p) => manifestOrientation(p.orientation) === orientation && (sector === undefined || p.sector === sector),
  ).length;

/** Sectores distintos que tienen al menos una foto de esa orientación. */
const manifestSectors = (orientation) =>
  new Set(
    realManifest.photos.filter((p) => manifestOrientation(p.orientation) === orientation).map((p) => p.sector),
  );

// JPEG mínimo de 1×1 (magic ffd8ff garantizado) + padding hasta pasar 20 KB.
// Se construye a partir de un JPEG real mínimo y se añaden bytes en la zona de
// comentarios (marcador FF FE + longitud + datos), que los decodificadores
// ignoran pero que cuentan para el tamaño del archivo.
function makeJpeg(targetSize = 25000) {
  // SOI + APP0 + relleno en comentario JPEG + EOI
  // Marcador de comentario: FF FE <len-hi> <len-lo> <datos>
  // len incluye los 2 bytes de longitud.
  const soi = Buffer.from([0xff, 0xd8]);                     // Start of Image
  const eoi = Buffer.from([0xff, 0xd9]);                     // End of Image
  // Comentario con padding. Necesitamos targetSize - 2(soi) - 2(eoi) - 4(hdr) bytes de datos.
  const dataLen = Math.max(1, targetSize - 2 - 2 - 4);
  const commentHeader = Buffer.from([0xff, 0xfe, (dataLen + 2) >> 8 & 0xff, (dataLen + 2) & 0xff]);
  const commentData = Buffer.alloc(dataLen, 0x20); // espacios
  return Buffer.concat([soi, commentHeader, commentData, eoi]);
}

let t = Date.now();
const next = () => `../dist/photo-bank.js?t=${t++}`;

// ---- Test 1: banco vacío → listBankPhotos devuelve [] sin lanzar ----
{
  const dir = await mkdtemp(join(tmpdir(), "pb-test-"));
  try {
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ license: "x", source: "x", photos: [] }));
    process.env["PHOTO_BANK_ROOT"] = dir;
    const mod = await import(next());
    mod._resetBankCache();

    let threw = false;
    let result;
    try { result = await mod.listBankPhotos("landscape"); } catch { threw = true; }
    assert.ok(!threw, "banco vacío: no debe lanzar");
    assert.deepEqual(result, [], "banco vacío: landscape=[]");

    let result2;
    try { result2 = await mod.listBankPhotos("square"); } catch { threw = true; }
    assert.deepEqual(result2, [], "banco vacío: square=[]");
    console.log("ℹ tests 1 pass: banco vacío devuelve []");
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env["PHOTO_BANK_ROOT"];
  }
}

// ---- Test 2: PHOTO_BANK_ROOT inexistente → [] sin lanzar ----
{
  process.env["PHOTO_BANK_ROOT"] = "/nonexistent/path/does/not/exist/at/all";
  const mod = await import(next());
  mod._resetBankCache();

  let threw = false;
  let result;
  try { result = await mod.listBankPhotos("landscape"); } catch { threw = true; }
  assert.ok(!threw, "directorio inexistente: no debe lanzar");
  assert.deepEqual(result, [], "directorio inexistente: []");
  delete process.env["PHOTO_BANK_ROOT"];
  console.log("ℹ tests 2 pass: PHOTO_BANK_ROOT inexistente devuelve []");
}

// ---- Test 3: manifiesto corrupto (JSON roto) → [] sin lanzar ----
{
  const dir = await mkdtemp(join(tmpdir(), "pb-test-"));
  try {
    await writeFile(join(dir, "manifest.json"), "{ this is not valid json !!!");
    process.env["PHOTO_BANK_ROOT"] = dir;
    const mod = await import(next());
    mod._resetBankCache();

    let threw = false;
    let result;
    try { result = await mod.listBankPhotos("landscape"); } catch { threw = true; }
    assert.ok(!threw, "JSON roto: no debe lanzar");
    assert.deepEqual(result, [], "JSON roto: []");
    console.log("ℹ tests 3 pass: manifiesto corrupto devuelve []");
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env["PHOTO_BANK_ROOT"];
  }
}

// ---- Test 4: banco con 2 JPEG reales en /tmp → listBankPhotos=2, readBankPhoto OK ----
{
  const dir = await mkdtemp(join(tmpdir(), "pb-test-"));
  try {
    await mkdir(join(dir, "unsplash"), { recursive: true });
    const manifest = {
      license: "Unsplash License",
      source: "Unsplash",
      photos: [
        entry({ id: "aaa-001", file: "salud/hero-01.jpg", sector: "salud", orientation: "landscape", alt: "Foto A" }),
        entry({ id: "aaa-002", file: "salud/hero-02.jpg", sector: "salud", orientation: "landscape", alt: "Foto B" }),
      ],
    };
    await writeFile(join(dir, "unsplash", "manifest.json"), JSON.stringify(manifest));
    await mkdir(join(dir, "unsplash", "salud"), { recursive: true });
    await writeFile(join(dir, "unsplash", "salud", "hero-01.jpg"), makeJpeg(25000));
    await writeFile(join(dir, "unsplash", "salud", "hero-02.jpg"), makeJpeg(25000));
    process.env["PHOTO_BANK_ROOT"] = dir;
    const mod = await import(next());
    mod._resetBankCache();

    const landscapes = await mod.listBankPhotos("landscape");
    assert.equal(landscapes.length, 2, "2 fotos landscape");

    const r = await mod.readBankPhoto(landscapes[0]);
    assert.ok(r !== undefined, "readBankPhoto debe devolver resultado");
    assert.ok(r.content.byteLength > 20000, `content > 20 KB (got ${r.content.byteLength})`);
    assert.equal(r.mime, "image/jpeg", "mime=image/jpeg");
    console.log("ℹ tests 4 pass: banco con 2 JPEG → listBankPhotos=2, readBankPhoto OK");
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env["PHOTO_BANK_ROOT"];
  }
}

// ---- Test 5: archivo faltante en manifiesto → esa foto salta, las demás OK ----
{
  const dir = await mkdtemp(join(tmpdir(), "pb-test-"));
  try {
    await mkdir(join(dir, "unsplash"), { recursive: true });
    const manifest = {
      license: "Unsplash License",
      source: "Unsplash",
      photos: [
        entry({ id: "bbb-001", file: "taller/present.jpg", sector: "taller", orientation: "landscape", alt: "Existe" }),
        entry({ id: "bbb-002", file: "taller/missing.jpg", sector: "taller", orientation: "landscape", alt: "No existe" }),
      ],
    };
    await writeFile(join(dir, "unsplash", "manifest.json"), JSON.stringify(manifest));
    await mkdir(join(dir, "unsplash", "taller"), { recursive: true });
    await writeFile(join(dir, "unsplash", "taller", "present.jpg"), makeJpeg(25000));
    // taller/missing.jpg intencionalmente no se escribe
    process.env["PHOTO_BANK_ROOT"] = dir;
    const mod = await import(next());
    mod._resetBankCache();

    const landscapes = await mod.listBankPhotos("landscape");
    assert.equal(landscapes.length, 2, "manifiesto carga los 2 registros");

    const present = landscapes.find((p) => p.file === "taller/present.jpg");
    const missing = landscapes.find((p) => p.file === "taller/missing.jpg");

    const rPresent = await mod.readBankPhoto(present);
    assert.ok(rPresent !== undefined, "archivo presente → resultado");

    let threw = false;
    let rMissing;
    try { rMissing = await mod.readBankPhoto(missing); } catch { threw = true; }
    assert.ok(!threw, "archivo faltante: no debe lanzar");
    assert.equal(rMissing, undefined, "archivo faltante → undefined");
    console.log("ℹ tests 5 pass: archivo faltante → undefined sin lanzar, otros siguen");
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env["PHOTO_BANK_ROOT"];
  }
}

// ---- T-020: banco real del repositorio, por sector y orientación ----
// Estas pruebas leen `deploy/photo-bank/unsplash/` de verdad: es lo que hace la
// ruta interna en producción. El CUÁNTAS sale del manifiesto real, no de una
// constante: cuando el banco crezca, la prueba sigue diciendo la verdad.
// El QUÉ (sector, orientación, ids únicos, archivos no vacíos) se afirma siempre.

// ---- Test 6: salud landscape = las que diga el manifiesto, todas de salud ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const esperadas = manifestCount("salud", "landscape");
  const salud = await mod.listBankPhotos("landscape", "salud");
  assert.ok(esperadas > 0, "el manifiesto tiene fotos de salud landscape");
  assert.equal(salud.length, esperadas, `salud landscape: las ${esperadas} del manifiesto (got ${salud.length})`);
  assert.ok(salud.every((p) => p.sector === "salud"), "todas de salud");
  assert.ok(salud.every((p) => p.orientation === "landscape"), "todas de la orientación pedida");
  assert.ok(salud.every((p) => p.file.startsWith("salud/")), "la ruta del archivo lleva el sector");
  assert.ok(salud.every((p) => p.license === "Unsplash License"), "licencia del manifiesto");
  assert.ok(salud.every((p) => typeof p.sourceUrl === "string" && p.sourceUrl.startsWith("https://unsplash.com/photos/")), "sourceUrl = página de la foto");
  assert.ok(salud.every((p) => typeof p.id === "string" && p.id !== ""), "id de cadena");
  assert.ok(salud.every((p) => typeof p.author === "string" && p.author !== ""), "photographer.name como author");
  assert.ok(salud.every((p) => typeof p.file === "string" && p.file !== ""), "ningún archivo vacío en el manifiesto");
  assert.equal(new Set(salud.map((p) => p.id)).size, salud.length, "ningún id repetido");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log(`ℹ tests 6 pass: salud landscape = ${esperadas} (conteo del manifiesto), sector y licencia`);
}

// ---- Test 7: salud square = las «squarish» del manifiesto ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const esperadas = manifestCount("salud", "square");
  const salud = await mod.listBankPhotos("square", "salud");
  assert.ok(esperadas > 0, "el manifiesto tiene fotos de salud squarish");
  assert.equal(salud.length, esperadas, `salud square: las ${esperadas} del manifiesto (got ${salud.length})`);
  assert.ok(salud.every((p) => p.sector === "salud"), "todas de salud");
  assert.ok(salud.every((p) => p.orientation === "square"), "squarish se normaliza a square");
  assert.ok(salud.every((p) => p.file.startsWith("salud/")), "la ruta del archivo lleva el sector");
  assert.ok(salud.every((p) => typeof p.file === "string" && p.file !== ""), "ningún archivo vacío en el manifiesto");
  assert.equal(new Set(salud.map((p) => p.id)).size, salud.length, "ningún id repetido");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log(`ℹ tests 7 pass: salud square = ${esperadas} (conteo del manifiesto)`);
}

// ---- Test 8: sector desconocido cae a neutro ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const esperadas = manifestCount("neutro", "landscape");
  // Un sector que no está en la lista cerrada se trata como neutro.
  const inventado = await mod.listBankPhotos("landscape", "panaderia-que-no-existe");
  assert.equal(inventado.length, esperadas, `sector inventado → neutro landscape: las ${esperadas} del manifiesto (got ${inventado.length})`);
  assert.ok(inventado.every((p) => p.sector === "neutro"), "cae en neutro");
  assert.ok(inventado.every((p) => p.orientation === "landscape"), "todas de la orientación pedida");

  // Y el mismo conjunto que pidiendo neutro de forma explícita.
  const neutro = await mod.listBankPhotos("landscape", "neutro");
  assert.deepEqual(inventado.map((p) => p.file), neutro.map((p) => p.file), "inventado y neutro dan lo mismo");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log(`ℹ tests 8 pass: sector desconocido cae a neutro (${esperadas} landscape)`);
}

// ---- Test 9: sin sector, todas las de esa orientación ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const esperadas = manifestCount(undefined, "landscape");
  const sectoresEsperados = manifestSectors("landscape");
  const todos = await mod.listBankPhotos("landscape");
  assert.ok(esperadas > 0, "el manifiesto tiene fotos landscape");
  assert.equal(todos.length, esperadas, `landscape sin sector: las ${esperadas} del manifiesto (got ${todos.length})`);
  assert.ok(todos.every((p) => p.orientation === "landscape"), "todas landscape");
  const sectores = new Set(todos.map((p) => p.sector));
  assert.equal(sectores.size, sectoresEsperados.size, `aparecen los ${sectoresEsperados.size} sectores del manifiesto (got ${sectores.size})`);
  for (const sector of sectoresEsperados) {
    assert.ok(sectores.has(sector), `el sector ${sector} del manifiesto aparece en el resultado`);
  }
  assert.ok(todos.every((p) => typeof p.file === "string" && p.file !== ""), "ningún archivo vacío en el manifiesto");
  assert.equal(new Set(todos.map((p) => p.id)).size, todos.length, "ningún id repetido");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log(`ℹ tests 9 pass: landscape sin sector = ${esperadas}, ${sectoresEsperados.size} sectores`);
}

// ---- T-031-fix 17: ningún sector baja de 4 horizontales y 4 cuadradas ----
// Si un sector se queda por debajo, la galería o el hero se quedan cortos. Esto
// tiene que romper en CI, no en producción.
{
  const SECTORES = ["despacho", "hosteleria", "comercio", "salud", "taller", "belleza", "neutro"];
  const MINIMO = 4;
  for (const sector of SECTORES) {
    const landscape = manifestCount(sector, "landscape");
    const square = manifestCount(sector, "square");
    assert.ok(landscape >= MINIMO, `sector ${sector}: al menos ${MINIMO} landscape (got ${landscape})`);
    assert.ok(square >= MINIMO, `sector ${sector}: al menos ${MINIMO} squarish/square (got ${square})`);
  }
  console.log(`ℹ tests 17 pass: los ${SECTORES.length} sectores tienen ≥${MINIMO} landscape y ≥${MINIMO} square`);
}

// ---- T-031-fix 18: cada entrada del manifiesto está completa y su archivo existe ----
{
  const CAMPOS = ["id", "file", "sector", "orientation", "width", "height", "alt"];
  const orientaciones = new Set(["landscape", "squarish", "square"]);
  for (const photo of realManifest.photos) {
    const quien = typeof photo.id === "string" && photo.id !== "" ? photo.id : "(sin id)";
    for (const campo of CAMPOS) {
      assert.ok(
        typeof photo[campo] === "string" ? photo[campo] !== "" : photo[campo] !== undefined && photo[campo] !== null,
        `${quien}: falta ${campo}`,
      );
    }
    assert.ok(orientaciones.has(photo.orientation), `${quien}: orientación de Unsplash (${photo.orientation})`);
    // El autor es obligatorio: sin atribución no se puede publicar la foto.
    assert.ok(
      typeof photo.photographer === "object" && photo.photographer !== null && typeof photo.photographer.name === "string" && photo.photographer.name !== "",
      `${quien}: falta el autor (photographer.name)`,
    );
    // El archivo existe en disco y no está vacío.
    const ruta = join(REAL_BANK, "unsplash", photo.file);
    const info = await stat(ruta).catch(() => undefined);
    assert.ok(info !== undefined, `${quien}: falta el archivo ${photo.file}`);
    assert.ok(info.isFile(), `${quien}: ${photo.file} no es un archivo`);
    assert.ok(info.size > 0, `${quien}: ${photo.file} está vacío (0 bytes)`);
  }
  console.log(`ℹ tests 18 pass: ${realManifest.photos.length} entradas completas y con archivo en disco`);
}

// ---- T-031-fix 19: ningún id se repite en todo el manifiesto ----
{
  const ids = realManifest.photos.map((p) => p.id);
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(repetidos, [], `ids repetidos en el manifiesto (${repetidos.length}): ${[...new Set(repetidos)].slice(0, 5).join(", ")}`);
  assert.equal(new Set(ids).size, ids.length, "el número de ids únicos es el de entradas");
  console.log(`ℹ tests 19 pass: ${ids.length} ids, ninguno repetido`);
}

// ---- Test 10: readBankPhoto de una foto real → JPEG > 25 KB ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const [photo] = await mod.listBankPhotos("landscape", "despacho");
  assert.ok(photo !== undefined, "hay foto de despacho");

  const r = await mod.readBankPhoto(photo);
  assert.ok(r !== undefined, "readBankPhoto devuelve contenido");
  assert.equal(r.mime, "image/jpeg", "mime=image/jpeg");
  assert.ok(r.content.byteLength > 25000, `content > 25 KB (got ${r.content.byteLength})`);
  // La firma JPEG es real, no un archivo vacío con nombre .jpg.
  assert.equal(r.content[0], 0xff, "primer byte FF");
  assert.equal(r.content[1], 0xd8, "segundo byte D8");

  // Path traversal: un file con ".." no se lee.
  const rTraversal = await mod.readBankPhoto({ ...photo, file: "../manifest.json" });
  assert.equal(rTraversal, undefined, "path traversal → undefined");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log("ℹ tests 10 pass: foto real del banco = JPEG > 25 KB, traversal rechazado");
}

// ---- T-032a: orden determinista por `seed` (siteId) ----
// Estas pruebas usan un manifiesto propio en /tmp: valen con cualquier número de
// fotos del banco real y no dependen de lo que otro agente añada a
// deploy/photo-bank/unsplash/.

// Manifiesto de prueba: 6 fotos de `salud` landscape, 4 de `neutro` landscape y
// una foto de `taller` en `square` (para que `taller` landscape caiga a neutro).
const SEED_PHOTOS = [
  ...["s1", "s2", "s3", "s4", "s5", "s6"].map((id) =>
    entry({ id, file: `salud/${id}.jpg`, sector: "salud", orientation: "landscape", alt: `Salud ${id}` })),
  ...["n1", "n2", "n3", "n4"].map((id) =>
    entry({ id, file: `neutro/${id}.jpg`, sector: "neutro", orientation: "landscape", alt: `Neutro ${id}` })),
  entry({ id: "t1", file: "taller/t1.jpg", sector: "taller", orientation: "squarish", alt: "Taller 1" }),
];

const seedMod = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), "pb-seed-"));
  await mkdir(join(dir, "unsplash"), { recursive: true });
  await writeFile(
    join(dir, "unsplash", "manifest.json"),
    JSON.stringify({ license: "Unsplash License", source: "Unsplash", photos: SEED_PHOTOS }),
  );
  process.env["PHOTO_BANK_ROOT"] = dir;
  const mod = await import(next());
  mod._resetBankCache();
  return { mod, dir };
})();
const { mod: seedBank, dir: seedDir } = seedMod;

const seqOf = (photos) => photos.map((p) => p.id).join(",");

// ---- Test 11: dos siteId distintos → mismo conjunto, secuencia distinta ----
{
  const a = await seedBank.listBankPhotos("landscape", "salud", "site-aaaa");
  const b = await seedBank.listBankPhotos("landscape", "salud", "site-bbbb");

  // Mismo conjunto: el reordenado no puede perder ni añadir fotos.
  assert.deepEqual([...a.map((p) => p.id)].sort(), [...b.map((p) => p.id)].sort(), "mismo conjunto de ids");
  assert.equal(a.length, 6, `6 fotos de salud (got ${a.length})`);

  // Secuencia distinta. Con 6 fotos hay 720 órdenes posibles: si dos semillas
  // cayeran en el mismo orden sería azar, así que se comprueban semillas
  // alternativas hasta dar con un par que difiera, y se afirma sobre ese par.
  let seedA = "site-aaaa";
  let seedB = "site-bbbb";
  let seqA = seqOf(a);
  let seqB = seqOf(b);
  if (seqA === seqB) {
    for (let i = 1; i <= 20 && seqA === seqB; i += 1) {
      seedB = `site-bbbb-${i}`;
      seqB = seqOf(await seedBank.listBankPhotos("landscape", "salud", seedB));
    }
  }
  assert.notEqual(seqA, seqB, `semillas ${seedA} y ${seedB} deben dar órdenes distintos`);

  // Y el orden no es el del manifiesto en al menos una de las dos.
  const sinSeed = seqOf(await seedBank.listBankPhotos("landscape", "salud"));
  assert.ok(seqA !== sinSeed || seqB !== sinSeed, "alguna semilla reordena respecto al manifiesto");

  console.log(`ℹ tests 11 pass: dos semillas → mismo conjunto, secuencia distinta`);
  console.log(`   seed "${seedA}" → ${seqA}`);
  console.log(`   seed "${seedB}" → ${seqB}`);
  console.log(`   sin seed      → ${sinSeed}`);
  seedBank._resetBankCache();
}

// ---- Test 12: mismo siteId dos veces → secuencia idéntica (y estable al recargar) ----
{
  const one = seqOf(await seedBank.listBankPhotos("landscape", "salud", "site-estable"));
  const two = seqOf(await seedBank.listBankPhotos("landscape", "salud", "site-estable"));
  assert.equal(one, two, "misma semilla, misma secuencia en la misma instancia");

  // Y también tras vaciar la caché en memoria: el orden sale del hash, no del
  // estado del proceso. Si cambiara al recargar, el editor se volvería loco.
  seedBank._resetBankCache();
  const three = seqOf(await seedBank.listBankPhotos("landscape", "salud", "site-estable"));
  assert.equal(one, three, "misma semilla, misma secuencia tras recargar el manifiesto");
  console.log(`ℹ tests 12 pass: misma semilla → secuencia idéntica (${one})`);
}

// ---- Test 13: sin seed → orden del manifiesto, sin reordenar ----
{
  const sinSeed = await seedBank.listBankPhotos("landscape", "salud");
  assert.equal(seqOf(sinSeed), "s1,s2,s3,s4,s5,s6", `sin seed: orden del manifiesto (got ${seqOf(sinSeed)})`);
  console.log("ℹ tests 13 pass: sin seed → orden del manifiesto");
}

// ---- Test 14: la caída a neutro también respeta el seed ----
{
  // `taller` no tiene landscape → cae a neutro (n1..n4).
  const sinSeed = await seedBank.listBankPhotos("landscape", "taller");
  assert.equal(seqOf(sinSeed), "n1,n2,n3,n4", `taller cae a neutro en orden de manifiesto (got ${seqOf(sinSeed)})`);

  const a = await seedBank.listBankPhotos("landscape", "taller", "site-aaaa");
  const b = await seedBank.listBankPhotos("landscape", "taller", "site-bbbb");
  assert.ok(a.every((p) => p.sector === "neutro"), "las fotos siguen siendo de neutro");
  assert.deepEqual([...a.map((p) => p.id)].sort(), ["n1", "n2", "n3", "n4"], "mismo conjunto de neutro");

  let seedB = "site-bbbb";
  let seqA = seqOf(a);
  let seqB = seqOf(b);
  for (let i = 1; i <= 20 && seqA === seqB; i += 1) {
    seedB = `site-bbbb-${i}`;
    seqB = seqOf(await seedBank.listBankPhotos("landscape", "taller", seedB));
  }
  assert.notEqual(seqA, seqB, "la caída a neutro también se reordena con el seed");
  console.log(`ℹ tests 14 pass: neutro respeta el seed — "${seqA}" ≠ "${seqB}"`);
}

// ---- Test 15: el seed no pierde ni duplica fotos (conjunto exacto) ----
{
  const sinSeed = await seedBank.listBankPhotos("landscape", "salud");
  for (const seed of ["site-aaaa", "site-bbbb", "site-cccc", "", "x"]) {
    const con = await seedBank.listBankPhotos("landscape", "salud", seed);
    assert.equal(con.length, sinSeed.length, `seed "${seed}": mismo número de fotos`);
    const ids = con.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `seed "${seed}": sin repeticiones`);
    assert.deepEqual([...ids].sort(), [...sinSeed.map((p) => p.id)].sort(), `seed "${seed}": mismos ids exactos`);
  }
  // Sin sector también se reordena, y conserva el conjunto.
  const todos = await seedBank.listBankPhotos("landscape", undefined, "site-aaaa");
  assert.equal(todos.length, 10, `sin sector + seed: las 10 landscape (got ${todos.length})`);
  console.log("ℹ tests 15 pass: el seed no pierde ni duplica fotos");
}

// ---- Test 16: el seed funciona con cualquier número de fotos (banco real) ----
{
  seedBank._resetBankCache();
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const sinSeed = await mod.listBankPhotos("landscape");
  const con = await mod.listBankPhotos("landscape", undefined, "site-real");
  assert.ok(sinSeed.length > 0, `el banco real tiene fotos landscape (got ${sinSeed.length})`);
  assert.equal(con.length, sinSeed.length, "el seed no cambia el número de fotos del banco real");
  assert.deepEqual(
    [...con.map((p) => p.id)].sort(),
    [...sinSeed.map((p) => p.id)].sort(),
    "el seed no cambia los ids del banco real",
  );
  mod._resetBankCache();
  console.log(`ℹ tests 16 pass: banco real (${sinSeed.length} landscape) reordenado sin perder fotos`);
}

await rm(seedDir, { recursive: true, force: true });
delete process.env["PHOTO_BANK_ROOT"];

// ---- Verificación de internal-photos.ts: banco vacío + sin Pexels → 200 {photos:[]} ----
// No existe prueba de handleInternalPhotos en este directorio de tests (confirmado leyendo
// el código: sin PEXELS_API_KEY e isPexelsConfigured()=false, el flujo pasa a listBankPhotos;
// con banco vacío listBankPhotos devuelve []; candidates=[] → json(res,200,{photos:[]}) y return true).
// No se inventa una prueba de integración que requeriría pool y sitesRoot.
console.log("ℹ nota: internal-photos sin Pexels + banco vacío → 200 {photos:[]} (verificado en código, líneas candidatos=[] → json 200)");

console.log("ℹ tests 1-19 all passed");
