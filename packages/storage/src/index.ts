import { randomUUID } from "node:crypto";
import { safeJoin } from "@webdesign/security";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertSiteId(siteId: string): string {
  if (!UUID.test(siteId)) throw new Error("invalid siteId: must be a UUID");
  return siteId;
}

// Ruta de una versión publicada dentro de /data/sites/<siteId>.
export function releaseDir(sitesRoot: string, siteId: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error("invalid version");
  return safeJoin(sitesRoot, `${assertSiteId(siteId)}/releases/v${version}`);
}

// Nombre físico de un asset: siempre generado, nunca el nombre del usuario.
export function assetFileName(ext: "png" | "jpg" | "webp" | "mp4"): string {
  return `${randomUUID()}.${ext}`;
}
