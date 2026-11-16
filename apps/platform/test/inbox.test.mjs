import { test } from "node:test";
import assert from "node:assert/strict";
import { isLeadStatus, listLeads, countNewLeads, setLeadStatus } from "../dist/inbox.js";

// Un pool falso que registra TODAS las consultas: `withUser` mete sus propias
// sentencias (BEGIN, SET LOCAL, COMMIT) y quedarse con la ultima daria `COMMIT`.
function fakePool(rows = []) {
  const seen = [];
  const pool = {
    connect: async () => ({
      query: async (sql, params) => { seen.push({ sql, params }); return { rows }; },
      release() {},
    }),
  };
  return { pool, seen, sql: () => seen.map((q) => q.sql).join("\n"), params: (i) => seen[i]?.params };
}

test("solo se aceptan los estados que existen en la tabla", () => {
  for (const s of ["new", "read", "replied", "archived", "spam"]) assert.equal(isLeadStatus(s), true, s);
  // Lo que no esta en el CHECK de `leads` no puede llegar al UPDATE.
  for (const s of ["borrado", "", null, undefined, 3, "NEW"]) assert.equal(isLeadStatus(s), false, String(s));
});

test("la bandeja no devuelve datos internos del visitante", async () => {
  // `source_ip_hash`, `user_agent` y `spam_score` no ayudan a responder y no
  // deben salir del servidor.
  const f = fakePool([]);
  await listLeads(f.pool, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333");
  assert.equal(/source_ip_hash|user_agent|spam_score/.test(f.sql()), false);
  assert.match(f.sql(), /ORDER BY created_at DESC/);
});

test("el limite de la lista queda acotado", async () => {
  // Sin tope, un sitio con miles de mensajes devolveria todo de golpe.
  const a = fakePool([]);
  await listLeads(a.pool, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", 5000);
  assert.equal(a.seen.find((q) => /FROM leads/.test(q.sql)).params[1], 500);
  const b = fakePool([]);
  await listLeads(b.pool, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", -3);
  assert.equal(b.seen.find((q) => /FROM leads/.test(q.sql)).params[1], 1);
});

test("marcar un mensaje comprueba que sea de ese sitio", async () => {
  // El UPDATE lleva site_id en el WHERE: marcar un id de otra cuenta no cambia
  // nada y el endpoint responde 404.
  const f = fakePool([]);
  const ok = await setLeadStatus(f.pool, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "read");
  assert.equal(ok, false, "sin fila afectada no se da por hecho");
  assert.match(f.sql(), /WHERE id = \$1 AND site_id = \$2/);
  assert.equal(f.seen.find((q) => /UPDATE leads/.test(q.sql)).params[2], "read");
});

test("cuenta los mensajes sin leer", async () => {
  const f = fakePool([{ n: "7" }]);
  assert.equal(await countNewLeads(f.pool, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"), 7);
});
