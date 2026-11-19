import { budgetSchema, type BudgetTracker, type LlmClient } from "@webdesign/llm";
import { FAST_BUDGET, runFastDesign, type FastDesignResult, type Preset } from "@webdesign/agent-design";

// Job del agente de diseño (spec 9.1, Fase 4; punto C).
//
// Logica pura: no habla con Redis ni con Postgres. Todo lo que toca el mundo
// exterior entra por `deps`, y eso es lo que permite probarlo sin levantar nada.
//
// Lo que este job NO hace: publicar. El unico efecto sobre el sitio es
// `saveDraft`, y solo si el diseño es valido y el borrador no ha cambiado por
// debajo. El token del agente se revoca SIEMPRE, salga como salga el job.

/** Datos del job. El token NO viaja aqui: lo carga `makeClient` en el worker. */
export interface DesignJob {
  runId: string;
  siteId: string;
  userId: string;
  brief: unknown;
}

/** Estado final que se escribe en `agent_runs.status` (0014 lo acota). */
export type DesignRunStatus = "ok" | "error" | "budget_exhausted";

export interface DesignJobResult {
  status: DesignRunStatus;
  /** Texto legible para el dueno. Nunca un codigo interno. */
  stopReason: string;
  /** Copia de trabajo ya guardada, si se llego a guardar. */
  rev?: number;
}

export type DesignSaveResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "conflict"; currentRev?: number }
  | { ok: false; reason: "invalid"; errors?: string[] };

/** Cliente ya autenticado para esta ejecucion. */
export interface DesignClient {
  client: LlmClient;
  tracker: BudgetTracker;
  /** Token corto del run: el transporte lo envia al gateway en cada llamada. */
  token: string;
  /** Base de la API interna que viaja en el `RunContext`. */
  apiBaseUrl: string;
}

export interface DesignDeps {
  /** Borrador actual del sitio, o `undefined` si no hay ninguno. */
  loadDraft(userId: string, siteId: string): Promise<{ rev: number; doc: unknown } | undefined>;
  /** Presets del catalogo: el diseño sale de datos, no de la imaginacion. */
  loadPresets(): Promise<Preset[]>;
  /**
   * Guarda el checkpoint PREVIO en `draft_checkpoints` (spec 9.1).
   *
   * Se escribe antes de que el agente toque nada, con el borrador tal como
   * estaba: es lo que hace posible "deshacer todo" desde el panel. Sin el, el
   * agente podria cambiar el borrador sin vuelta atras. Si no se puede guardar,
   * el job no continua: se cerraria como `ok` un cambio sin retorno.
   */
  saveCheckpoint(input: {
    userId: string;
    siteId: string;
    runId: string;
    /** Revision del borrador que se esta fotografiando. */
    rev: number;
    doc: unknown;
    label: string;
  }): Promise<void>;
  /** Guarda con `expectedRev`: el job nunca pisa un cambio del dueno. */
  saveDraft(input: {
    userId: string;
    siteId: string;
    doc: unknown;
    expectedRev: number;
  }): Promise<DesignSaveResult>;
  /** Cierra la ejecucion con su estado y el motivo. */
  finishRun(runId: string, userId: string, status: DesignRunStatus, stopReason: string): Promise<void>;
  /** Revoca el token temporal. Se llama siempre, tambien al fallar. */
  revokeToken(runId: string, userId: string): Promise<void>;
  /** Arma el cliente del gateway y su presupuesto. `undefined` si no se puede. */
  makeClient(job: DesignJob): Promise<DesignClient | undefined>;
}

/** Etiqueta del checkpoint previo: el dueno la ve en el historial del editor. */
export const PRE_RUN_CHECKPOINT_LABEL = "Antes del diseno con IA";

/**
 * Presupuesto del modo rapido con todos los limites que exige 8.2.
 *
 * `FAST_BUDGET` no trae `maxContextTokens`; el schema lo completa con su valor
 * por defecto. Se aplana con el schema, no a mano, para que el limite no se
 * quede fuera si el catalogo cambia.
 */
export function fastBudget(): ReturnType<typeof budgetSchema.parse> {
  return budgetSchema.parse({ ...FAST_BUDGET });
}

/** Motivo legible de una parada por presupuesto, sin codigos internos. */
function budgetReason(limit: string, saved: DesignSaveResult): string {
  // Lo que de verdad le importa al dueno: si su borrador cambio o no. El motivo
  // del presupuesto se dice igual, pero nunca se da por guardado lo que no lo
  // esta.
  if (!saved.ok) {
    return saved.reason === "conflict"
      ? "Se agoto el presupuesto y ademas cambio el borrador mientras se generaba: no se ha sobrescrito nada"
      : "Se agoto el presupuesto y el diseno no se pudo guardar: contenido no valido";
  }
  switch (limit) {
    case "tokens":
      return "Se agoto el presupuesto de tokens de esta ejecucion";
    case "cost":
      return "Se agoto el presupuesto de coste de esta ejecucion";
    case "time":
      return "La ejecucion supero el tiempo maximo";
    case "tool_calls":
      return "La ejecucion hizo demasiadas llamadas a herramientas";
    case "context":
      return "El contexto era demasiado grande para el modelo";
    default:
      return "Se agoto el presupuesto de la ejecucion";
  }
}

/** Extrae el limite de la advertencia que deja `runFastDesign` al agotarse. */
function budgetLimit(result: FastDesignResult): string | undefined {
  const found = result.warnings.find((w) => w.startsWith("presupuesto agotado"));
  if (!found) return undefined;
  const parts = found.split(":");
  return parts[1]?.trim();
}

