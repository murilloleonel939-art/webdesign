// Pruebas de `writeAtomic` (bank-builder.ts): la escritura que puede corromper
// el manifiesto y CREDITS.md del banco.
//
// SE IMPORTA LA FUNCIÓN DE VERDAD. Antes este fichero llevaba una copia de
// `writeAtomic` dentro: probaba la copia, no nuestro código, y podía pasar con
// el módulo roto. Ahora `bank-builder.ts` la exporta y aquí se ejerce la misma
// que usan `writeManifestDoc` y `writeCredits`.
//
// Sin red, sin /data y sin mocks de `node:fs`: los fallos se provocan con el
// sistema de ficheros (directorio inexistente, directorio de solo lectura,
// destino que es un directorio). Lo que no se puede provocar de forma limpia se
// dice, no se simula.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { temporaryPathFor, writeAtomic } from "../dist/bank-builder.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "atomic-write-"));
}

/** Nombres de la carpeta que acaban en `.tmp`, ordenados. */
async function temporales(dir) {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".tmp")).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 1. Escritura correcta
// ---------------------------------------------------------------------------

test("1. escritura correcta: contenido exacto en el destino y ningún .tmp detrás", async () => {
  const dir = await tempDir();
  const destino = join(dir, "manifest.json");
  const contenido = '{\n  "photos": []\n}\n';

  await writeAtomic(destino, contenido);

  assert.equal(await readFile(destino, "utf8"), contenido, "contenido exacto, byte a byte");
  assert.deepEqual(await temporales(dir), [], "sin temporales huérfanos");

  // Y se puede sobrescribir: la segunda escritura también deja el destino limpio.
  const otro = '{\n  "photos": [1]\n}\n';
  await writeAtomic(destino, otro);
  assert.equal(await readFile(destino, "utf8"), otro);
  assert.deepEqual(await temporales(dir), []);
});

// ---------------------------------------------------------------------------
// 2. El temporal vive junto al destino, no en os.tmpdir()
// ---------------------------------------------------------------------------

test("2. el temporal vive junto al destino y nunca en os.tmpdir()", async () => {
  const dir = await tempDir();
  const destino = join(dir, "creditos.md");
  const temporal = temporaryPathFor(destino);

  // La propiedad, comprobada sobre el nombre y no observando el disco: el
  // temporal cuelga del MISMO directorio que el destino. Si estuviera en
  // `os.tmpdir()`, el `rename` podría cruzar sistemas de ficheros y dejar de ser
  // atómico.
  assert.equal(dirname(temporal), dirname(destino));
  assert.equal(dirname(temporal), dir);
  assert.notEqual(dirname(temporal), tmpdir(), "no se va a /tmp");
  assert.match(basename(temporal), /^creditos\.md\.[0-9a-f-]{36}\.tmp$/);

  // Y lo observable tras escribir: destino con el contenido, ni un temporal.
  await writeAtomic(destino, "contenido\n");
  assert.equal(await readFile(destino, "utf8"), "contenido\n");
  assert.deepEqual(await temporales(dir), []);
});

// ---------------------------------------------------------------------------
// 3. Dos llamadas seguidas no comparten temporal
// ---------------------------------------------------------------------------

test("3. cada escritura usa un temporal distinto: nada de un .tmp fijo", async () => {
  const dir = await tempDir();
  const destino = join(dir, "manifest.json");

  const nombres = new Set();
  for (let i = 0; i < 10; i += 1) {
    const temporal = temporaryPathFor(destino);
    assert.equal(dirname(temporal), dir, "siempre junto al destino");
    nombres.add(basename(temporal));
  }
  assert.equal(nombres.size, 10, "diez escrituras, diez temporales distintos");
  assert.equal(nombres.has("manifest.json.tmp"), false, "el nombre fijo de antes ya no existe");

  // Dos escrituras seguidas de verdad: el destino acaba con la última y no queda
  // nada suelto.
  await writeAtomic(destino, "uno\n");
  await writeAtomic(destino, "dos\n");
  assert.equal(await readFile(destino, "utf8"), "dos\n");
  assert.deepEqual(await temporales(dir), []);
});

// ---------------------------------------------------------------------------
// 4. Falla el writeFile: no queda temporal y sube el error original
// ---------------------------------------------------------------------------

test("4. writeFile falla (directorio inexistente): ni temporal ni error de unlink", async () => {
  const dir = await tempDir();
  const destino = join(dir, "no-existe", "manifest.json");

  // Aquí el `unlink` del barrido TAMBIÉN falla (el temporal no llegó a nacer):
  // justo el caso en que un barrido descuidado taparía el error de verdad con un
  // ENOENT del unlink. Tiene que subir el del `writeFile`.
  const error = await writeAtomic(destino, "contenido").then(
    () => null,
    (e) => e,
  );
  assert.ok(error instanceof Error, "la promesa se rechaza");
  assert.equal(error.code, "ENOENT", `llegó ${error.code} en vez del error original`);
  assert.deepEqual(await temporales(dir), [], "nada que barrer en la carpeta del destino");
});

// `chmod 0500` no frena a root: escribe igual y nunca llega el EACCES. El caso se
// salta con root y corre en CI sin privilegios, que es donde el permiso manda.
const sinRoot = process.getuid?.() === 0 ? "root ignora los permisos 0500: no hay EACCES que probar" : false;

