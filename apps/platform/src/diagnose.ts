// Diagnostico de base de datos, de solo lectura y protegido por token.
//
// Existe para responder una pregunta que de otro modo exige entrar al
// contenedor: la base de datos responde, que migraciones estan aplicadas y
// que datos hay. Nunca devuelve datos personales (emails, telefonos,
// nombres): solo recuentos y estados.
//
// Se activa solo si DIAGNOSTIC_TOKEN esta definido y tiene al menos 16
// caracteres. Sin esa variable el endpoint no existe, asi que no amplia la
// superficie en produccion.

import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export interface DiagnosticReport {
  ok: boolean;
  database: { reachable: boolean; version?: string | undefined; role?: string | undefined; error?: string | undefined };
  migrations: { applied: number; files: string[]; missing: string[]; note?: string | undefined };
  // Filas reales cuando RLS las oculta al rol de la app.
  rlsHidden?: Record<string, number>;
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

// Longitud minima aceptada para el token. Un secreto mas corto no protege
// nada y se trata como no configurado: la ruta no existe.
const MIN_TOKEN_LENGTH = 16;

// Token configurado y utilizable. Devuelve la cadena solo si vale; si no,
// undefined (nunca null: el tipo no admite basura).
function configuredToken(): string | undefined {
  const expected = process.env.DIAGNOSTIC_TOKEN;
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return undefined;
  return expected;
}

export function diagnosticsEnabled(): boolean {
  // Sin token valido no hay endpoint: la peticion cae en el 404 normal y no
  // se revela que la ruta exista.
  return configuredToken() !== undefined;
}

export function tokenMatches(presented: string | null): boolean {
  const expected = configuredToken();
  // Sin token configurado no hay comparacion posible: se cierra, no se abre.
  if (expected === undefined || !presented) return false;
  // Comparacion de longitud constante: el token no se filtra por tiempos.
  // timingSafeEqual exige buffers del mismo tamano, asi que la longitud se
  // comprueba antes.
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

  report.rlsHidden = {};

  try {
    const v = await pool.query<{ version: string; role: string }>(
      "SELECT version(), current_user AS role",
    );
    report.database.reachable = true;
    report.database.version = v.rows[0]?.version.split(" ").slice(0, 2).join(" ");
    report.database.role = v.rows[0]?.role;
  } catch (e) {
    // El cliente recibe un codigo fijo, nunca el mensaje del driver: puede
    // llevar host, usuario o SQL. El detalle real va al log del servidor.
    report.database.error = "db_unreachable";
    console.error("diagnose", { step: "database", code: "db_unreachable", error: e });
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
    // Falta de permiso no es falta de migracion. Se distingue para no dar un
    // falso negativo: el rol de la app no puede leer schema_migrations. El
    // mensaje del error se queda en el log: al cliente le llega un codigo.
    report.migrations.note = "migrations_unreadable";
    console.error("diagnose", { step: "migrations", code: "migrations_unreadable", error: e });
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

  // Con RLS forzada y sin app.user_id, count(*) devuelve 0 aunque haya filas.
  // pg_stat_user_tables da el dato real. Se anota la diferencia para no
  // confundir "vacio" con "oculto por RLS".
  const realRows = new Map(report.tables.map((t) => [t.name, t.rows]));
  for (const [table, value] of Object.entries(report.counts)) {
    const real = realRows.get(table);
    if (value === 0 && typeof real === "number" && real > 0) {
      report.rlsHidden[table] = real;
    }
  }

  try {
    const { readdir } = await import("node:fs/promises");
    report.storage.sitesOnDisk = await readdir(sitesRoot);
  } catch (e) {
    report.storage.error = "storage_unreadable";
    console.error("diagnose", { step: "storage", code: "storage_unreadable", error: e });
  }

  // Solo se declara sano si conecta y no falta ninguna migracion esperada.
  // Sin permiso para leer schema_migrations no se puede afirmar que falten:
  // se declara sano si la base responde y las tablas esperadas existen.
  const migrationsUnknown = Boolean(report.migrations.note);
  report.ok = report.database.reachable
    && (migrationsUnknown ? report.tables.some((t) => t.name === "sites") : report.migrations.missing.length === 0);
  return report;
}
