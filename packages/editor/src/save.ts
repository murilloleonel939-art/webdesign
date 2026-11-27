import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withUser, type Tx } from "@webdesign/db";
import { lintSite, type LintFinding } from "@webdesign/linter";
import { markOwnerEdits, validateSiteDocument, type SiteDocument } from "@webdesign/site-schema";

// Guardado del borrador desde el editor (spec 1003): solo escribe en el borrador,
// control optimista por `draft_rev` y todo cambio queda en `audit_log`.
// Un conflicto de revision no pisa el trabajo de nadie: se rechaza.

export interface SaveDraftOptions {
  userId: string;
  siteId: string;
  doc: unknown;
  // Revision que el editor cree tener. Si no coincide, hay conflicto.
  expectedRev: number;
  actorType: "user" | "agent";
  licensedAssetIds?: string[];
  /**
   * Marca como del dueño los props que cambian respecto al borrador guardado
   * (T-027). Solo la pone el guardado interactivo del panel: es el único punto
   * donde se sabe a la vez quién guarda y qué había antes, que es exactamente la
   * prueba de autoría. Un guardado del agente, un deshacer o una reparación no
   * marcan nada: ahí el que escribe no es el dueño editando.
   */
  markOwnerEdits?: boolean;
}

export type SaveDraftResult =
  | { ok: true; rev: number; findings: LintFinding[] }
  | { ok: false; reason: "conflict"; currentRev: number }
  | { ok: false; reason: "invalid"; findings: LintFinding[]; errors: string[] };

function hashDoc(doc: unknown): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

/**
 * Marca los props del dueño y comprueba que lo marcado sigue siendo válido.
 *
 * `fallback` es el documento tal como llegó (ya validado): la marca es una
 * mejora, nunca una razón para rechazar el guardado de alguien.
 */
function markedOrOriginal(previous: unknown, next: unknown): unknown {
  // `next` ya pasó por `validateSiteDocument`: el cast solo evita repetir el
  // estrechamiento de tipo aquí dentro, y `markOwnerEdits` tolera basura.
  const marked = markOwnerEdits(previous, next as SiteDocument);
  return validateSiteDocument(marked).ok ? marked : next;
}

export async function saveDraft(pool: Pool, opts: SaveDraftOptions): Promise<SaveDraftResult> {
  // Se valida antes de tocar la base: un documento invalido no entra.
  const validated = validateSiteDocument(opts.doc);
  const findings = lintSite(opts.doc, opts.licensedAssetIds ? { licensedAssetIds: opts.licensedAssetIds } : {});
  if (!validated.ok) {
    return { ok: false, reason: "invalid", findings, errors: validated.errors };
  }

  return withUser(pool, opts.userId, async (tx: Tx) => {
    // El candado de la fila evita que dos guardados simultaneos se pisen.
    const current = await tx.query<{ rev: number; doc: unknown }>(
      "SELECT rev, doc FROM site_drafts WHERE site_id = $1 FOR UPDATE",
      [opts.siteId],
    );
    // bigint llega como string desde pg: sin Number(), rev + 1 seria "11".
    const currentRev = current.rows[0] ? Number(current.rows[0].rev) : 0;
    if (currentRev !== opts.expectedRev) {
      return { ok: false, reason: "conflict" as const, currentRev };
    }
    const nextRev = currentRev + 1;
    // Autoría (T-027): se marca con el documento anterior ya bloqueado, así que
    // la diferencia es la real y no la de una lectura anterior a la carrera. Si
    // el marcado produjera algo inválido se guarda el original: la marca no
    // puede ser el motivo de perder un cambio del dueño.
    const stored = opts.markOwnerEdits === true
      ? markedOrOriginal(current.rows[0]?.doc, opts.doc)
      : opts.doc;
    const hash = hashDoc(stored);
    if (current.rows.length === 0) {
      await tx.query(
        `INSERT INTO site_drafts (site_id, rev, doc, doc_hash, updated_by_type, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [opts.siteId, nextRev, JSON.stringify(stored), hash, opts.actorType, opts.userId],
      );
    } else {
      await tx.query(
        `UPDATE site_drafts SET rev = $2, doc = $3, doc_hash = $4, updated_by_type = $5, updated_by = $6, updated_at = now()
         WHERE site_id = $1`,
        [opts.siteId, nextRev, JSON.stringify(stored), hash, opts.actorType, opts.userId],
      );
    }
    await tx.query(
      `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
       VALUES ($1, $2, $3, $4, 'draft.save', $5, $6)`,
      [randomUUID(), opts.actorType, opts.userId, opts.siteId, `rev${nextRev}`, JSON.stringify({ rev: nextRev, hash })],
    );
    return { ok: true as const, rev: nextRev, findings };
  });
}

// Cargar el borrador de un sitio.
export async function loadDraft(pool: Pool, userId: string, siteId: string): Promise<{ rev: number; doc: unknown } | undefined> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query("SELECT rev, doc FROM site_drafts WHERE site_id = $1", [siteId]);
    const row = r.rows[0];
    return row ? { rev: Number(row.rev), doc: row.doc } : undefined;
  });
}
