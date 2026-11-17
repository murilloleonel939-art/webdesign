import { lintRelease } from "@webdesign/lint-visual";
import type { LintFinding } from "@webdesign/linter";
import { renderPage } from "@webdesign/renderer";
import { validateSiteDocument } from "@webdesign/site-schema";

// Job de lint visual de un release (spec 6.5). Logica pura: no habla con Redis
// ni con Postgres. Todo lo que toca el mundo exterior entra por `deps`, y eso es
// lo que permite probarlo sin levantar nada.
//
// Nunca bloquea: si el release no existe devuelve 0, y si algo revienta, el que
// llama decide. La publicacion ya ha terminado antes de que este job empiece.

export interface LintJob {
  siteId: string;
  version: number;
}

export interface LintDeps {
  /** El documento del release, o null si no existe. */
  loadVersion(siteId: string, version: number): Promise<{ doc: unknown } | null>;
  /** Sustituye los hallazgos previos de ese release: el job es idempotente. */
  saveFindings(siteId: string, version: number, findings: LintFinding[]): Promise<void>;
}

/**
 * Renderiza todas las paginas del release y corre el linter visual sobre el HTML.
 *
 * Se renderiza igual que en `publish`: mismos ids de pagina y el mismo resolver
 * de assets, para que el HTML sea el que el release acaba sirviendo.
 */
export async function processLintJob(job: LintJob, deps: LintDeps): Promise<{ count: number }> {
  const loaded = await deps.loadVersion(job.siteId, job.version);
  // Sin release no hay nada que analizar, y no es un error: el release pudo
  // borrarse, o el job se reentrego tarde.
  if (loaded === null) return { count: 0 };

  const validated = validateSiteDocument(loaded.doc);
  // Un documento invalido no se puede renderizar; `publish` no llega a crear el
  // release en ese caso, asi que aqui solo cabe un release antiguo o corrupto.
  if (!validated.ok) return { count: 0 };
  const doc = validated.doc;

  const pages = new Map<string, string>();
  for (const page of doc.pages) {
    pages.set(page.id, renderPage(doc, page.id, () => undefined));
  }

  const findings = lintRelease(pages);
  // Se guarda siempre, incluso sin hallazgos: es lo que borra los de una
  // ejecucion anterior del mismo release.
  await deps.saveFindings(job.siteId, job.version, findings);
  return { count: findings.length };
}
