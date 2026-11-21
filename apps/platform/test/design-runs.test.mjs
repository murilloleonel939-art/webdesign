import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../dist/server.js";
import { FAST_BUDGET, designAgent } from "@webdesign/agent-design";

// Ruta de diseño con IA (spec 9.1, punto A del encargo).
//
// Sin Postgres ni Redis: lo que se fija aqui es la PUERTA, no el agente.
//   1. sin sesion no se encola nada (401);
//   2. un sitio ajeno no se distingue de uno inexistente (404, no 403);
//   3. un brief que no vale se rechaza antes de crear la ejecucion (400);
//   4. sin Redis la respuesta es 503 controlada, no un proceso muerto;
//   5. el tope de tokens del run es el del agente rapido, no un numero suelto.
//
// `createApp` con un pool falso permite llegar hasta el INSERT y comprobar que
// lo que se escribe es lo que dice la especificacion (9.1 y 14.1).

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const COOKIE = "sid=token-de-prueba";

/**
 * Pool falso: `resolveSession` consulta `auth_lookup_session` con el pool
 * directo y el resto va por `withUser`. Se contestan las dos cosas y se anota
 * cada sentencia para poder afirmar sobre el INSERT.
 */
function fakePool({ owns = true, run = undefined, session = true, draftRev = 0, checkpoint = undefined, latest = undefined } = {}) {
  const seen = [];
  const client = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM sites WHERE id = \$1/.test(sql)) return { rows: owns ? [{ "?column?": 1 }] : [] };
      // `latest` va antes: su WHERE no lleva `id = $1`, pero se comprueba por
      // el texto completo para no depender del orden de las reglas.
      if (/FROM agent_runs\s+WHERE site_id = \$1 AND user_id = \$2/.test(sql)) return { rows: latest ? [latest] : [] };
      if (/FROM agent_runs WHERE id = \$1/.test(sql)) return { rows: run ? [run] : [] };
      if (/FROM draft_checkpoints/.test(sql)) return { rows: checkpoint ? [checkpoint] : [] };
      // `saveDraft` lee la revision actual con candado de fila.
      if (/SELECT rev FROM site_drafts/.test(sql)) return { rows: draftRev > 0 ? [{ rev: draftRev }] : [] };
      // `loadDraft` trae revision y documento.
      if (/SELECT rev, doc FROM site_drafts/.test(sql)) {
        return { rows: draftRev > 0 ? [{ rev: draftRev, doc: { schemaVersion: 1 } }] : [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/auth_lookup_session/.test(sql)) return { rows: session ? [{ id: "s1", user_id: USER }] : [] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  return { pool, seen, sql: () => seen.map((q) => q.sql).join("\n"), find: (re) => seen.find((q) => re.test(q.sql)) };
}

/** Servidor real sobre un pool falso: se prueba la puerta HTTP de verdad. */
function start(pool) {
  return new Promise((resolve) => {
    const server = createApp({ pool }).listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1", port, path, method,
        headers: {
          host: "panel.example.com",
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          cookie: COOKIE,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const withServer = async (poolOpts, fn) => {
  const fake = fakePool(poolOpts);
  const { server, port } = await start(fake.pool);
  try {
    await fn({ port, fake });
  } finally {
    server.close();
  }
};

test("P01 sin sesion no se encola nada: 401 y ni un INSERT", async () => {
  await withServer({ session: false }, async ({ port, fake }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs`, { name: "Café Aurora" });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: "unauthorized" });
    assert.equal(/INSERT INTO agent_runs/.test(fake.sql()), false);
  });
});

test("P02 un sitio ajeno responde 404, igual que uno que no existe", async () => {
  // Sin fila en `sites` para este usuario, RLS no la devuelve. Un 403 diria
  // "existe pero no es tuyo", que es justo lo que no hay que contar.
  await withServer({ owns: false }, async ({ port, fake }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs`, { name: "Café Aurora" });
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: "not_found" });
    assert.equal(/INSERT INTO agent_runs/.test(fake.sql()), false);
  });
});

test("P03 un brief vacio no vale: 400 antes de crear la ejecucion", async () => {
  // `quickBriefSchema` admite los cinco campos opcionales, pero el agente no
  // puede escribir nada sin un solo dato: el brief con todo vacio se rechaza
  // aqui y no llega a gastar una ejecucion.
  await withServer({}, async ({ port, fake }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs`, {});
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "invalid_brief" });
    assert.equal(/INSERT INTO agent_runs/.test(fake.sql()), false);
  });
});

test("P04 un dato demasiado largo tampoco pasa", async () => {
  await withServer({}, async ({ port }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs`, { name: "x".repeat(200) });
    assert.equal(r.status, 400);
  });
});

test("P05 sin Redis: 503 controlado, ejecucion cerrada y token revocado", async () => {
  const saved = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    await withServer({}, async ({ port, fake }) => {
      const r = await call(port, "POST", `/api/sites/${SITE}/design-runs`, { name: "Café Aurora" });
      // Lo que importa: hay respuesta y el proceso sigue vivo. Un rechazo sin
      // capturar aqui tumbaba el servidor y el proxy devolvia 502.
      assert.equal(r.status, 503);
      assert.deepEqual(r.json, { error: "agent_unavailable" });
      assert.match(fake.sql(), /UPDATE agent_runs SET status = 'error'/);
      assert.match(fake.sql(), /UPDATE agent_tokens SET revoked_at = now\(\)/);
    });
  } finally {
    if (saved !== undefined) process.env.REDIS_URL = saved;
  }
});

test("P06 el run se crea con el agente y el tope de tokens reales", async () => {
  delete process.env.REDIS_URL;
  try {
    await withServer({}, async ({ port, fake }) => {
      await call(port, "POST", `/api/sites/${SITE}/design-runs`, {
        businessType: "cafetería", name: "Café Aurora", city: "Valencia",
      });
      const insert = fake.find(/INSERT INTO agent_runs/);
      assert.ok(insert, "no se creo la ejecucion");
      // 9.1: el `agent_id` es el del agente que corre, no un alias suelto.
      assert.equal(insert.params[1], designAgent.id);
      // 14.1: el tope queda fijado al arrancar y sale del presupuesto rapido.
      assert.equal(insert.params[5], FAST_BUDGET.maxTokens);
      assert.equal(insert.params[2], USER);
      assert.equal(insert.params[3], SITE);
      // El token se emite con el scope del gateway y el de escritura del sitio:
      // la ruta de fotos registra los assets con `site:write`. Acotado a este sitio.
      const token = fake.find(/INSERT INTO agent_tokens/);
      assert.ok(token);
      assert.deepEqual(token.params[2], ["llm:complete", "site:write"]);
      assert.equal(token.params[3], SITE);
    });
  } finally {
    if (process.env.REDIS_URL !== undefined) delete process.env.REDIS_URL;
  }
});

test("P07 el estado solo se devuelve a su dueno, y solo estado y motivo", async () => {
  await withServer({ run: { status: "ok", stop_reason: "Diseno aplicado" } }, async ({ port, fake }) => {
    const r = await call(port, "GET", `/api/sites/${SITE}/design-runs/${RUN}`);
    assert.equal(r.status, 200);
    // Nada de tokens, ids internos ni el documento: el panel solo necesita esto.
    assert.deepEqual(r.json, { status: "ok", stopReason: "Diseno aplicado" });
    const q = fake.find(/FROM agent_runs WHERE id = \$1/);
    assert.ok(q);
    // El filtro por dueno va en el SQL: RLS sola no basta si alguien reusa id.
    assert.match(q.sql, /user_id = \$3/);
    assert.deepEqual(q.params, [RUN, SITE, USER]);
  });
});

test("P08 una ejecucion ajena o inexistente responde 404", async () => {
  await withServer({ run: undefined }, async ({ port }) => {
    const r = await call(port, "GET", `/api/sites/${SITE}/design-runs/${RUN}`);
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: "not_found" });
  });
});

