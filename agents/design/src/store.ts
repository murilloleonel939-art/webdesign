import { siteDocumentSchema, type SiteDocument } from "@webdesign/site-schema";

// Store en memoria del borrador (spec 9.1).
//
// Guarda el documento y sus checkpoints. La regla que da forma al archivo: una
// mutación se aplica sobre una COPIA y solo se confirma si el documento completo
// valida contra `siteDocumentSchema`. Si no valida, el store no cambia y quien
// llamó recibe el error: el sitio nunca queda en un estado a medio escribir.

export interface Checkpoint {
  id: string;
  doc: SiteDocument;
  createdAt: string;
}

export interface DesignStore {
  doc: SiteDocument;
  checkpoints: Checkpoint[];
}

/** Lo que devuelve toda herramienta que muta. */
export type MutationResult = { ok: true } | { ok: false; errors: string[] };

export function createStore(doc: SiteDocument): DesignStore {
  return { doc, checkpoints: [] };
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

export function saveCheckpoint(store: DesignStore, prefix = "chk"): Checkpoint {
  const checkpoint: Checkpoint = { id: nextId(prefix), doc: structuredClone(store.doc), createdAt: new Date().toISOString() };
  store.checkpoints.push(checkpoint);
  return checkpoint;
}

/**
 * Aplica `mutate` sobre una copia profunda y solo confirma si valida.
 *
 * `mutate` puede lanzar para abortar (por ejemplo, una sección que no existe):
 * la excepción se convierte en error del resultado y no toca el store.
 */
export function applyMutation(store: DesignStore, mutate: (draft: SiteDocument) => void): MutationResult {
  const draft = structuredClone(store.doc) as SiteDocument;
  try {
    mutate(draft);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const check = siteDocumentSchema.safeParse(draft);
  if (!check.success) return { ok: false, errors: check.error.issues.map((i) => `${i.path.join(".") || "doc"}: ${i.message}`) };
  store.doc = check.data;
  return { ok: true };
}

export function findPage(doc: SiteDocument, pageId: string) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`pagina no encontrada: ${pageId}`);
  return page;
}
