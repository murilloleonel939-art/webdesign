import { Redis } from "ioredis";
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import type { LintDeps, LintJob } from "./lint-job.js";
import { processLintJob } from "./lint-job.js";
import type { DesignDeps, DesignJob } from "./design-job.js";
import { processDesignJob } from "./design-job.js";

// Cola del lint visual (spec 2, fila `workers`). El proceso `workers` consume;
// `platform` solo encola, y solo si hay Redis: sin Redis la publicacion
// funciona igual y el lint visual no corre.
//
// El job no bloquea nada (6.5). Su unico trabajo es dejar constancia de los
// hallazgos de un release ya publicado.

export const LINT_QUEUE = "lint-release";

/**
 * Un release concreto: la clave de idempotencia del job.
 *
 * Separador `-`, nunca `:`: BullMQ 5 rechaza el `jobId` con dos puntos
 * (`Custom Id cannot contain :`) y el encolado entero falla. Misma entrada,
 * mismo id: el separador es fijo y los tramos no llevan guiones sueltos.
 */
export function lintJobId(job: LintJob): string {
  return `lint-${job.siteId}-${job.version}`;
}

/** Corte por defecto del encolado: si Redis no contesta, se rinde y se sigue. */
export const ENQUEUE_TIMEOUT_MS = 2000;

/** Cola del agente de diseño (spec 9.1, punto C). Lleva trabajo lento aparte. */
export const AGENT_DESIGN_QUEUE = "agent-design";

/** Cuantos diseños pueden correr a la vez: llaman al modelo y no son gratis. */
export const AGENT_DESIGN_CONCURRENCY = 4;

/**
 * Una ejecucion concreta: la clave de idempotencia del job.
 *
 * Mismo motivo que en `lintJobId`: sin `:`, o BullMQ 5 rechaza el job.
 */
export function designJobId(job: { runId: string }): string {
  return `design-${job.runId}`;
}

/**
 * Encola en BullMQ con el patron defensivo comun a todas las colas.
 *
 * El cliente se crea aqui, fuera del `Queue`, para poder escuchar `error` ANTES
 * de que exista el socket. Con `new Queue(..., { connection: { url } })` ioredis
 * se construye y conecta en el acto, y un error de conexion emitido en esa
 * ventana no lo veia ningun oyente: el proceso moria y el proxy devolvia 502.
 * Con `lazyConnect` la conexion empieza en el `connect()` de abajo, cuando el
 * oyente ya esta registrado.
 *
 * La conexion falla rapido a proposito: sin cola offline, `maxRetriesPerRequest`
 * nulo (lo que BullMQ exige al recibir un cliente ya construido) y un
 * `connectTimeout` igual al corte; Redis caido o mudo no cuelga la peticion.
 */
async function enqueueOn<T>(
  connection: { url: string },
  opts: { queueName: string; jobName: string; jobId: string; timeoutLabel: string; timeoutMs: number },
  job: T,
): Promise<Job<T>> {
  let client: Redis | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const encolado = (async () => {
    const c = new Redis(connection.url, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: opts.timeoutMs,
      lazyConnect: true,
    });
    client = c;
    // Primero el oyente, despues la conexion. Un error de conexion sin oyente
    // seria una excepcion no capturada.
    c.on("error", () => {});
    await c.connect();
    const queue = new Queue<T>(opts.queueName, {
      connection: c as unknown as ConnectionOptions,
    });
    // El `Queue` reemite los errores de su backend: mismo motivo que arriba.
    queue.on("error", () => {});
    // BullMQ 6 infiere el nombre y el tipo del job desde el propio `Queue`; con
    // un `T` generico esa inferencia no se puede cerrar, asi que aqui se afirma
    // lo que ya garantiza el tipo del parametro `job`.
    const added = await queue.add(opts.jobName as never, job as never, {
      // La misma clave no entra dos veces: el job es idempotente por diseno.
      jobId: opts.jobId,
      attempts: 3,
      // Backoff exponencial: 1 s, 2 s, 4 s. Un fallo del modelo o de la base no
      // se arregla reintentando al instante.
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    return added as unknown as Job<T>;
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(opts.timeoutLabel)), opts.timeoutMs);
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

export function enqueueReleaseLint(
  connection: { url: string },
  job: LintJob,
  opts?: { timeoutMs?: number },
): Promise<Job<LintJob>> {
  return enqueueOn(
    connection,
    {
      queueName: LINT_QUEUE,
      jobName: "lint-release",
      jobId: lintJobId(job),
      timeoutLabel: "lint_enqueue_timeout",
      timeoutMs: opts?.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    },
    job,
  );
}

/**
 * Encola un diseño con IA.
 *
 * Mismo patron y mismo corte que el lint: si Redis no contesta, `platform`
 * responde 503 y cierra la ejecucion. El job lleva el brief, nunca el token: el
 * token lo carga el worker desde `agent_tokens` en el momento de usarlo.
 */
export function enqueueDesignRun(
  connection: { url: string },
  job: DesignJob,
  opts?: { timeoutMs?: number },
): Promise<Job<DesignJob>> {
  return enqueueOn(
    connection,
    {
      queueName: AGENT_DESIGN_QUEUE,
      jobName: "design-run",
      jobId: designJobId(job),
      timeoutLabel: "design_enqueue_timeout",
      timeoutMs: opts?.timeoutMs ?? ENQUEUE_TIMEOUT_MS,
    },
    job,
  );
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

/**
 * Arranca el consumidor de diseños.
 *
 * Concurrencia 4: cada job espera a un modelo, asi que el cuello no es la CPU.
 * Mas de cuatro a la vez multiplica el gasto sin mejorar la espera del dueno.
 */
export function startDesignWorker(connection: { url: string }, deps: DesignDeps): Worker<DesignJob> {
  const worker = new Worker<DesignJob>(
    AGENT_DESIGN_QUEUE,
    async (job) =>
      processDesignJob(deps, {
        runId: job.data.runId,
        siteId: job.data.siteId,
        userId: job.data.userId,
        brief: job.data.brief,
        // Petición explícita del dueño en el chat (T-027): el único dato del job
        // que cambia cómo se fusiona el diseño con lo que él ya había escrito.
        ...(job.data.changeRequest === true ? { changeRequest: true } : {}),
      }),
    { connection: { url: connection.url }, concurrency: AGENT_DESIGN_CONCURRENCY },
  );
  worker.on("failed", (job, err) => {
    // El job ya cierra su propia ejecucion; esto es solo la traza del worker.
    console.warn("design_job_failed", { jobId: job?.id, error: err.message });
  });
  return worker;
}
