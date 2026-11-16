// Bandeja de mensajes del dueno (Fase 2).
//
// `/_f/lead` guardaba los mensajes de los visitantes y nadie podia leerlos: la
// tabla `leads` tenia politica RLS para el dueno desde `0008`, pero no habia ni
// una consulta que la usara. El criterio de aceptacion de la fase dice
// "formulario llega al panel", que es justo esto.

import type pg from "pg";
import { withUser } from "@webdesign/db";

export type LeadStatus = "new" | "read" | "replied" | "archived" | "spam";

const STATUSES: readonly LeadStatus[] = ["new", "read", "replied", "archived", "spam"];

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  type: string;
  status: LeadStatus;
  createdAt: string;
}

// Solo lo que el dueno necesita para responder. Fuera quedan `source_ip_hash`,
// `user_agent` y `spam_score`: son datos internos y no ayudan a contestar.
const COLUMNS = "id, name, email, phone, message, type, status, created_at";

function toRow(r: Record<string, unknown>): LeadRow {
  return {
    id: String(r["id"]),
    name: (r["name"] as string | null) ?? null,
    email: (r["email"] as string | null) ?? null,
    phone: (r["phone"] as string | null) ?? null,
    message: (r["message"] as string | null) ?? null,
    type: String(r["type"]),
    status: r["status"] as LeadStatus,
    createdAt: (r["created_at"] as Date).toISOString(),
  };
}

// Un mensaje sin consentimiento nunca se guarda (lead.ts sale antes del
// INSERT), asi que todo lo que hay aqui es material que el visitante autorizo.
export async function listLeads(pool: pg.Pool, userId: string, siteId: string, limit = 100): Promise<LeadRow[]> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query(
      `SELECT ${COLUMNS} FROM leads WHERE site_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [siteId, Math.min(Math.max(limit, 1), 500)],
    )).rows,
  );
  return rows.map(toRow);
}

// Cuantos sin leer, para poder avisar en el panel sin cargar la lista entera.
export async function countNewLeads(pool: pg.Pool, userId: string, siteId: string): Promise<number> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query<{ n: string }>("SELECT count(*) AS n FROM leads WHERE site_id = $1 AND status = 'new'", [siteId])).rows,
  );
  return Number(rows[0]?.n ?? 0);
}

// Cambiar el estado no puede tocar el mensaje ni el consentimiento: se marca
// como leido o archivado, y nada mas.
export async function setLeadStatus(
  pool: pg.Pool,
  userId: string,
  siteId: string,
  leadId: string,
  status: LeadStatus,
): Promise<boolean> {
  const rows = await withUser(pool, userId, async (tx) =>
    (await tx.query(
      "UPDATE leads SET status = $3 WHERE id = $1 AND site_id = $2 RETURNING id",
      [leadId, siteId, status],
    )).rows,
  );
  return rows.length > 0;
}
