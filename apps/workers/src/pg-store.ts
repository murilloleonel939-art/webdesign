import { randomUUID } from "node:crypto";
import pg from "pg";
import { withUser } from "@webdesign/db";
import { loadDraft, saveDraft } from "@webdesign/editor/save";
import type { LintFinding } from "@webdesign/linter";
import { BudgetTracker, GatewayTransport, LlmClient } from "@webdesign/llm";
import type { Preset } from "@webdesign/agent-design";
import { fastBudget, type DesignDeps, type DesignJob, type DesignSaveResult } from "./design-job.js";
import type { LintDeps } from "./lint-job.js";

// Implementacion real de las dependencias del job con Postgres.
//
// El worker corre en segundo plano, sin sesion de usuario. Las tablas llevan
// FORCE ROW LEVEL SECURITY y `app_platform` es NOBYPASSRLS, asi que se abre una
// marca de transaccion propia (`app.release_lint`) que las politicas de 0017
// exigen. Vive solo lo que dura la transaccion, igual que `app.public_form`.

const MARK = "SELECT set_config('app.release_lint', 'on', true)";

/** Abre una transaccion con la marca del worker puesta y la cierra siempre. */
async function withLintMark<T>(pool: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(MARK);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function pgLintDeps(pool: pg.Pool): LintDeps {
  return {
    async loadVersion(siteId: string, version: number) {
      const r = await withLintMark(pool, (tx) =>
        tx.query<{ doc: unknown }>("SELECT doc FROM site_versions WHERE site_id = $1 AND version = $2", [siteId, version]),
      );
      const row = r.rows[0];
      return row === undefined ? null : { doc: row.doc };
    },

    async saveFindings(siteId: string, version: number, findings: LintFinding[]) {
      // Borrar y reinsertar en la misma transaccion: si el INSERT falla, no se
      // pierden los hallazgos anteriores. Y repetir el job no duplica filas.
      await withLintMark(pool, async (tx) => {
        await tx.query("DELETE FROM release_lint_findings WHERE site_id = $1 AND version = $2", [siteId, version]);
        if (findings.length === 0) return;
        // Un solo INSERT con arrays: el job puede devolver cientos de hallazgos
        // y una sentencia por fila seria un viaje por cada uno.
        const ids: string[] = [];
        const codes: string[] = [];
        const severities: string[] = [];
        const messages: string[] = [];
        const pageIds: (string | null)[] = [];
        for (const f of findings) {
          ids.push(randomUUID());
          codes.push(f.code);
          severities.push(f.severity);
          messages.push(f.message);
          pageIds.push(f.pageId ?? null);
        }
        await tx.query(
          `INSERT INTO release_lint_findings (id, site_id, version, code, severity, message, page_id)
           SELECT u.id, $2::uuid, $3::integer, u.code, u.severity, u.message, u.page_id
           FROM unnest($1::uuid[], $4::text[], $5::text[], $6::text[], $7::text[])
             AS u(id, code, severity, message, page_id)`,
          [ids, siteId, version, codes, severities, messages, pageIds],
        );
      });
    },
  };
}

// --- Agente de diseno (punto C) ---------------------------------------------
//
// Aqui SI hay usuario: el job lleva `userId` y todas las consultas pasan por
// `withUser`, igual que las rutas del panel. Las politicas de 0014 hacen el
// resto, y 0020 concede los privilegios de tabla que faltaban.
//
// El token del agente no viaja en el job: se lee de `agent_tokens` al construir
// el cliente y se revoca al terminar. Vive minutos, no en un mensaje de cola.

/** Fila de `agent_tokens` para una ejecucion: el `jti` es el token del gateway. */
async function readToken(pool: pg.Pool, userId: string, runId: string): Promise<string | undefined> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ jti: string }>(
      `SELECT jti FROM agent_tokens
       WHERE run_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    const row = r.rows[0];
    return row === undefined ? undefined : row.jti;
  });
}

/** Presets activos del catalogo: el diseno sale de aqui, no de la imaginacion. */
async function loadPresets(pool: pg.Pool): Promise<Preset[]> {
  // Sin RLS ni usuario: `design_styles` es catalogo global y 0009 ya concede
  // SELECT a `app_platform`. Se filtra `kind = 'preset'` como hace `listStyles`
  // en el panel: un estilo de referencia importado no cambia nada al aplicarlo.
  const r = await pool.query<{
    id: string; name: string; summary: string; colors: unknown; typography: unknown;
    spacing: unknown; radius: "square" | "rounded" | "pill"; dials: unknown; sections: unknown;
  }>(
    `SELECT id, name, summary, colors, typography, spacing, radius, dials, sections
     FROM design_styles WHERE status = 'active' AND kind = 'preset' ORDER BY name`,
  );
  return r.rows.map((row) => {
    // `dials` es NOT NULL en 0009, pero `Preset.dials` es opcional: se omite la
    // clave cuando no hay objeto en vez de pasarla como `undefined`, que con
    // `exactOptionalPropertyTypes` no encaja.
    const preset: Preset = {
      id: row.id,
      name: row.name,
      summary: row.summary,
      colors: row.colors as Preset["colors"],
      typography: row.typography as Preset["typography"],
      spacing: row.spacing as Preset["spacing"],
      radius: row.radius,
      sections: row.sections as Array<{ type: string }>,
    };
    const dials = row.dials as Preset["dials"];
    return dials === undefined || dials === null ? preset : { ...preset, dials };
  });
}

/**
 * Assets del sitio con licencia registrada.
 *
 * El linter 6.4 exige licencia a todo asset de coleccion abierta
 * (`IMAGE_LICENSE_MISSING`, packages/linter/src/index.ts:94): las fotos de
 * Pexels se registran con `source = 'open-collection'` y su
 * `license = 'Pexels License'` (internal-photos.ts:238-240, via
 * `registerAsset`), asi que la consulta de aqui es la misma regla que usa el
 * publicador en apps/platform/src/api.ts:199 (activeAssets): cuentan `own`,
 * `generated` y `open-collection` con licencia no nula y no vacia.
 */
async function licensedAssetIds(pool: pg.Pool, userId: string, siteId: string): Promise<string[]> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM assets
       WHERE site_id = $1
         AND (source IN ('own', 'generated') OR (source = 'open-collection' AND license IS NOT NULL AND license <> ''))`,
      [siteId],
    );
    return r.rows.map((row) => row.id);
  });
}