test("P09 los metodos que no tocan responden 405, no 404", async () => {
  await withServer({}, async ({ port }) => {
    assert.equal((await call(port, "DELETE", `/api/sites/${SITE}/design-runs`)).status, 405);
    assert.equal((await call(port, "POST", `/api/sites/${SITE}/design-runs/${RUN}`)).status, 405);
  });
});

test("P10 el id del sitio se valida antes de tocar la base", async () => {
  await withServer({}, async ({ port, fake }) => {
    // Ni siquiera coincide el patron: la ruta no es esta.
    const r = await call(port, "POST", "/api/sites/no-es-uuid/design-runs", { name: "x" });
    assert.equal(r.status, 404);
    assert.equal(/INSERT INTO agent_runs/.test(fake.sql()), false);
  });
});

// --- Deshacer y reanudar (punto A del encargo) ------------------------------

test("P11 deshacer sin sesion responde 401 y no escribe nada", async () => {
  await withServer({ session: false }, async ({ port, fake }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs/${RUN}/undo`, {});
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: "unauthorized" });
    assert.equal(/INSERT INTO audit_log|UPDATE site_drafts|INSERT INTO site_drafts/.test(fake.sql()), false);
  });
});

test("P12 deshacer sobre un sitio ajeno responde 404", async () => {
  // Mismo criterio que el resto: un sitio que no es del dueno no se distingue
  // de uno inexistente, y no se toca ni el borrador ni la auditoria.
  await withServer({ owns: false }, async ({ port, fake }) => {
    const r = await call(port, "POST", `/api/sites/${SITE}/design-runs/${RUN}/undo`, {});
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: "not_found" });
    assert.equal(/INSERT INTO audit_log/.test(fake.sql()), false);
  });
});

test("P13 pedir la ultima ejecucion sin ninguna responde 404", async () => {
  // El panel usa esto para reanudar el chat; sin ejecuciones no hay nada que
  // reanudar, y no se inventa una respuesta vacia.
  await withServer({ latest: undefined }, async ({ port, fake }) => {
    const r = await call(port, "GET", `/api/sites/${SITE}/design-runs/latest`);
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: "not_found" });
    const q = fake.find(/FROM agent_runs\s+WHERE site_id = \$1 AND user_id = \$2/);
    assert.ok(q, "la consulta de la ultima ejecucion no se hizo");
    // Filtra por dueno en el SQL: RLS sola no basta.
    assert.deepEqual(q.params, [SITE, USER]);
  });
});
