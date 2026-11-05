import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withUser, type Tx } from "@webdesign/db";
import { lintSite, type LintFinding } from "@webdesign/linter";
import { validateSiteDocument } from "@webdesign/site-schema";

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
}

export type SaveDraftResult =
  | { ok: true; rev: number; findings: LintFinding[] }
  | { ok: false; reason: "conflict"; currentRev: number }
  | { ok: false; reason: "invalid"; findings: LintFinding[]; errors: string[] };

function hashDoc(doc: unknown): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
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
    const current = await tx.query<{ rev: number }>(
      "SELECT rev FROM site_drafts WHERE site_id = $1 FOR UPDATE",
      [opts.siteId],
    );
    // bigint llega como string desde pg: sin Number(), rev + 1 seria "11".
    const currentRev = current.rows[0] ? Number(current.rows[0].rev) : 0;
    if (currentRev !== opts.expectedRev) {
      return { ok: false, reason: "conflict" as const, currentRev };
    }
    const nextRev = currentRev + 1;
    const hash = hashDoc(opts.doc);
    if (current.rows.length === 0) {
      await tx.query(
        `INSERT INTO site_drafts (site_id, rev, doc, doc_hash, updated_by_type, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [opts.siteId, nextRev, JSON.stringify(opts.doc), hash, opts.actorType, opts.userId],
      );
    } else {
      await tx.query(
        `UPDATE site_drafts SET rev = $2, doc = $3, doc_hash = $4, updated_by_type = $5, updated_by = $6, updated_at = now()
         WHERE site_id = $1`,
        [opts.siteId, nextRev, JSON.stringify(opts.doc), hash, opts.actorType, opts.userId],
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
