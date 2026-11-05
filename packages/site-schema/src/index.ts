// Esquema mínimo del documento de sitio. Tipo desconocido = rechazado.
export const BLOCK_TYPES = ["hero", "text", "image", "contact"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface Block {
  type: BlockType;
  id: string;
}

export interface SiteDocument {
  schemaVersion: 1;
  blocks: Block[];
}

export type ValidationResult =
  | { ok: true; doc: SiteDocument }
  | { ok: false; errors: string[] };

export function validateSiteDocument(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["document: must be an object"] };
  }
  const d = input as Record<string, unknown>;
  if (d["schemaVersion"] !== 1) errors.push("schemaVersion: must be 1");
  if (!Array.isArray(d["blocks"])) {
    errors.push("blocks: must be an array");
  } else {
    d["blocks"].forEach((b, i) => {
      const block = b as Record<string, unknown>;
      if (typeof block !== "object" || block === null) {
        errors.push(`blocks[${i}]: must be an object`);
        return;
      }
      if (!BLOCK_TYPES.includes(block["type"] as BlockType)) {
        errors.push(`blocks[${i}].type: unknown type`);
      }
      if (typeof block["id"] !== "string" || block["id"].length === 0) {
        errors.push(`blocks[${i}].id: required`);
      }
    });
  }
  return errors.length === 0
    ? { ok: true, doc: input as SiteDocument }
    : { ok: false, errors };
}
