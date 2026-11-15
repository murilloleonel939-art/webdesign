// Asignacion de hostname y enlace en /data/hosts (Fase 2, spec 5.3).
// Caddy no consulta la base: sirve /data/hosts/<hostname>. Si ese enlace no
// existe, el sitio publicado no se ve por mucho que la base diga `active`.

import { mkdirSync, symlinkSync, renameSync, existsSync, rmSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";

// Terminos que nunca se asignan como subdominio (spec 5.3). La tabla
// reserved_subdomains es la fuente, pero se comprueba tambien aqui para no
// depender de que la migracion haya cargado la lista.
const SENSITIVE = new Set([
  "banco", "bank", "pago", "pay", "paypal", "visa", "mastercard",
  "verificacion", "verification", "seguro", "secure", "gobierno", "government",
  "soporte", "oficial", "official", "app", "api", "www", "admin", "mail",
  "status", "support", "login", "smtp", "ftp", "ns1", "ns2", "cdn", "static",
  "img", "dev", "staging", "test",
]);

// Convierte el nombre del sitio en una etiqueta DNS valida: minusculas, sin
// acentos, sin guiones en los extremos y como mucho 63 caracteres.
export function slugifyLabel(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  // Un nombre solo de simbolos, o vacio, no da etiqueta utilizable.
  if (base.length < 2) return "";
  return /^[a-z]/.test(base) ? base : `s-${base}`.slice(0, 63);
}

export function isReserved(label: string): boolean {
  return SENSITIVE.has(label);
}

// Sufijo estable por sitio para que dos clientes con el mismo nombre no
// colisionen, derivado del id (no aleatorio: la misma cuenta reintenta igual).
export function labelFor(name: string, siteId: string): string {
  const slug = slugifyLabel(name) || "sitio";
  const suffix = siteId.replace(/-/g, "").slice(0, 6);
  return `${slug}-${suffix}`.slice(0, 63);
}

// Enlaza el hostname al sitio. Se escribe con symlink temporal + rename para
// que Caddy nunca vea un enlace a medio crear.
export function linkHost(hostsRoot: string, hostname: string, sitesRoot: string, siteId: string): void {
  mkdirSync(hostsRoot, { recursive: true });
  const target = join(sitesRoot, siteId, "public");
  const link = join(hostsRoot, hostname.toLowerCase());
  const tmp = `${link}.tmp-${process.pid}-${Date.now()}`;
  // Si ya apunta al sitio correcto no se toca: evita parpadeos al republicar.
  try {
    if (readlinkSync(link) === target) return;
  } catch {
    // No existe o no es un enlace: se reemplaza abajo.
  }
  try {
    rmSync(tmp, { force: true });
    symlinkSync(target, tmp, "dir");
    renameSync(tmp, link);
  } catch {
    rmSync(tmp, { force: true });
    throw new Error(`no se pudo enlazar ${hostname}`);
  }
}

export function unlinkHost(hostsRoot: string, hostname: string): void {
  rmSync(join(hostsRoot, hostname.toLowerCase()), { force: true });
}

export interface HostRow {
  hostname: string;
  poolDomain: string;
}

// Devuelve el hostname activo del sitio, asignando uno del pool si no tiene.
// Devuelve undefined si no queda sitio en el pool: publicar no falla por eso,
// pero el sitio no se sirve, y quien llama debe decirlo.
export async function ensureHostname(
  pool: pg.Pool,
  opts: { siteId: string; siteName: string; hostnameFor?: (label: string, domain: string) => string },
): Promise<HostRow | undefined> {
  const existing = await pool.query<{ hostname: string }>(
    `SELECT hostname FROM domains WHERE site_id = $1 AND kind = 'pool' AND status = 'active' LIMIT 1`,
    [opts.siteId],
  );
  const current = existing.rows[0]?.hostname;
  if (current) return { hostname: current, poolDomain: current.split(".").slice(1).join(".") };

  // Zona con hueco, la mas vacia primero para repartir.
  const zone = await pool.query<{ id: string; domain: string }>(
    `SELECT id, domain FROM site_domain_pool
     WHERE status = 'active' AND used < capacity
     ORDER BY used ASC LIMIT 1`,
  );
  const row = zone.rows[0];
  if (!row) return undefined;

  const label = labelFor(opts.siteName, opts.siteId);
  const hostname = opts.hostnameFor ? opts.hostnameFor(label, row.domain) : `${label}.${row.domain}`;

  await pool.query(
    `INSERT INTO domains (id, site_id, hostname, kind, status, verified_at)
     VALUES (gen_random_uuid(), $1, $2, 'pool', 'active', now())`,
    [opts.siteId, hostname],
  );
  await pool.query(`UPDATE site_domain_pool SET used = used + 1 WHERE id = $1`, [row.id]);
  return { hostname, poolDomain: row.domain };
}