/**
 * Ejecuta el modo rapido sobre el borrador del sitio y deja el resultado a la
 * vista del dueno.
 *
 * Orden: leer borrador y presets, ejecutar el agente, guardar con la revision
 * leida, cerrar la ejecucion. Un 6.4 con `error` o un brief invalido hacen que
 * `runFastDesign` lance: entonces no se guarda nada. Una revision que cambio
 * mientras el agente trabajaba tampoco se pisa: se cierra como `error`.
 */
export async function processDesignJob(deps: DesignDeps, job: DesignJob): Promise<DesignJobResult> {
  try {
    const current = await deps.loadDraft(job.userId, job.siteId);
    if (!current) {
      // Sin borrador no hay donde aplicar el diseño, y no es un fallo del dueno.
      return await finish(deps, job, "error", "El sitio no tiene borrador sobre el que disenar");
    }

    let made: DesignClient | undefined;
    try {
      made = await deps.makeClient(job);
    } catch (e) {
      return await finish(deps, job, "error", `No se pudo preparar el modelo: ${message(e)}`);
    }
    if (!made) {
      return await finish(deps, job, "error", "El servicio de diseno no esta disponible ahora mismo");
    }

    const presets = await deps.loadPresets();
    if (presets.length === 0) {
      // Sin catalogo el diseño saldria inventado. Se cierra antes de gastar.
      return await finish(deps, job, "error", "El catalogo de estilos no esta disponible ahora mismo");
    }

    // Checkpoint PREVIO (9.1): el borrador tal como estaba, antes de que el
    // agente toque nada. Si no se puede guardar no se sigue: un cambio sin
    // vuelta atras es peor que no cambiar.
    try {
      await deps.saveCheckpoint({
        userId: job.userId,
        siteId: job.siteId,
        runId: job.runId,
        rev: current.rev,
        doc: current.doc,
        label: PRE_RUN_CHECKPOINT_LABEL,
      });
    } catch (e) {
      return await finish(deps, job, "error", `No se pudo guardar el punto de vuelta atras: ${message(e)}`);
    }

    let result: FastDesignResult;
    try {
      result = await runFastDesign({
        brief: job.brief,
        presets,
        client: made.client,
        tracker: made.tracker,
        ctx: {
          runId: job.runId,
          userId: job.userId,
          siteId: job.siteId,
          token: made.token,
          // El agente redacta para el dueno: siempre en castellano.
          locale: "es",
          apiBaseUrl: made.apiBaseUrl,
        },
      });
    } catch (e) {
      // Un 6.4 con error, un brief invalido o un fallo del modelo: no se guarda
      // nada. El borrador del dueno queda como estaba.
      return await finish(deps, job, "error", `No se pudo completar el diseno: ${message(e)}`);
    }

    const limit = budgetLimit(result);
    if (limit !== undefined) {
      // Hubo borrador valido, pero la ejecucion se quedo sin presupuesto antes
      // de cerrar el resumen. Se guarda igualmente: es trabajo ya hecho. El
      // resultado del guardado NO se ignora: si el dueno cambio el borrador o
      // el documento no valida, el motivo se lo dice a el y no un falso "listo".
      const savedBudget = await deps.saveDraft({
        userId: job.userId, siteId: job.siteId, doc: result.doc, expectedRev: current.rev,
      });
      return await finish(deps, job, "budget_exhausted", budgetReason(limit, savedBudget), savedBudget.ok ? savedBudget.rev : undefined);
    }

    const saved = await deps.saveDraft({
      userId: job.userId, siteId: job.siteId, doc: result.doc, expectedRev: current.rev,
    });
    if (saved.ok) {
      return await finish(deps, job, "ok", summary(result), saved.rev);
    }
    if (saved.reason === "conflict") {
      // El dueno guardo mientras el agente trabajaba. Reintentar pisaria su
      // trabajo, asi que el job se cierra sin reintento.
      return await finish(
        deps, job, "error",
        "Mientras se generaba el diseno cambio el borrador: no se ha sobrescrito nada",
      );
    }
    return await finish(deps, job, "error", `El diseno no se pudo guardar: ${saved.errors?.join(", ") ?? "contenido no valido"}`);
  } finally {
    // El token vive minutos, pero no debe sobrevivir a la ejecucion ni cuando
    // todo ha ido mal. Un fallo al revocar no cambia el resultado del job.
    await deps.revokeToken(job.runId, job.userId).catch(() => undefined);
  }
}

/**
 * Texto corto para el dueño: la web está lista y qué queda por completar.
 *
 * Nunca menciona el preset: al dueño no le dice nada el id de un estilo del
 * catálogo, y el mensaje es la primera cosa que lee al terminar.
 */
function summary(result: FastDesignResult): string {
  const pending = result.pending.length;
  if (pending === 0) return "Tu web está lista. Revisa los textos y cámbialos cuando quieras.";
  return `Tu web está lista. Hay ${pending} datos que solo tú sabes (marcados como pendientes); cámbialos cuando quieras.`;
}

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
}

async function finish(
  deps: DesignDeps,
  job: DesignJob,
  status: DesignRunStatus,
  stopReason: string,
  rev?: number,
): Promise<DesignJobResult> {
  await deps.finishRun(job.runId, job.userId, status, stopReason);
  return rev === undefined ? { status, stopReason } : { status, stopReason, rev };
}
