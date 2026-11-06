import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, sniffMime, assetRelativePath, LIMITS } from "../dist/index.js";

// Cabeceras minimas de cada tipo aceptado.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const MP4 = Uint8Array.from([0, 0, 0, 24, ..."ftypisom".split("").map((c) => c.charCodeAt(0))]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const SVG = Uint8Array.from('<svg><script>steal()</script></svg>'.split("").map((c) => c.charCodeAt(0)));

test("detecta el tipo real por bytes, no por cabecera", () => {
  assert.equal(sniffMime(JPEG), "image/jpeg");
  assert.equal(sniffMime(PNG), "image/png");
  assert.equal(sniffMime(MP4), "video/mp4");
  assert.equal(sniffMime(WEBM), "video/webm");
  assert.equal(sniffMime(SVG), undefined);
});

test("un archivo que no es lo que dice se rechaza", () => {
  // Declara JPEG pero los bytes son SVG: sniffMime no lo reconoce y no entra.
  assert.equal(checkUpload("image", sniffMime(SVG) ?? "application/octet-stream", 100), "mime_not_allowed");
  assert.equal(checkUpload("image", "image/jpeg", 100), undefined);
  assert.equal(checkUpload("video", "video/mp4", 1), undefined);
  assert.equal(checkUpload("video", "image/png", 1), "mime_not_allowed");
});

test("los limites de 14.1 son estrictos", () => {
  assert.equal(checkUpload("image", "image/png", LIMITS.imageBytes), undefined);
  assert.equal(checkUpload("image", "image/png", LIMITS.imageBytes + 1), "too_large");
  assert.equal(checkUpload("video", "video/mp4", LIMITS.videoBytes), undefined);
  assert.equal(checkUpload("video", "video/mp4", LIMITS.videoBytes + 1), "too_large");
  assert.equal(checkUpload("image", "image/png", 0), "empty");
});

test("la ruta de asset es generada y estable: id + hash de contenido", () => {
  const a = assetRelativePath("u1", "image", "png", new Uint8Array([1, 2, 3]));
  const b = assetRelativePath("u1", "image", "png", new Uint8Array([1, 2, 3]));
  const c = assetRelativePath("u1", "image", "png", new Uint8Array([9]));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^image\/u1-[0-9a-f]{12}\.png$/);
});
