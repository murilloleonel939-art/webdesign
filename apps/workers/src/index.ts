// Superficie publica de `@webdesign/workers`.
//
// Solo lo que otro paquete necesita: la logica pura del job, la cola y su
// nombre. El arranque del proceso vive en `main.ts` y no se exporta.
export { processLintJob, type LintDeps, type LintJob } from "./lint-job.js";
export { enqueueReleaseLint, startLintWorker, LINT_QUEUE, lintJobId, ENQUEUE_TIMEOUT_MS } from "./queue.js";
export { pgLintDeps } from "./pg-store.js";
