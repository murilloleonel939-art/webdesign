import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { enqueueReleaseLint, ENQUEUE_TIMEOUT_MS } from "../dist/index.js";

// El encolado del lint visual no puede colgar la publicacion: con Redis caido o
// mudo, `enqueueReleaseLint` se rinde por su propio corte y no deja conexiones
// abiertas. Se usa el puerto 1 (cerrado, nadie escucha) como Redis irresoluble.

const SITE = "33333333-3333-4333-8333-333333333333";
const CERRADO = "redis://127.0.0.1:1";

// El rechazo solo es valido si viene de Redis: o gana el corte propio
// (`lint_enqueue_timeout`) o el driver devuelve un error de conexion. Un fallo
// por falta del driver rechaza igual de rapido pero no prueba nada.
const MOTIVO_RED = /lint_enqueue_timeout|ECONNREFUSED|Connection is closed/;
const FALTA_DRIVER = /Cannot find module|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Error \[ERR_MODULE|ioredis/i;

test("enqueueReleaseLint rechaza rapido con Redis en un puerto cerrado", async () => {
  const inicio = Date.now();
  const err = await enqueueReleaseLint({ url: CERRADO }, { siteId: SITE, version: 1 }).then(
    () => assert.fail("encolar contra un puerto cerrado no puede resolverse"),
    (e) => e,
  );
  const ms = Date.now() - inicio;
  // Por debajo de 3000 ms, con corte por defecto de 2 s.
  assert.equal(ENQUEUE_TIMEOUT_MS, 2000);
  // Motivo real del rechazo: timeout propio o conexion rechazada por ioredis.
  assert.ok(
    MOTIVO_RED.test(err.message),
    `motivo inesperado, ni timeout ni conexion rechazada: ${err.message}`,
  );
  // Guarda del defecto corregido: si el driver no carga, el test debe FALLAR.
  assert.ok(
    !FALTA_DRIVER.test(err.message),
    `el rechazo es por falta del driver ioredis, no por Redis: ${err.message}`,
  );
  assert.ok(ms < 3000, `tardo ${ms} ms`);
});

test("ioredis resuelve desde apps/workers: la dependencia no puede faltar", async () => {
  // bullmq lo declara como peerDependency OPCIONAL: si desaparece del
  // package.json, el worker y el productor dejan de conectar a Redis en
  // produccion y el sintoma solo aparece en ejecucion. Esta prueba lo fija.
  const m = await import("ioredis");
  const Redis = m.default ?? m;
  assert.equal(typeof Redis, "function");
});

test("el proceso termina: ni el temporizador ni la conexion lo retienen", async () => {
  // Se comprueba en un hijo aparte: si algo quedara vivo (setTimeout del corte,
  // socket de ioredis), el hijo no terminaria y el test lo detectaria.
  const script = `
    import("${new URL("../dist/index.js", import.meta.url).href}")
      .then((m) => m.enqueueReleaseLint({ url: ${JSON.stringify(CERRADO)} }, { siteId: ${JSON.stringify(SITE)}, version: 2 }))
      .then(() => { console.log("encolado"); })
      .catch((e) => { console.log("rechazo:" + e.message); });
  `;
  const hijo = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  hijo.stdout.on("data", (b) => { salida += String(b); });
  hijo.stderr.on("data", (b) => { salida += String(b); });
  const codigo = await new Promise((resolve, reject) => {
    const corte = setTimeout(() => {
      hijo.kill("SIGKILL");
      reject(new Error(`el hijo no termino: ${salida}`));
    }, 10_000);
    corte.unref();
    hijo.on("exit", (code) => { clearTimeout(corte); resolve(code); });
    hijo.on("error", reject);
  });
  assert.equal(codigo, 0, salida);
  assert.match(salida, /rechazo:/, salida);
  // El hijo debe rechazar por Redis, no por un driver ausente.
  assert.match(salida, MOTIVO_RED, salida);
  assert.doesNotMatch(salida, FALTA_DRIVER, salida);
});

// Corre un hijo `node --input-type=module` que importa `@webdesign/workers` por
// su nombre de paquete (igual que `platform` al publicar) y devuelve codigo +
// salida. `cwd` es `apps/platform` porque es ahi donde el enlace del paquete
// existe de verdad: es el consumidor real del encolado.
function hijoQueEncola(script) {
  const hijo = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../../platform", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salida = "";
  hijo.stdout.on("data", (b) => { salida += String(b); });
  hijo.stderr.on("data", (b) => { salida += String(b); });
  return new Promise((resolve, reject) => {
    const corte = setTimeout(() => {
      hijo.kill("SIGKILL");
      reject(new Error(`el hijo no termino: ${salida}`));
    }, 15_000);
    corte.unref();
    hijo.on("exit", (code) => { clearTimeout(corte); resolve({ codigo: code, salida }); });
    hijo.on("error", reject);
  });
}

test("un encolado fallido NO tumba el proceso (502 en produccion)", async () => {
  // El defecto: el cliente de Redis se construia y conectaba antes de que
  // existiera un oyente de `error`, asi que un error de conexion se emitia sin
  // nadie escuchando y Node mataba el proceso en plena publicacion (502 del
  // proxy). Aqui se exige que el rechazo se capture y el hijo salga con 0.
  const { codigo, salida } = await hijoQueEncola(`
    const m = await import("@webdesign/workers");
    await m.enqueueReleaseLint({ url: ${JSON.stringify(CERRADO)} }, { siteId: ${JSON.stringify(SITE)}, version: 3 })
      .then(() => { console.log("encolado"); })
      .catch((e) => { console.log("rechazo:" + e.message); });
  `);
  assert.equal(codigo, 0, `el proceso murio con el encolado fallido: ${salida}`);
  assert.match(salida, /rechazo:/, salida);
  assert.match(salida, MOTIVO_RED, salida);
  // `[ioredis] Unhandled error event` es la firma del defecto: error emitido sin
  // oyente. Si aparece, el oyente no estaba registrado antes de conectar.
  assert.doesNotMatch(salida, /Unhandled error event/, salida);
  assert.doesNotMatch(salida, FALTA_DRIVER, salida);
});

test("un Redis que acepta y corta el socket tampoco mata el proceso", async () => {
  // Peor caso que el puerto cerrado: el servidor acepta la conexion y la cierra
  // al instante, asi que ioredis recibe el error *despues* de conectar y con el
  // socket ya en marcha. Es la forma exacta que tuvo el fallo en produccion.
  const net = await import("node:net");
  const srv = net.createServer((s) => { s.destroy(); });
  await new Promise((resolve) => { srv.listen(0, "127.0.0.1", resolve); });
  srv.unref();
  const { port } = srv.address();
  try {
    const { codigo, salida } = await hijoQueEncola(`
      const m = await import("@webdesign/workers");
      await m.enqueueReleaseLint({ url: "redis://127.0.0.1:${port}" }, { siteId: ${JSON.stringify(SITE)}, version: 4 })
        .then(() => { console.log("encolado"); })
        .catch((e) => { console.log("rechazo:" + e.message); });
    `);
    assert.equal(codigo, 0, `el proceso murio con el socket cortado: ${salida}`);
    assert.match(salida, /rechazo:|encolado/, salida);
    assert.doesNotMatch(salida, /Unhandled error event/, salida);
  } finally {
    srv.close();
  }
});
