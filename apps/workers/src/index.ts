// Superficie publica de `@webdesign/workers`.
//
// Solo lo que otro paquete necesita: la logica pura del job, la cola y su
// nombre. El arranque del proceso vive en `main.ts` y no se exporta.
export { processLintJob, type LintDeps, type LintJob } from "./lint-job.js";
export {
  enqueueReleaseLint,
  startLintWorker,
  LINT_QUEUE,
  lintJobId,
  ENQUEUE_TIMEOUT_MS,
} from "./queue.js";
export {
  enqueueDesignRun,
  startDesignWorker,
  designJobId,
  AGENT_DESIGN_QUEUE,
  AGENT_DESIGN_CONCURRENCY,
} from "./queue.js";
export {
  processDesignJob,
  fastBudget,
  PRE_RUN_CHECKPOINT_LABEL,
  type DesignClient,
  type DesignDeps,
  type DesignJob,
  type DesignJobResult,
  type DesignRunStatus,
  type DesignSaveResult,
} from "./design-job.js";
export { pgLintDeps, pgDesignDeps, type PgDesignOptions } from "./pg-store.js";
