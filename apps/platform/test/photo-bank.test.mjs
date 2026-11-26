// Tests for photo-bank.ts (compiled to dist/photo-bank.js)
// No depende de fotos en el repositorio: todo en /tmp.
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    const manifest = {
      license: "Unsplash License",
      source: "https://picsum.photos",
      photos: [
        { id: 900001, file: "hero-01.jpg", orientation: "landscape", width: 1600, height: 900, alt: "Foto A", author: "Test" },
        { id: 900002, file: "hero-02.jpg", orientation: "landscape", width: 1600, height: 900, alt: "Foto B", author: "Test" },
      ],
    };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "hero-01.jpg"), makeJpeg(25000));
    await writeFile(join(dir, "hero-02.jpg"), makeJpeg(25000));
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
    const manifest = {
      license: "Unsplash License",
      source: "https://picsum.photos",
      photos: [
        { id: 900001, file: "present.jpg",  orientation: "landscape", width: 1600, height: 900, alt: "Existe", author: "Test" },
        { id: 900002, file: "missing.jpg",  orientation: "landscape", width: 1600, height: 900, alt: "No existe", author: "Test" },
      ],
    };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "present.jpg"), makeJpeg(25000));
    // missing.jpg intencionalmente no se escribe
    process.env["PHOTO_BANK_ROOT"] = dir;
    const mod = await import(next());
    mod._resetBankCache();

    const landscapes = await mod.listBankPhotos("landscape");
    assert.equal(landscapes.length, 2, "manifiesto carga los 2 registros");

    const present = landscapes.find((p) => p.file === "present.jpg");
    const missing = landscapes.find((p) => p.file === "missing.jpg");

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

// ---- Verificación de internal-photos.ts: banco vacío + sin Pexels → 200 {photos:[]} ----
// No existe prueba de handleInternalPhotos en este directorio de tests (confirmado leyendo
// el código: sin PEXELS_API_KEY e isPexelsConfigured()=false, el flujo pasa a listBankPhotos;
// con banco vacío listBankPhotos devuelve []; candidates=[] → json(res,200,{photos:[]}) y return true).
// No se inventa una prueba de integración que requeriría pool y sitesRoot.
console.log("ℹ nota: internal-photos sin Pexels + banco vacío → 200 {photos:[]} (verificado en código, líneas candidatos=[] → json 200)");

console.log("ℹ tests 1-5 all passed");