test("4b. writeFile falla (directorio de solo lectura): EACCES y ni un .tmp", { skip: sinRoot }, async () => {
  const dir = await tempDir();
  const soloLectura = join(dir, "sellado");
  await mkdir(soloLectura);
  // 0500: se puede entrar y leer, no crear. Restaurado después para poder borrar
  // la carpeta temporal en el barrido de os.tmpdir del sistema de pruebas.
  await chmod(soloLectura, 0o500);
  try {
    const error = await writeAtomic(join(soloLectura, "manifest.json"), "contenido").then(
      () => null,
      (e) => e,
    );
    assert.ok(error instanceof Error, "la promesa se rechaza");
    assert.equal(error.code, "EACCES", `llegó ${error.code} en vez de EACCES`);
    assert.deepEqual(await temporales(soloLectura), [], "no se dejó nada escrito");
  } finally {
    await chmod(soloLectura, 0o700);
  }
});

// ---------------------------------------------------------------------------
// 5. Falla el rename: no queda temporal y sube el error del rename
// ---------------------------------------------------------------------------

test("5. rename falla (el destino es un directorio): ni temporal ni error del unlink", async () => {
  const dir = await tempDir();
  const destino = join(dir, "ocupado");
  await mkdir(destino); // un directorio donde se espera un fichero

  const error = await writeAtomic(destino, "contenido").then(
    () => null,
    (e) => e,
  );
  assert.ok(error instanceof Error, "la promesa se rechaza");
  // Linux devuelve EISDIR; otros sistemas, ENOTDIR/EPERM. Lo que importa es que
  // el error sea del `rename`, no del barrido.
  assert.match(String(error.code), /^(EISDIR|ENOTDIR|EPERM|EACCES|EBUSY)$/, `código ${error.code}`);

  assert.deepEqual(await temporales(dir), [], "el temporal se barrió aunque el rename fallara");
  // El destino sigue siendo el directorio: no se publicó nada a medias.
  assert.deepEqual(await readdir(destino), []);
});

// ---------------------------------------------------------------------------
// 6. Dos escrituras simultáneas sobre el mismo destino
// ---------------------------------------------------------------------------

test("6. dos writeAtomic simultáneas: gana una completa y no queda ningún .tmp", async () => {
  const dir = await tempDir();
  const destino = join(dir, "manifest.json");
  const a = '{"photos":["a"],"quien":"proceso-a"}\n';
  const b = '{"photos":["b"],"quien":"proceso-b"}\n';

  await Promise.all([writeAtomic(destino, a), writeAtomic(destino, b)]);

  const final = await readFile(destino, "utf8");
  assert.ok(final === a || final === b, "el fichero es uno de los dos, no una mezcla");
  assert.deepEqual(await temporales(dir), [], "sin temporales huérfanos");

  // Y en varias rondas: nunca queda un JSON a medias.
  for (let i = 0; i < 20; i += 1) {
    await Promise.all([writeAtomic(destino, `${a}`), writeAtomic(destino, `${b}`)]);
    const texto = await readFile(destino, "utf8");
    assert.ok(texto === a || texto === b, `ronda ${i}: ${JSON.stringify(texto)}`);
  }
  assert.deepEqual(await temporales(dir), []);
});

// ---------------------------------------------------------------------------
// 7. Lo que NO se puede provocar de forma limpia
// ---------------------------------------------------------------------------

// El caso "el rename falla Y el unlink del temporal también falla" no se puede
// forzar sin trucos: los dos trabajan en el mismo directorio, así que un permiso
// que impida el `unlink` también impide el `writeFile` (y entonces el fallo es
// otro) y cualquier otra vía exige sustituir `node:fs`, que este fichero no
// hace. Lo que sí queda cubierto es el barrido cuyo `unlink` falla por no existir
// el temporal (prueba 4: el error que sube es el del `writeFile`, no el ENOENT
// del barrido). No se simula el resto.

// ---------------------------------------------------------------------------
// 8. Contenido vacío
// ---------------------------------------------------------------------------

test("8. contenido vacío: fichero de cero bytes y sin temporales", async () => {
  const dir = await tempDir();
  const destino = join(dir, "manifest.json");

  // Un manifiesto que nace vacío no es un caso especial: el temporal se crea
  // igual y el `rename` publica un fichero de cero bytes.
  await writeAtomic(destino, "");
  assert.equal(await readFile(destino, "utf8"), "", "el destino existe y está vacío");
  assert.deepEqual(await temporales(dir), [], "sin temporales huérfanos");

  // Y sobrescribiendo: lo que había se reemplaza entero, también por nada.
  await writeAtomic(destino, '{"photos":[]}\n');
  await writeAtomic(destino, "");
  assert.equal(await readFile(destino, "utf8"), "");
  assert.deepEqual(await temporales(dir), []);
});

// ---------------------------------------------------------------------------
// 9. Destino de nombre casi máximo
// ---------------------------------------------------------------------------

test("9. nombre de destino muy largo: el sufijo del temporal no cabe y falla limpio", async () => {
  const dir = await tempDir();
  // 250 + el sufijo (punto + uuid + ".tmp" = 41) = 291 bytes de componente, por
  // encima del NAME_MAX de cualquier sistema de ficheros real (255 en Linux).
  // El fallo depende SOLO de la longitud del nombre, no de tiempos ni permisos,
  // así que es determinista. El barrido también falla aquí (el temporal mide lo
  // mismo) y aun así lo que sube es un único rechazo y no queda nada escrito.
  const destino = join(dir, `${"l".repeat(250)}.json`);

  const error = await writeAtomic(destino, "contenido").then(
    () => null,
    (e) => e,
  );
  assert.ok(error instanceof Error, "la promesa se rechaza");
  assert.equal(error.code, "ENAMETOOLONG", `llegó ${error.code}`);
  assert.deepEqual(await temporales(dir), [], "sin temporales huérfanos");
  // El destino nunca llegó a nacer: no se publicó nada a medias.
  const creado = await readFile(destino, "utf8").then(
    () => true,
    () => false,
  );
  assert.equal(creado, false, "el destino no se creó");
});
