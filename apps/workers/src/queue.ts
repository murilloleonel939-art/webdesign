import { Redis } from "ioredis";
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import type { LintDeps, LintJob } from "./lint-job.js";
import { processLintJob } from "./lint-job.js";

// Cola del lint visual (spec 2, fila `workers`). El proceso `workers` consume;
// `platform` solo encola, y solo si hay Redis: sin Redis la publicacion
// funciona igual y el lint visual no corre.
//
// El job no bloquea nada (6.5). Su unico trabajo es dejar constancia de los
// hallazgos de un release ya publicado.

export const LINT_QUEUE = "lint-release";

/** Un release concreto: la clave de idempotencia del job. */
export function lintJobId(job: LintJob): string {
  return `lint:${job.siteId}:${job.version}`;
}

/** Corte por defecto del encolado: si Redis no contesta, se rinde y se sigue. */
export const ENQUEUE_TIMEOUT_MS = 2000;

export function enqueueReleaseLint(
  connection: { url: string },
  job: LintJob,
  opts?: { timeoutMs?: number },
): Promise<Job<LintJob>> {
  const timeoutMs = opts?.timeoutMs ?? ENQUEUE_TIMEOUT_MS;
  // El cliente se crea aqui, fuera del `Queue`, para poder escuchar `error`
  // ANTES de que exista el socket. Con `new Queue(..., { connection: { url } })`
  // ioredis se construye y conecta en el acto, y un error de conexion emitido en
  // esa ventana no lo veia ningun oyente: el proceso moria al pulsar publicar y
  // el proxy devolvia 502. Con `lazyConnect` la conexion empieza en el
  // `connect()` de abajo, cuando el oyente ya esta registrado.
  //
  // La conexion falla rapido a proposito: sin cola offline, `maxRetriesPerRequest`
  // nulo (lo que BullMQ exige al recibir un cliente ya construido) y un
  // `connectTimeout` igual al corte; Redis caido o mudo no cuelga la peticion.
  // Una sola conexion para el `Queue`: al cortarla en el `.finally` no queda
  // ningun socket que mantenga vivo el proceso.
  let client: Redis | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const encolado = (async () => {
    const c = new Redis(connection.url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: timeoutMs,
      lazyConnect: true,
    });
    client = c;
    // Primero el oyente, despues la conexion. Un error de conexion sin oyente
    // seria una excepcion no capturada.
    c.on("error", () => {});
    await c.connect();
    const queue = new Queue<LintJob>(LINT_QUEUE, {
      connection: c as unknown as ConnectionOptions,
    });
    // El `Queue` reemite los errores de su backend: mismo motivo que arriba.
    queue.on("error", () => {});
    return queue.add("lint-release", job, {
      // El mismo release no se analiza dos veces: si ya hay job, no entra otro.
      jobId: lintJobId(job),
      attempts: 3,
      // Backoff exponencial: 1 s, 2 s, 4 s. Un fallo de jsdom o de la base no
      // se arregla reintentando al instante.
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("lint_enqueue_timeout")), timeoutMs);
  });
  return Promise.race([encolado, timeout])
    // El temporizador se limpia en todos los caminos: si gana `add`, no queda
    // un `setTimeout` pendiente manteniendo vivo el proceso.
    .finally(() => {
      clearTimeout(timer);
      // `disconnect` corta el socket de raiz y no espera: un Redis mudo no debe
      // bloquear ni retener el proceso. Como el `Queue` usa este mismo cliente,
      // cerrarlo cierra tambien la conexion de la cola.
      client?.disconnect();
    });
}

/** Arranca el consumidor. Devuelve el `Worker` para poder cerrarlo al parar. */
export function startLintWorker(connection: { url: string }, deps: LintDeps): Worker<LintJob> {
  const worker = new Worker<LintJob>(
    LINT_QUEUE,
    async (job) => processLintJob({ siteId: job.data.siteId, version: job.data.version }, deps),
    { connection: { url: connection.url } },
  );
  worker.on("failed", (job, err) => {
    // El release ya esta publicado: un fallo del lint visual se registra y se
    // deja. Nunca se propaga a la publicacion.
    console.warn("lint_job_failed", { jobId: job?.id, error: err.message });
  });
  return worker;
}
