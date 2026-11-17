import pg from "pg";
import { pgLintDeps } from "./pg-store.js";
import { LINT_QUEUE, startLintWorker } from "./queue.js";

// Punto de entrada del proceso `workers` (spec 2). Arranca el consumidor del
// lint visual y se queda vivo. Sin configuracion no arranca a medias: sale con
// codigo 1 y dice que falta, para que el orquestador lo muestre tal cual.

const REDIS_URL = process.env.REDIS_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!REDIS_URL || !DATABASE_URL) {
  const missing = [!REDIS_URL && "REDIS_URL", !DATABASE_URL && "DATABASE_URL"].filter(Boolean).join(", ");
  console.error(`workers: falta ${missing}. Define REDIS_URL (cola) y DATABASE_URL (Postgres).`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const worker = startLintWorker({ url: REDIS_URL }, pgLintDeps(pool));

console.log(`workers: escuchando la cola ${LINT_QUEUE}`);

// Cierre ordenado: dejar de aceptar jobs antes de cerrar el pool evita que un
// job en curso se quede sin base a mitad.
let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`workers: ${signal}, cerrando`);
  await worker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
