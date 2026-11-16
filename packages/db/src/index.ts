import pg from "pg";

export type Tx = pg.PoolClient;

// Ejecuta `fn` dentro de una transacción con el usuario fijado para RLS.
export async function withUser<T>(pool: pg.Pool, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid userId");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export { migrate } from "./migrate.js";

// Aislamiento de pruebas: varios paquetes migran y borran tablas a la vez, así que
// cada uno usa su propia base. Se crea si no existe y se devuelve su URL.
export async function ensureTestDatabase(pool: pg.Pool, baseUrl: string, label: string): Promise<string> {
  const name = `wd_test_${label.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (exists.rowCount === 0) {
    // El nombre se compone aquí, no viene de fuera; aun así se cita.
    await pool.query(`CREATE DATABASE "${name}"`);
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

// Vista de operador (Fase 2). Abre la marca `app.operator_view` que las
// politicas de 0012 exigen, y solo para un usuario con rol `operator`: si el
// rol no esta, las consultas devuelven vacio en lugar de fallar con un error
// de RLS que el panel no sabria explicar.
export async function withOperator<T>(pool: pg.Pool, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("invalid userId");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.operator_view', 'on', true)");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