/** Cierra la ejecucion. `UPDATE ... AND status = 'running'` evita reescribirla. */async function finishRun(
  pool: pg.Pool,
  userId: string,
  runId: string,
  status: "ok" | "error" | "budget_exhausted",
  stopReason: string,
): Promise<void> {
  await withUser(pool, userId, async (tx) => {
    await tx.query(
      `UPDATE agent_runs
       SET status = $2, stop_reason = $3, ended_at = now()
       WHERE id = $1 AND status = 'running'`,
      [runId, status, stopReason],
    );
  });
}

/** Revoca el token de la ejecucion. Idempotente: revocar dos veces no falla. */
async function revokeToken(pool: pg.Pool, userId: string, runId: string): Promise<void> {
  await withUser(pool, userId, async (tx) => {
    await tx.query(
      "UPDATE agent_tokens SET revoked_at = now() WHERE run_id = $1 AND revoked_at IS NULL",
      [runId],
    );
  });
}

/**
 * Arma el cliente del gateway para una ejecucion.
 *
 * Devuelve `undefined` si falta configuracion o el token ya no vale: el job lo
 * convierte en `error` con un motivo legible, no en una excepcion. La clave del
 * proveedor NO esta aqui; el gateway es el unico que la tiene.
 */
async function makeDesignClient(
  pool: pg.Pool,
  env: { gatewayUrl?: string; apiBaseUrl: string },
  job: DesignJob,
): Promise<{ client: LlmClient; tracker: BudgetTracker; token: string; apiBaseUrl: string } | undefined> {
  if (!env.gatewayUrl) return undefined;
  const token = await readToken(pool, job.userId, job.runId);
  if (token === undefined) return undefined;
  const tracker = new BudgetTracker(fastBudget());
  const transport = new GatewayTransport({ baseUrl: env.gatewayUrl, runId: job.runId, token });
  // Sin reintentos: el job ya se reintenta desde la cola, y un 429 del gateway
  // significa presupuesto agotado, no un fallo pasajero que se arregle esperando.
  const client = new LlmClient(transport, tracker, { maxRetries: 0 });
  return { client, tracker, token, apiBaseUrl: env.apiBaseUrl };
}

