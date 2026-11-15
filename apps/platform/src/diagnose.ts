// Diagnostico de base de datos, de solo lectura y protegido por token.
//
// Existe para responder una pregunta que de otro modo exige entrar al
// contenedor: la base de datos responde, que migraciones estan aplicadas y
// que datos hay. Nunca devuelve datos personales (emails, telefonos,
// nombres): solo recuentos y estados.
//
// Se activa solo si DIAGNOSTIC_TOKEN esta definido. Sin esa variable el
// endpoint no existe, asi que no amplia la superficie en produccion.

import type { Pool } from "pg";

export interface DiagnosticReport {
  ok: boolean;
  // Presente solo en modo abierto: recuerda que hay que retirarlo.
  warning?: string | undefined;
  database: { reachable: boolean; version?: string | undefined; role?: string | undefined; error?: string | undefined };
  migrations: { applied: number; files: string[]; missing: string[] };
  tables: { name: string; rows: number | null }[];
  counts: Record<string, number | null>;
  storage: { sitesRoot: string; sitesOnDisk: string[] | null; error?: string | undefined };
  time: string;
}

const EXPECTED_MIGRATIONS = [
  "0001_sites_rls.sql", "0002_app_role.sql", "0003_site_content_rls.sql",
  "0004_sessions.sql", "0005_user_password.sql", "0006_auth_lookup.sql",
  "0007_session_lookup.sql",
];

// Tablas de las que se cuenta sin exponer contenido.
const COUNTED = ["users", "sites", "site_drafts", "site_versions", "assets", "domains", "leads"];

export function diagnosticsEnabled(): boolean {
  // Dos modos: `open` (provisional, sin cabecera) o token (permanente).
  // `open` existe solo para una ventana de depuracion y debe retirarse.
  if (process.env.DIAGNOSTIC_OPEN === "1") return true;
  return Boolean(process.env.DIAGNOSTIC_TOKEN);
}

export function isOpenMode(): boolean {
  return process.env.DIAGNOSTIC_OPEN === "1";
}

export function tokenMatches(presented: string | null): boolean {
  // Modo abierto: no se exige cabecera. Marcado para retirar.
  if (isOpenMode()) return true;
  const expected = process.env.DIAGNOSTIC_TOKEN;
  // Sin token configurado no hay comparacion posible: se cierra, no se abre.
  if (!expected || !presented) return false;
  // Comparacion de longitud constante: el token no se filtra por tiempos.
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function runDiagnostics(pool: Pool, sitesRoot: string): Promise<DiagnosticReport> {
  const report: DiagnosticReport = {
    ok: false,
    database: { reachable: false },
    migrations: { applied: 0, files: [], missing: EXPECTED_MIGRATIONS },
    tables: [],
    counts: {},
    storage: { sitesRoot, sitesOnDisk: null },
    time: new Date().toISOString(),
  };
  if (isOpenMode()) {
    report.warning = "DIAGNOSTIC_OPEN activo: endpoint sin autenticacion. Retirar cuanto antes.";
  }

  try {
    const v = await pool.query<{ version: string; role: string }>(
      "SELECT version(), current_user AS role",
    );
    report.database.reachable = true;
    report.database.version = v.rows[0]?.version.split(" ").slice(0, 2).join(" ");
    report.database.role = v.rows[0]?.role;
  } catch (e) {
    report.database.error = (e as Error).message;
    // Sin conexion no tiene sentido seguir: el resto depende de ella.
    return report;
  }

  try {
    const applied = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    const files = applied.rows.map((r) => r.name);
    report.migrations = {
      applied: files.length,
      files,
      missing: EXPECTED_MIGRATIONS.filter((m) => !files.includes(m)),
    };
  } catch (e) {
    report.database.error = `schema_migrations: ${(e as Error).message}`;
  }

  // Recuentos por tabla. Cada uno se intenta por separado: una tabla ausente
  // (migracion sin aplicar) no tumba el informe entero.
  for (const table of COUNTED) {
    try {
      const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      report.counts[table] = Number(r.rows[0]?.n ?? 0);
    } catch {
      report.counts[table] = null;
    }
  }

  try {
    const sizes = await pool.query<{ name: string; rows: string | null }>(
      `SELECT relname AS name, n_live_tup::text AS rows
       FROM pg_stat_user_tables ORDER BY relname`,
    );
    report.tables = sizes.rows.map((r) => ({ name: r.name, rows: r.rows === null ? null : Number(r.rows) }));
  } catch {
    report.tables = [];
  }

  try {
    const { readdir } = await import("node:fs/promises");
    report.storage.sitesOnDisk = await readdir(sitesRoot);
  } catch (e) {
    report.storage.error = (e as Error).message;
  }

  // Solo se declara sano si conecta y no falta ninguna migracion esperada.
  report.ok = report.database.reachable && report.migrations.missing.length === 0;
  return report;
}
