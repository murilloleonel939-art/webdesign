// Tests for photo-bank.ts (compiled to dist/photo-bank.js)
// No depende de fotos en el repositorio: todo en /tmp.
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
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
// ruta interna en producción. Conteos del manifiesto actual: cada sector tiene 2
// landscape y 3 squarish (`square`); neutro incluido.

// ---- Test 6: salud landscape = 2, todas de salud ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const salud = await mod.listBankPhotos("landscape", "salud");
  assert.equal(salud.length, 2, `salud landscape: 2 (got ${salud.length})`);
  assert.ok(salud.every((p) => p.sector === "salud"), "todas de salud");
  assert.ok(salud.every((p) => p.file.startsWith("salud/")), "la ruta del archivo lleva el sector");
  assert.ok(salud.every((p) => p.license === "Unsplash License"), "licencia del manifiesto");
  assert.ok(salud.every((p) => typeof p.sourceUrl === "string" && p.sourceUrl.startsWith("https://unsplash.com/photos/")), "sourceUrl = página de la foto");
  assert.ok(salud.every((p) => typeof p.id === "string" && p.id !== ""), "id de cadena");
  assert.ok(salud.every((p) => typeof p.author === "string" && p.author !== ""), "photographer.name como author");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log("ℹ tests 6 pass: salud landscape = 2, sector y licencia del manifiesto");
}

// ---- Test 7: salud square = 3 (el manifiesto dice «squarish») ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const salud = await mod.listBankPhotos("square", "salud");
  assert.equal(salud.length, 3, `salud square: 3 (got ${salud.length})`);
  assert.ok(salud.every((p) => p.sector === "salud"), "todas de salud");
  assert.ok(salud.every((p) => p.orientation === "square"), "squarish se normaliza a square");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log("ℹ tests 7 pass: salud square = 3");
}

// ---- Test 8: sector desconocido cae a neutro ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  // Un sector que no está en la lista cerrada se trata como neutro.
  const inventado = await mod.listBankPhotos("landscape", "panaderia-que-no-existe");
  assert.equal(inventado.length, 2, `sector inventado → neutro landscape: 2 (got ${inventado.length})`);
  assert.ok(inventado.every((p) => p.sector === "neutro"), "cae en neutro");

  // Y el mismo conjunto que pidiendo neutro de forma explícita.
  const neutro = await mod.listBankPhotos("landscape", "neutro");
  assert.deepEqual(inventado.map((p) => p.file), neutro.map((p) => p.file), "inventado y neutro dan lo mismo");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log("ℹ tests 8 pass: sector desconocido cae a neutro");
}

// ---- Test 9: sin sector, todas las de esa orientación ----
{
  process.env["PHOTO_BANK_ROOT"] = REAL_BANK;
  const mod = await import(next());
  mod._resetBankCache();

  const todos = await mod.listBankPhotos("landscape");
  // 2 landscape por sector × 7 sectores, más el tercero de hosteleria = 15.
  assert.equal(todos.length, 15, `landscape sin sector: 15 (got ${todos.length})`);
  assert.ok(todos.every((p) => p.orientation === "landscape"), "todas landscape");
  const sectores = new Set(todos.map((p) => p.sector));
  assert.equal(sectores.size, 7, "aparecen los 7 sectores");

  delete process.env["PHOTO_BANK_ROOT"];
  mod._resetBankCache();
  console.log("ℹ tests 9 pass: landscape sin sector = 15, 7 sectores");
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

// ---- Verificación de internal-photos.ts: banco vacío + sin Pexels → 200 {photos:[]} ----
// No existe prueba de handleInternalPhotos en este directorio de tests (confirmado leyendo
// el código: sin PEXELS_API_KEY e isPexelsConfigured()=false, el flujo pasa a listBankPhotos;
// con banco vacío listBankPhotos devuelve []; candidates=[] → json(res,200,{photos:[]}) y return true).
// No se inventa una prueba de integración que requeriría pool y sitesRoot.
console.log("ℹ nota: internal-photos sin Pexels + banco vacío → 200 {photos:[]} (verificado en código, líneas candidatos=[] → json 200)");

console.log("ℹ tests 1-10 all passed");
