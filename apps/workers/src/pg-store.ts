import { randomUUID } from "node:crypto";
import pg from "pg";
import type { LintFinding } from "@webdesign/linter";
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
