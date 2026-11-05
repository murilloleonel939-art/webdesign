import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withUser, type Tx } from "@webdesign/db";
import { lintSite, blocksPublication, type LintFinding } from "@webdesign/linter";
import { publishRelease, rollback as rollbackFs, switchRelease, currentVersion } from "@webdesign/releases";
import { renderPage } from "@webdesign/renderer";
import { validateSiteDocument, type SiteDocument } from "@webdesign/site-schema";

// Flujo de publicacion (spec 4.3): validar -> lint -> renderizar -> escribir release
// -> registrar version y auditoria -> swap atomico del symlink.
// Los `error` del linter bloquean salvo que el dueno confirme; la confirmacion queda
// en audit_log (spec 6.4: el linter nunca es puerta del agente).

export interface PublishOptions {
  sitesRoot: string;
  userId: string;
  siteId: string;
  doc: unknown;
  note?: string;
  // El dueno decide publicar aun con hallazgos: queda registrado.
  confirmWarnings?: boolean;
  resolveAssetPath?: (assetId: string) => string | undefined;
  licensedAssetIds?: string[];
}

export type PublishResult =
  | { ok: true; version: number; findings: LintFinding[] }
  | { ok: false; blocked: true; findings: LintFinding[] };

function docHash(doc: unknown): string {
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

// Slug -> nombre de fichero. "/" es index.html; "/precios" es precios/index.html.
export function slugToFile(slug: string): string {
  if (slug === "/") return "index.html";
  return `${slug.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
}

export async function publish(pool: Pool, opts: PublishOptions): Promise<PublishResult> {
  const validated = validateSiteDocument(opts.doc);
  const findings = lintSite(opts.doc, opts.licensedAssetIds ? { licensedAssetIds: opts.licensedAssetIds } : {});
  // Un documento invalido no se puede publicar nunca: no hay nada que renderizar.
  if (!validated.ok) return { ok: false, blocked: true, findings };
  // Con hallazgos `error` solo publica si el dueno lo confirma expresamente.
  if (blocksPublication(findings) && !opts.confirmWarnings) {
    return { ok: false, blocked: true, findings };
  }

  const doc: SiteDocument = validated.doc;
  const resolve = opts.resolveAssetPath ?? (() => undefined);
  const files: Record<string, string> = {};
  for (const page of doc.pages) {
    files[slugToFile(page.slug)] = renderPage(doc, page.id, (assetId) => {
      const src = resolve(assetId);
      if (!src) return undefined;
      const alt = doc.assets.find((a) => a.id === assetId)?.alt ?? "";
      return { src, alt };
    });
  }

  // Primero el sistema de ficheros: si falla, no se toca la base.
  const version = publishRelease(opts.sitesRoot, opts.siteId, files);
  const hash = docHash(opts.doc);

  await withUser(pool, opts.userId, async (tx: Tx) => {
    await tx.query(
      `INSERT INTO site_versions (id, site_id, version, schema_version, doc, doc_hash, created_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), opts.siteId, version, doc.schemaVersion, JSON.stringify(opts.doc), hash, opts.userId, opts.note ?? null],
    );
    await tx.query(
      `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
       VALUES ($1, 'user', $2, $3, 'site.publish', $4, $5)`,
      [randomUUID(), opts.userId, opts.siteId, `v${version}`, JSON.stringify({ version, findings: findings.map((f) => f.code), confirmed: opts.confirmWarnings === true })],
    );
    await tx.query(
      `UPDATE sites SET status = 'active', published_version = $2, published_page_count = $3
       WHERE id = $1 AND status <> 'active'`,
      [opts.siteId, version, doc.pages.length],
    );
  });

  return { ok: true, version, findings };
}

export interface RollbackOptions {
  sitesRoot: string;
  userId: string;
  siteId: string;
}

// Revertir es volver a una version que ya existe: el documento no cambia.
export async function rollbackTo(pool: Pool, opts: RollbackOptions, version?: number): Promise<number> {
  // Revertir a una version concreta, o a la anterior si no se indica.
  const target = version ?? currentVersion(opts.sitesRoot, opts.siteId) - 1;
  if (!Number.isInteger(target) || target < 1) throw new Error("invalid target version");
  if (version === undefined) rollbackFs(opts.sitesRoot, opts.siteId);
  else switchRelease(opts.sitesRoot, opts.siteId, version);
  await withUser(pool, opts.userId, async (tx: Tx) => {
    await tx.query(
      `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
       VALUES ($1, 'user', $2, $3, 'site.rollback', $4, $5)`,
      [randomUUID(), opts.userId, opts.siteId, `v${target}`, JSON.stringify({ to: target })],
    );
    await tx.query(`UPDATE sites SET published_version = $2 WHERE id = $1`, [opts.siteId, target]);
  });
  return target;
}
