import pg from "pg";
import { pgDesignDeps, pgLintDeps } from "./pg-store.js";
import { AGENT_DESIGN_QUEUE, LINT_QUEUE, startDesignWorker, startLintWorker } from "./queue.js";

// Punto de entrada del proceso `workers` (spec 2). Arranca el consumidor del
// lint visual y, si hay gateway, el del agente de diseño. Sin configuracion no
// arranca a medias: sale con codigo 1 y dice que falta, para que el orquestador
// lo muestre tal cual.

const REDIS_URL = process.env.REDIS_URL;
const DATABASE_URL = process.env.DATABASE_URL;
// Opcional a proposito: sin gateway el lint visual sigue corriendo. Lo que no
// hace es arrancar el agente de diseño, que necesita el modelo para trabajar.
const LLM_GATEWAY_URL = process.env["LLM_GATEWAY_URL"];
const PLATFORM_INTERNAL_URL = process.env["PLATFORM_INTERNAL_URL"] ?? "http://127.0.0.1:3000";

if (!REDIS_URL || !DATABASE_URL) {
  const missing = [!REDIS_URL && "REDIS_URL", !DATABASE_URL && "DATABASE_URL"].filter(Boolean).join(", ");
  console.error(`workers: falta ${missing}. Define REDIS_URL (cola) y DATABASE_URL (Postgres).`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const worker = startLintWorker({ url: REDIS_URL }, pgLintDeps(pool));

console.log(`workers: escuchando la cola ${LINT_QUEUE}`);

// El de diseño es opcional: si falta `LLM_GATEWAY_URL`, no se arranca y se dice
// por que. Un worker que no puede llamar al modelo solo acumularia fallos.
const designWorker = LLM_GATEWAY_URL
  ? startDesignWorker({ url: REDIS_URL }, pgDesignDeps(pool, { gatewayUrl: LLM_GATEWAY_URL, apiBaseUrl: PLATFORM_INTERNAL_URL }))
  : undefined;

if (designWorker) {
  console.log(`workers: escuchando la cola ${AGENT_DESIGN_QUEUE}`);
} else {
  console.warn("workers: sin LLM_GATEWAY_URL no se arranca el agente de diseno; el lint visual sigue activo");
}

// Cierre ordenado: dejar de aceptar jobs antes de cerrar el pool evita que un
// job en curso se quede sin base a mitad.
let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`workers: ${signal}, cerrando`);
  await worker.close();
  if (designWorker) await designWorker.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
