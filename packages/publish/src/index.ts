import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { withUser, type Tx } from "@webdesign/db";
import { lintSite, blocksPublication, type LintFinding } from "@webdesign/linter";
import { lintRelease, needsOwnerConfirmation } from "@webdesign/lint-visual";
import { publishRelease, switchRelease, listVersions } from "@webdesign/releases";
import { renderPage, fontsForTheme, FONTS_DIR } from "@webdesign/renderer";
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

// Bloqueo por «ya tienes otro sitio publicado». No es un hallazgo del linter:
// es el indice parcial sites_one_active_per_owner (0003:33 y 0008:163), que
// solo admite un sitio `active` por cuenta. Sin `findings` a proposito: quien
// lea `r.findings` sin pasar por el guard no compila, y el motivo queda como
// discriminante explicito en vez de un booleano ambiguo.
export interface AnotherSiteActiveBlock {
  ok: false;
  blocked: true;
  reason: "another_site_active";
  activeSiteId: string;
  activeSiteName: string;
}

export type PublishResult =
  | { ok: true; version: number; findings: LintFinding[]; visual: LintFinding[] }
  // `blocked: true` es contenido invalido (6.4). `blocked: false` es que el
  // dueno debe confirmar un hallazgo visual (6.5): puede publicar igual.
  | { ok: false; blocked: true; findings: LintFinding[] }
  | { ok: false; blocked: false; findings: LintFinding[]; visual: LintFinding[] }
  | AnotherSiteActiveBlock;

/** Estrecha el resultado al bloqueo por sitio activo, sin mirar `findings`. */
export function isAnotherSiteActive(r: PublishResult): r is AnotherSiteActiveBlock {
  return r.ok === false && "reason" in r && r.reason === "another_site_active";
}

// Clave del bloqueo consultivo por dueno: mismo par (namespace, hashtext) en
// publicar y despublicar, para que ambas operaciones de una cuenta se serialicen.
const ACTIVE_SITE_LOCK_NS = 4711;

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

/**
 * `.ttf` que la release debe servir, ya mapeados a su ruta publica (T-030b).
 *
 * El CSS del tema referencia `/fonts/<archivo>.ttf` desde el dominio del sitio;
 * hasta ahora nadie copiaba esos archivos a la release, asi que en produccion
 * daban 404 y el navegador usaba la pila de respaldo. Aqui se enlazan una sola
 * vez por release, con la ruta exacta que pide el CSS.
 *
 * Solo se enlazan las fuentes que el tema usa (`fontsForTheme`), no las once.
 * Un archivo que falte en el paquete se omite en vez de tumbar la publicacion:
 * el CSS ya trae la pila del sistema detras y el sitio sigue siendo usable.
 */
export function fontFiles(theme: SiteDocument["theme"]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of fontsForTheme(theme)) {
    const source = join(FONTS_DIR, name);
    if (!existsSync(source)) continue;
    files[`fonts/${name}`] = source;
  }
  return files;
}

