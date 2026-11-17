import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withUser, type Tx } from "@webdesign/db";
import { lintSite, blocksPublication, type LintFinding } from "@webdesign/linter";
import { lintRelease, needsOwnerConfirmation } from "@webdesign/lint-visual";
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
  // El dueno ha visto un `error` de 6.5 y ha pulsado «Publicar igual».
  // Sin esto, el flujo devuelve la pantalla de confirmacion.
  confirmVisualFindings?: boolean;
  // El catalogo declaro pareja tipografica para el preset aplicado. El
  // documento no lo lleva: lo sabe quien conoce el preset, no el renderer.
  pairingExpected?: boolean;
  resolveAssetPath?: (assetId: string) => string | undefined;
  // Ficheros a enlazar en la release: "assets/<ruta>" -> ruta absoluta del asset.
  assetFiles?: Record<string, string>;
  licensedAssetIds?: string[];
}

export type PublishResult =
  | { ok: true; version: number; findings: LintFinding[]; visual: LintFinding[] }
  // `blocked: true` es contenido invalido (6.4). `blocked: false` es que el
  // dueno debe confirmar un hallazgo visual (6.5): puede publicar igual.
  | { ok: false; blocked: true; findings: LintFinding[] }
  | { ok: false; blocked: false; findings: LintFinding[]; visual: LintFinding[] };

/**
 * Opciones del linter visual deducidas del documento.
 *
 * `pairingExpected` sale del catalogo: si el preset declaro una pareja
 * tipografica, una sola familia es un defecto. Si no la declaro, es una
 * decision legitima y no se avisa.
 */
function visualOptions(doc: SiteDocument, pairingExpected: boolean): { pairingExpected: boolean; rhythmPx?: number } {
  const rhythm = doc.theme.spacing.sectionGap;
  return {
    pairingExpected,
    ...(typeof rhythm === "number" ? { rhythmPx: rhythm } : {}),
  };
}

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
  // Un documento invalido no se puede publicar nunca: no hay nada que renderizar.
  if (!validated.ok) {
    return { ok: false, blocked: true, findings: lintSite(opts.doc, opts.licensedAssetIds ? { licensedAssetIds: opts.licensedAssetIds } : {}) };
  }

  const doc: SiteDocument = validated.doc;
  const resolve = opts.resolveAssetPath ?? (() => undefined);

  // Publicar sin el fichero deja el hueco de la seccion en el sitio, sin ruido
  // y solo visible a ojo: paso con una imagen que el release no traia. Se
  // informa junto al resto de hallazgos, no en vez de ellos.
  const missing: LintFinding[] = [];
  for (const page of doc.pages) {
    for (const section of page.sections) {
      const props = section.props as Record<string, unknown>;
      const used: string[] = [];
      if (typeof props["assetId"] === "string" && props["assetId"]) used.push(props["assetId"]);
      if (Array.isArray(props["assetIds"])) used.push(...(props["assetIds"] as string[]).filter((x) => typeof x === "string" && x));
      for (const aid of new Set(used)) {
        if (!resolve(aid)) {
          missing.push({
            code: "MISSING_ASSET", severity: "error",
            pageId: page.id, sectionId: section.id, field: "assetId",
            message: "lint.missingAsset", fixHint: aid, autofixable: false,
          });
        }
      }
    }
  }

  const findings = [
    ...lintSite(opts.doc, opts.licensedAssetIds ? { licensedAssetIds: opts.licensedAssetIds } : {}),
    ...missing,
  ];
  // Con hallazgos `error` solo publica si el dueno lo confirma expresamente.
  if (blocksPublication(findings) && !opts.confirmWarnings) {
    return { ok: false, blocked: true, findings };
  }

  const rendered = new Map<string, string>();
  for (const page of doc.pages) {
    rendered.set(page.id, renderPage(doc, page.id, (assetId) => {
      const src = resolve(assetId);
      if (!src) return undefined;
      const alt = doc.assets.find((a) => a.id === assetId)?.alt ?? "";
      return { src, alt };
    }));
  }
  const files: Record<string, string> = {};
  for (const page of doc.pages) files[slugToFile(page.slug)] = rendered.get(page.id)!;

  // Lint visual (spec 6.5): sobre el HTML ya renderizado, despues de renderizar
  // y antes del swap atomico. Ningun hallazgo de aqui bloquea: como mucho el
  // dueno confirma, y ya lo ha hecho al pulsar publicar. Un `error` de 6.5 se
  // registra en `audit_log` con sus codigos para que quede rastro de que el
  // sitio salio con ese defecto. El bloqueo duro es exclusivo de 6.4.
  const visual = lintRelease(rendered, visualOptions(doc, opts.pairingExpected === true));
  if (needsOwnerConfirmation(visual) && !opts.confirmVisualFindings) {
    // El dueno no ha visto todavia el defecto: se le ensena y decide el.
    // Devuelve `blocked: false` en el sentido de 6.5 — no es un bloqueo de
    // contenido, es la pantalla de confirmacion con «Publicar igual».
    return { ok: false, blocked: false, findings: [...findings, ...visual], visual };
  }

  // Primero el sistema de ficheros: si falla, no se toca la base.
  const version = publishRelease(opts.sitesRoot, opts.siteId, files, opts.assetFiles ?? {});
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
      [randomUUID(), opts.userId, opts.siteId, `v${version}`, JSON.stringify({
         version,
         findings: findings.map((f) => f.code),
         confirmed: opts.confirmWarnings === true,
         // Spec 6.5: queda registrado quien confirmo y que codigos habia.
         visual: visual.map((f) => f.code),
         visualConfirmed: opts.confirmVisualFindings === true,
       })],
    );
    await tx.query(
      `UPDATE sites SET status = 'active', published_version = $2, published_page_count = $3
       WHERE id = $1 AND status <> 'active'`,
      [opts.siteId, version, doc.pages.length],
    );
  });

  return { ok: true, version, findings, visual };
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
