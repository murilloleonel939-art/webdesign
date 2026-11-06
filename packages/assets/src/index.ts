import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Pool } from "pg";
import { withUser } from "@webdesign/db";
import { assertSiteId } from "@webdesign/storage";

// Almacen de assets (spec 7.2 y 14.1). Los nombres de fichero son ids generados:
// nunca se usa un nombre escrito por el usuario como ruta (spec 7.4).
// Cada asset registra su licencia; sin licencia no se puede publicar (6.4).

export const LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  videoBytes: 8 * 1024 * 1024,
  siteTotalBytes: 200 * 1024 * 1024,
  pageBytes: 20 * 1024 * 1024,
} as const;

export type AssetKind = "image" | "video" | "poster";

// Tipos aceptados. Nada de SVG subido por el usuario: puede llevar script.
const MIME_BY_KIND: Record<AssetKind, { mime: string; ext: string }[]> = {
  image: [
    { mime: "image/jpeg", ext: "jpg" },
    { mime: "image/png", ext: "png" },
    { mime: "image/webp", ext: "webp" },
    { mime: "image/avif", ext: "avif" },
  ],
  video: [
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm", ext: "webm" },
  ],
  poster: [
    { mime: "image/jpeg", ext: "jpg" },
    { mime: "image/webp", ext: "webp" },
  ],
};

export type UploadRejection =
  | "mime_not_allowed"
  | "too_large"
  | "site_quota_exceeded"
  | "empty";

export function checkUpload(kind: AssetKind, mime: string, bytes: number): UploadRejection | undefined {
  if (bytes <= 0) return "empty";
  const allowed = MIME_BY_KIND[kind].find((m) => m.mime === mime);
  if (!allowed) return "mime_not_allowed";
  const max = kind === "video" ? LIMITS.videoBytes : LIMITS.imageBytes;
  if (bytes > max) return "too_large";
  return undefined;
}

export function extensionFor(kind: AssetKind, mime: string): string {
  return MIME_BY_KIND[kind].find((m) => m.mime === mime)?.ext ?? "bin";
}

// Detecta el tipo real por los primeros bytes: la cabecera del cliente se falsifica.
export function sniffMime(head: Uint8Array): string | undefined {
  const b = head;
  const ascii = (from: number, to: number) => Buffer.from(b.subarray(from, to)).toString("latin1");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("avi")) return "image/avif";
    if (/^(isom|mp42|iso2|avc1|mp41)/.test(brand)) return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return undefined;
}

// Ruta relativa con hash de contenido: permite cache larga y no colisiona.
export function assetRelativePath(assetId: string, kind: AssetKind, ext: string, content: Uint8Array): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `${kind}/${assetId}-${hash}.${ext}`;
}

export interface RegisterAssetOptions {
  userId: string;
  siteId: string;
  kind: AssetKind;
  // Solo informativo: el tipo real se detecta del contenido.
  declaredMime?: string | undefined;
  content: Uint8Array;
  // Obligatorio para material de terceros: sin licencia no se publica.
  license?: string | undefined;
  author?: string | undefined;
  sourceUrl?: string | undefined;
  creditText?: string | undefined;
  source: "own" | "generated" | "open-collection";
  sitesRoot: string;
}

export type RegisterResult =
  | { ok: true; id: string; path: string; bytes: number }
  | { ok: false; reason: UploadRejection };

export async function registerAsset(pool: Pool, opts: RegisterAssetOptions): Promise<RegisterResult> {
  assertSiteId(opts.siteId);
  const bytes = opts.content.byteLength;
  const sniffed = sniffMime(opts.content.subarray(0, 16));
  // Sin tipo detectado no hay asset: caer al `mime` declarado dejaria entrar
  // cualquier cosa (un SVG con cabecera "image/jpeg" pasaria).
  if (!sniffed) return { ok: false, reason: "mime_not_allowed" };
  const rejection = checkUpload(opts.kind, sniffed, bytes);
  if (rejection) return { ok: false, reason: rejection };
  const mime = sniffed;

  const id = randomUUID();
  const rel = assetRelativePath(id, opts.kind, extensionFor(opts.kind, mime), opts.content);
  // Solo se acepta ruta bajo /data/sites/<siteId>/assets.
  const abs = join(opts.sitesRoot, opts.siteId, "assets", rel);
  await mkdir(dirname(abs), { recursive: true });
  // Escritura atomica: un fallo a medias no deja un asset corrupto publicado.
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, opts.content);
  await rename(tmp, abs);

  try {
    await withUser(pool, opts.userId, async (tx) => {
      // Cuota por sitio calculada al subir (spec 7.4).
      const used = await tx.query<{ total: string }>("SELECT COALESCE(SUM(bytes), 0) AS total FROM assets WHERE site_id = $1", [opts.siteId]);
      const total = Number(used.rows[0]?.total ?? 0);
      if (total + bytes > LIMITS.siteTotalBytes) throw new AssetError("site_quota_exceeded");
      await tx.query(
        `INSERT INTO assets (id, site_id, path, kind, bytes, mime, source, license, author, source_url, credit_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, opts.siteId, rel, opts.kind, bytes, mime, opts.source,
         opts.license ?? null, opts.author ?? null, opts.sourceUrl ?? null, opts.creditText ?? null],
      );
    });
  } catch (e) {
    if (e instanceof AssetError) return { ok: false, reason: e.reason };
    throw e;
  }
  return { ok: true, id, path: rel, bytes };
}

class AssetError extends Error {
  constructor(readonly reason: UploadRejection) {
    super(reason);
  }
}

// Resolver para el renderer: id de asset -> ruta publica. Sin rutas en el documento.
export async function assetResolver(pool: Pool, userId: string, siteId: string): Promise<(assetId: string) => { src: string; alt: string } | undefined> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query<{ id: string; path: string }>(
      "SELECT id, path FROM assets WHERE site_id = $1 AND takedown_status = 'active'",
      [siteId],
    )).rows,
  );
  const byId = new Map(rows.map((r) => [r.id, r.path]));
  return (assetId) => {
    const path = byId.get(assetId);
    return path ? { src: `/assets/${path}`, alt: "" } : undefined;
  };
}

export async function licensedAssetIds(pool: Pool, userId: string, siteId: string): Promise<string[]> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query<{ id: string }>("SELECT id FROM assets WHERE site_id = $1 AND license IS NOT NULL", [siteId])).rows,
  );
  return rows.map((r) => r.id);
}

// Retirada por reclamacion: el asset deja de servirse sin borrar la evidencia.
export async function withdrawAsset(pool: Pool, userId: string, siteId: string, assetId: string): Promise<void> {
  await withUser(pool, userId, async (tx) => {
    await tx.query(
      "UPDATE assets SET takedown_status = 'withdrawn_by_claim' WHERE id = $1 AND site_id = $2",
      [assetId, siteId],
    );
  });
}
