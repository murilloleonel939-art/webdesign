import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, lstatSync, readlinkSync, symlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { releaseDir, assertSiteId } from "@webdesign/storage";

// Estructura (spec 6):
//   /data/sites/<siteId>/releases/v<N>/
//   /data/sites/<siteId>/public -> releases/v<N>
// Publicar una versión nueva crea v<N>; revertir solo cambia el symlink.

function siteRoot(sitesRoot: string, siteId: string): string {
  return join(sitesRoot, assertSiteId(siteId));
}

export function currentVersion(sitesRoot: string, siteId: string): number {
  const link = join(siteRoot(sitesRoot, siteId), "public");
  if (!existsSync(link)) return 0;
  const target = readlinkSync(link); // "releases/v3"
  const m = /^releases\/v(\d+)$/.exec(target);
  if (!m) throw new Error(`public symlink points outside releases: ${target}`);
  return Number(m[1]);
}

export function listVersions(sitesRoot: string, siteId: string): number[] {
  const dir = join(siteRoot(sitesRoot, siteId), "releases");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => /^v(\d+)$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

// Escribe una release nueva y la activa. Devuelve el número de versión.
export function publishRelease(sitesRoot: string, siteId: string, files: Record<string, string>): number {
  const versions = listVersions(sitesRoot, siteId);
  const version = (versions.at(-1) ?? 0) + 1;
  const dir = releaseDir(sitesRoot, siteId, version);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (name.includes("/") || name.includes("..")) throw new Error(`invalid asset name: ${name}`);
    writeFileSync(join(dir, name), content, "utf8");
  }
  switchRelease(sitesRoot, siteId, version);
  return version;
}

// Cambia `public` de forma atómica: symlink temporal + rename.
export function switchRelease(sitesRoot: string, siteId: string, version: number): void {
  const root = siteRoot(sitesRoot, siteId);
  if (!listVersions(sitesRoot, siteId).includes(version)) {
    throw new Error(`version v${version} does not exist`);
  }
  const tmp = join(root, `.public.tmp-${process.pid}-${Date.now()}`);
  symlinkSync(`releases/v${version}`, tmp, "dir");
  renameSync(tmp, join(root, "public"));
}

export function rollback(sitesRoot: string, siteId: string): number {
  const versions = listVersions(sitesRoot, siteId);
  if (versions.length < 2) throw new Error("no previous release to roll back to");
  const previous = versions.at(-2)!;
  switchRelease(sitesRoot, siteId, previous);
  return previous;
}

// Borra una release que no esté activa.
export function deleteRelease(sitesRoot: string, siteId: string, version: number): void {
  if (currentVersion(sitesRoot, siteId) === version) throw new Error("cannot delete the active release");
  const dir = releaseDir(sitesRoot, siteId, version);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return;
  rmSync(dir, { recursive: true, force: true });
}