/**
 * Guarda el checkpoint previo en `draft_checkpoints` (spec 9.1).
 *
 * Es el punto de vuelta atras del dueno: el borrador tal como estaba antes de
 * que el agente escribiera, con su revision en la etiqueta para poder decir a
 * que estado se vuelve. La fila la crea el dueno (`created_by = userId`) porque
 * el agente trabaja en su nombre; la politica `draft_checkpoints_owner` de 0014
 * ya limita lo que se ve y lo que se escribe a los sitios de ese usuario.
 *
 * Un duplicado del mismo run no es un error: la clave es el id, que se compone
 * con el run para que reintentar el job no llene la tabla de copias iguales.
 */
async function saveCheckpoint(
  pool: pg.Pool,
  input: { userId: string; siteId: string; runId: string; rev: number; doc: unknown; label: string },
): Promise<void> {
  await withUser(pool, input.userId, async (tx) => {
    await tx.query(
      `INSERT INTO draft_checkpoints (id, site_id, run_id, label, doc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        // Deterministico por ejecucion: reintentar el job no duplica el punto
        // de vuelta atras ni cambia el que el dueno ya tiene.
        runUuid(input.runId),
        input.siteId,
        input.runId,
        `${input.label} (rev ${input.rev})`,
        // Se guarda el documento tal cual: es lo que se restaura.
        JSON.stringify(input.doc ?? {}),
        input.userId,
      ],
    );
  });
}

/**
 * Id estable del checkpoint de una ejecucion.
 *
 * `draft_checkpoints.id` es uuid y `run_id` tambien: reutilizar el del run deja
 * un idempotente sin inventar un hash. Se valida la forma antes de usarlo para
 * no mandar basura a una columna uuid.
 */
function runUuid(runId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("runId no es un uuid");
  }
  return runId;
}

export interface PgDesignOptions {
  /** `LLM_GATEWAY_URL`. Sin el, el worker de diseno no arranca. */
  gatewayUrl?: string;
  /** Base de la API interna que viaja en el `RunContext`. */
  apiBaseUrl: string;
}

export function pgDesignDeps(pool: pg.Pool, opts: PgDesignOptions): DesignDeps {
  return {
    loadDraft: (userId, siteId) => loadDraft(pool, userId, siteId),

    loadPresets: () => loadPresets(pool),

    saveCheckpoint: (input) => saveCheckpoint(pool, input),

    async saveDraft({ userId, siteId, doc, expectedRev }): Promise<DesignSaveResult> {
      // `actorType: 'agent'`: el `audit_log` distingue lo que escribio el agente
      // de lo que escribio el dueno sin mirar el `updated_by`.
      // `licensedAssetIds` va siempre: sin el, las fotos que acaba de registrar
      // la ruta interna salen como `IMAGE_LICENSE_MISSING` (error de 6.4) en el
      // guardado y el borrador se rechaza.
      const licensed = await licensedAssetIds(pool, userId, siteId);
      const r = await saveDraft(pool, { userId, siteId, doc, expectedRev, actorType: "agent", licensedAssetIds: licensed });
      if (r.ok) return { ok: true, rev: r.rev };
      if (r.reason === "conflict") return { ok: false, reason: "conflict", currentRev: r.currentRev };
      return { ok: false, reason: "invalid", errors: r.errors };
    },

    finishRun: (runId, userId, status, stopReason) => finishRun(pool, userId, runId, status, stopReason),

    revokeToken: (runId, userId) => revokeToken(pool, userId, runId),

    makeClient: (job) => makeDesignClient(pool, opts, job),
  };
}