export async function publish(pool: Pool, opts: PublishOptions): Promise<PublishResult> {  const validated = validateSiteDocument(opts.doc);
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

  const hash = docHash(opts.doc);

  // ORDEN IMPORTANTE: `publishRelease` escribe en disco y mueve el symlink
  // `public`. Por eso la comprobacion del sitio activo va ANTES, no despues:
  // si bloquearamos despues, quedarian ficheros de una release que no existe
  // en la base (v(N) en disco sin fila en `site_versions`, `public` apuntando
  // a ella y `sites.published_version` intacto). Ademas, hacerlo despues del
  // UPDATE es lo que reventaba: el indice parcial sites_one_active_per_owner
  // (0003:33, 0008:163) lanzaba 23505 dentro de la transaccion y el throw
  // subia hasta el handler HTTP, matando el proceso.
  //
  // El bloqueo consultivo por dueno serializa publicar y despublicar de la
  // misma cuenta: sin el, dos publicaciones simultaneas pasan las dos la
  // comprobacion (ninguna ve a la otra) y una choca contra el indice igual.
  return await withUser(pool, opts.userId, async (tx: Tx): Promise<PublishResult> => {
    await tx.query(`SELECT pg_advisory_xact_lock(${ACTIVE_SITE_LOCK_NS}, hashtext($1))`, [opts.userId]);

    const other = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM sites WHERE owner_id = $1 AND status = 'active' AND id <> $2 LIMIT 1`,
      [opts.userId, opts.siteId],
    );
    const active = other.rows[0];
    if (active) {
      // Spec 1.15 (lineas 90, 597 y 1481): un solo sitio publicado por cuenta.
      // No se lanza: se devuelve, para que quien llama responda 409 y el
      // dueno decida despublicar. Nada se ha escrito aun en disco ni en la base.
      return {
        ok: false, blocked: true, reason: "another_site_active",
        activeSiteId: active.id, activeSiteName: active.name,
      };
    }

    // Ya con la certeza de que no hay otro activo, se escribe el release.
    // Las fuentes del tema se suman a los assets: mismo hardlink y misma
    // comprobacion de rutas. Un tema del catalogo antiguo no aporta ninguna,
    // asi que su release sale sin `fonts/` y sigue funcionando como antes.
    const version = publishRelease(opts.sitesRoot, opts.siteId, files, {
      ...(opts.assetFiles ?? {}),
      ...fontFiles(doc.theme),
    });
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
    return { ok: true, version, findings, visual };
  });
}

// Despublicar (spec 1.15: "publicar otro EXIGE despublicar el anterior").
// No borra NADA: ni el release en disco ni las filas de `site_versions` ni los
// assets. Solo devuelve el sitio a `draft`, que es lo unico que mira el indice
// sites_one_active_per_owner para decidir quien esta publicado.
export interface UnpublishOptions {
  userId: string;
  siteId: string;
}

export type UnpublishResult =
  | { ok: true; alreadyDraft: boolean; previousVersion: number | null }
  // Sitio ajeno o inexistente: la misma respuesta para no filtrar existencia.
  | { ok: false; reason: "not_found" };

export async function unpublish(pool: Pool, opts: UnpublishOptions): Promise<UnpublishResult> {
  return await withUser(pool, opts.userId, async (tx: Tx): Promise<UnpublishResult> => {
    // Mismo cerrojo por dueno que `publish`: despublicar mientras otra peticion
    // publica el mismo sitio debe decidir en orden, no a la vez.
    await tx.query(`SELECT pg_advisory_xact_lock(${ACTIVE_SITE_LOCK_NS}, hashtext($1))`, [opts.userId]);

    const found = await tx.query<{ status: string; published_version: number | null }>(
      `SELECT status, published_version FROM sites WHERE id = $1 AND owner_id = $2`,
      [opts.siteId, opts.userId],
    );
    const row = found.rows[0];
    if (!row) return { ok: false, reason: "not_found" };

    const previousVersion = row.published_version === null ? null : Number(row.published_version);
    // Ya en draft: idempotente y sin fila de auditoria nueva, porque no ha
    // cambiado nada. Repetir el boton no debe llenar `audit_log` de ruido.
    if (row.status === "draft") return { ok: true, alreadyDraft: true, previousVersion };

    await tx.query(`UPDATE sites SET status = 'draft' WHERE id = $1 AND owner_id = $2`, [opts.siteId, opts.userId]);
    await tx.query(
      `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
       VALUES ($1, 'user', $2, $3, 'site.unpublish', $4, $5)`,
      [randomUUID(), opts.userId, opts.siteId, previousVersion === null ? "draft" : `v${previousVersion}`,
       JSON.stringify({ from: row.status, to: "draft", publishedVersion: previousVersion })],
    );
    return { ok: true, alreadyDraft: false, previousVersion };
  });
}

export interface RollbackOptions {
  sitesRoot: string;
  userId: string;
  siteId: string;
}

export type RollbackResult =
  | { ok: true; version: number }
  // Sitio ajeno o inexistente: misma respuesta para no filtrar existencia.
  | { ok: false; reason: "not_found" }
  // Version no entera/<1, o sin release en disco para ese sitio.
  | { ok: false; reason: "invalid_version" };

// Revertir es volver a una version que ya existe: el documento no cambia.
// ORDEN IMPORTANTE (mismo motivo que publish/unpublish): la comprobacion de
// dueno y de version va ANTES de tocar el symlink `public`. Antes, `rollbackFs`/
// `switchRelease` se llamaban con el `siteId` crudo de la URL, sin pasar por
// `withUser` ni comprobar `owner_id`: cualquier sesion valida podia mover el
// symlink publico de un sitio ajeno con solo adivinar su UUID.
export async function rollbackTo(pool: Pool, opts: RollbackOptions, version?: number): Promise<RollbackResult> {
  return await withUser(pool, opts.userId, async (tx: Tx): Promise<RollbackResult> => {
    // Mismo cerrojo por dueno que publish/unpublish: serializa quien mueve el
    // symlink de las releases de esta cuenta.
    await tx.query(`SELECT pg_advisory_xact_lock(${ACTIVE_SITE_LOCK_NS}, hashtext($1))`, [opts.userId]);

    const found = await tx.query<{ id: string }>(
      `SELECT 1 FROM sites WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
      [opts.siteId, opts.userId],
    );
    if (found.rowCount === 0) return { ok: false, reason: "not_found" };

    // Si no se pide version, la anterior en la lista de releases; si se pide,
    // debe ser entera >= 1 y existir ya como release en disco. Se resuelve
    // aqui, con la lista ordenada real: `currentVersion - 1` no siempre es la
    // anterior (se pueden haber borrado releases intermedias), y `rollbackFs`
    // lanzaba si habia menos de dos.
    const versions = listVersions(opts.sitesRoot, opts.siteId);
    const requested = version ?? versions.at(-2);
    if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
      return { ok: false, reason: "invalid_version" };
    }
    if (!versions.includes(requested)) return { ok: false, reason: "invalid_version" };

    const target = requested;
    switchRelease(opts.sitesRoot, opts.siteId, target);

    await tx.query(
      `INSERT INTO audit_log (id, actor_type, actor_id, site_id, action, target, meta)
       VALUES ($1, 'user', $2, $3, 'site.rollback', $4, $5)`,
      [randomUUID(), opts.userId, opts.siteId, `v${target}`, JSON.stringify({ to: target })],
    );
    await tx.query(`UPDATE sites SET published_version = $2 WHERE id = $1 AND owner_id = $3`, [opts.siteId, target, opts.userId]);
    return { ok: true, version: target };
  });
}
