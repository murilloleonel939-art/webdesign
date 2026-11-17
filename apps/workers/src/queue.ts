import { Queue, Worker, type Job } from "bullmq";
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
  // La cola se crea y se cierra por encargo: el productor es una peticion HTTP
  // del panel y no puede dejar conexiones abiertas al terminar. La conexion
  // falla rapido a proposito: sin cola offline, un reintento acotado y un
  // `connectTimeout` igual al corte, Redis caido o mudo no cuelga la peticion.
  const queue = new Queue<LintJob>(LINT_QUEUE, {
    connection: {
      url: connection.url,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: timeoutMs,
    },
  });
  // Un error de conexion sin oyente seria una excepcion no capturada.
  queue.on("error", () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("lint_enqueue_timeout")), timeoutMs);
  });
  return Promise.race([
    queue.add("lint-release", job, {
      // El mismo release no se analiza dos veces: si ya hay job, no entra otro.
      jobId: lintJobId(job),
      attempts: 3,
      // Backoff exponencial: 1 s, 2 s, 4 s. Un fallo de jsdom o de la base no
      // se arregla reintentando al instante.
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    }),
    timeout,
  ])
    // El temporizador se limpia en todos los caminos: si gana `add`, no queda
    // un `setTimeout` pendiente manteniendo vivo el proceso.
    .finally(() => {
      clearTimeout(timer);
      // Un `close` que no termina (socket mudo) no debe bloquear ni retener el
      // proceso: se lanza sin espera; `disconnect` corta el socket de raiz si
      // el cierre ordenado se queda a medias.
      void queue.close().catch(() => queue.disconnect().catch(() => {}));
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
