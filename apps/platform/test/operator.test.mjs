import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRole, isOperator, listAllSites } from "../dist/operator.js";

const MARCA = "11111111-1111-4111-8111-111111111111";

function fakePool(rows = []) {
  const seen = [];
  const pool = {
    connect: async () => ({
      query: async (sql, params) => { seen.push({ sql, params }); return { rows }; },
      release() {},
    }),
  };
  return { pool, seen, sql: () => seen.map((q) => q.sql).join("\n") };
}

test("solo los dos roles de la tabla son validos", () => {
  assert.equal(isRole("owner"), true);
  assert.equal(isRole("operator"), true);
  // `admin` no existe en el CHECK de `users`: aceptarlo dejaria pasar un rol
  // que la base rechaza.
  for (const r of ["admin", "root", "", null, undefined, 1]) assert.equal(isRole(r), false, String(r));
});

test("el rol se lee de la propia fila del usuario", async () => {
  const f = fakePool([{ role: "operator" }]);
  assert.equal(await isOperator(f.pool, MARCA), true);
  // Sin fila no se asume nada: el que no consta no es operador.
  assert.equal(await isOperator(fakePool([]).pool, MARCA), false);
  assert.equal(await isOperator(fakePool([{ role: "owner" }]).pool, MARCA), false);
});

test("la vista de operador abre la marca de transaccion", async () => {
  // Sin `app.operator_view` las politicas de 0012 no dejan ver nada, asi que si
  // este SET desaparece el panel se queda vacio sin decir por que.
  const f = fakePool([]);
  await listAllSites(f.pool, MARCA);
  assert.match(f.sql(), /set_config\('app\.operator_view', 'on', true\)/);
  assert.match(f.sql(), /set_config\('app\.user_id'/);
});

test("la migracion exige el rol, no solo la marca", () => {
  // La marca sola no basta: si alguien la pusiera desde una conexion suya, el
  // EXISTS sobre `users.role` lo sigue parando.
  const sql = readFileSync(new URL("../../../packages/db/migrations/0012_operator_view.sql", import.meta.url), "utf8");
  assert.match(sql, /u\.role = 'operator'/);
  // Y es solo lectura: un operador que pueda escribir es un dueno encubierto.
  assert.equal(/FOR (INSERT|UPDATE|DELETE)/.test(sql), false);
  assert.equal(/FOR SELECT/.test(sql), true);
});

test("el operador no puede ver los mensajes de los formularios", () => {
  // Los leads son datos personales de terceros: 0012 no abre `leads` y no debe
  // hacerlo nunca.
  const sql = readFileSync(new URL("../../../packages/db/migrations/0012_operator_view.sql", import.meta.url), "utf8");
  assert.equal(/\bleads\b/.test(sql), false);
});

test("la migracion abre users, o el JOIN deja el panel vacio", () => {
  // `users_self` solo deja ver la propia fila. Sin una politica de operador
  // sobre `users`, el JOIN para saber de quien es cada sitio no encuentra nada
  // y la tabla sale vacia sin ningun error: el fallo mas dificil de ver.
  const sql = readFileSync(new URL("../../../packages/db/migrations/0012_operator_view.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE POLICY users_operator_view ON users/);
});

test("la funcion de rol no puede recursionar sobre su propia politica", () => {
  // Se llama desde la politica de `users` y lee `users`: sin SECURITY DEFINER
  // Postgres aborta con "infinite recursion detected in policy for relation users"
  // y el panel entero deja de cargar.
  const sql = readFileSync(new URL("../../../packages/db/migrations/0012_operator_view.sql", import.meta.url), "utf8");
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
});

test("la funcion SECURITY DEFINER no queda abierta a cualquiera", () => {
  // Postgres da EXECUTE a PUBLIC por defecto: en una funcion SECURITY DEFINER
  // eso deja que cualquier rol la invoque como superusuario.
  const sql = readFileSync(new URL("../../../packages/db/migrations/0012_operator_view.sql", import.meta.url), "utf8");
  assert.match(sql, /REVOKE ALL ON FUNCTION app_is_operator\(\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION app_is_operator\(\) TO app_platform/);
});
