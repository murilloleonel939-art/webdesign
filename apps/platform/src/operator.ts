// Panel de operador (Fase 2): clientes y estado de los sitios.
//
// Es el segundo panel que pide la fase. Solo lectura: el operador atiende
// incidencias, no edita el contenido de nadie. Las politicas de 0012 abren la
// lectura y `withOperator` pone la marca que exigen.

import type pg from "pg";
import { withUser, withOperator } from "@webdesign/db";

export type Role = "owner" | "operator";

export function isRole(v: unknown): v is Role {
  return v === "owner" || v === "operator";
}

export interface OperatorSite {
  id: string;
  name: string;
  ownerEmail: string;
  status: string;
  hostname: string | null;
  updatedAt: string;
  pages: number;
}

export interface OperatorSummary {
  accounts: number;
  sites: number;
  published: number;
}

export async function isOperator(pool: pg.Pool, userId: string): Promise<boolean> {
  // `users_self` deja ver la propia fila, asi que no hace falta ninguna marca.
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [userId])).rows,
  );
  return rows[0]?.role === "operator";
}

// Un sitio publicado tiene version activa; uno en borrador no. Se deriva del
// ultimo release en vez de un contador guardado, que se desincronizaria.
export async function listAllSites(pool: pg.Pool, operatorId: string): Promise<OperatorSite[]> {
  const rows = await withOperator(pool, operatorId, async (tx) =>
    (await tx.query(
      `SELECT s.id, s.name, s.status, s.updated_at,
              u.email AS owner_email,
              (SELECT count(*) FROM site_versions v WHERE v.site_id = s.id) AS pages,
              d.hostname
       FROM sites s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN domains d ON d.site_id = s.id AND d.status = 'active'
       ORDER BY s.updated_at DESC`,
    )).rows,
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    ownerEmail: String(r["owner_email"]),
    status: String(r["status"]),
    hostname: (r["hostname"] as string | null) ?? null,
    updatedAt: (r["updated_at"] as Date).toISOString(),
    pages: Number(r["pages"] ?? 0),
  }));
}

export async function summary(pool: pg.Pool, operatorId: string): Promise<OperatorSummary> {
  const rows = await withOperator(pool, operatorId, async (tx) =>
    (await tx.query<{ accounts: string; sites: string; published: string }>(
      `SELECT (SELECT count(*) FROM users) AS accounts,
              (SELECT count(*) FROM sites) AS sites,
              (SELECT count(*) FROM sites WHERE status = 'active') AS published`,
    )).rows,
  );
  const r = rows[0];
  return {
    accounts: Number(r?.accounts ?? 0),
    sites: Number(r?.sites ?? 0),
    published: Number(r?.published ?? 0),
  };
}
