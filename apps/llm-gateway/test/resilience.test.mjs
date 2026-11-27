import { test } from "node:test";
import assert from "node:assert/strict";

// Un fallo de CONTABILIDAD no puede tumbar el gateway.
//
// POR QUÉ EXISTE: el UPDATE de tokens se ejecutaba dentro del camino de éxito y
// la política `agent_runs_gateway_update` (0015) no admitía `status = 'running'`.
// Un `42501` de RLS escapaba sin capturar, mataba el proceso y el worker se
// quedaba sin respuesta. El texto del modelo ya está pagado: la respuesta sale
// igual y el fallo queda en el registro.
//
// Sin base de datos: el `pool` del módulo se sustituye por un doble que contesta
// lo justo y falla donde se le pide.

process.env["LLM_PROVIDER_API_KEY"] = "sk-prueba-no-real";
process.env["DATABASE_URL"] = "postgres://prueba/prueba";

const { server, pool } = await import("../dist/server.js");

const RUN_ID = "9f0c5a1e-1f0e-4a2b-8f3a-3c2b1a0d9e8f";
const TOKEN = "11111111-2222-4333-8444-555555555555";

/** Doble de `pool.query`: responde por forma de la consulta y falla donde se pida. */
function fakePool({ fail = {} } = {}) {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/FROM agent_tokens/.test(sql)) {
      if (fail.authorize) throw fail.authorize;
      return { rows: [{ scopes: ["llm:complete"], site_id: null }] };
    }
    if (/FROM agent_runs WHERE id/.test(sql)) {
      if (fail.loadBudget) throw fail.loadBudget;
      return { rows: [{ prompt_tokens_max: 1000, tokens_in: 10, tokens_out: 5, status: "running" }] };
    }
    if (/UPDATE agent_runs SET tokens_in/.test(sql)) {
      if (fail.updateTokens) throw fail.updateTokens;
      // `rowCount` explícito: el camino real comprueba que se tocó una fila.
      return { rows: [], rowCount: fail.noRows ? 0 : 1 };
    }
    if (/UPDATE agent_runs SET status = 'error'/.test(sql)) {
      if (fail.closeOnError) throw fail.closeOnError;
      return { rows: [] };
    }
    if (/UPDATE agent_runs SET status = 'budget_exhausted'/.test(sql)) {
      if (fail.budgetClose) throw fail.budgetClose;
      return { rows: [] };
    }
    if (/INSERT INTO usage_events/.test(sql)) {
      if (fail.usage) throw fail.usage;
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { calls, query };
}

/** Error de Postgres tal como llega: código en `code`, sin texto de consulta. */
function pgError(code) {
  const error = new Error("new row violates row-level security policy");
  error.code = code;
  return error;
}

/**
 * Doble de `fetch` SOLO para el proveedor.
 *
 * Las peticiones a `127.0.0.1` (las de la propia prueba contra el servidor) se
 * dejan pasar: si el doble se comiera también esas, la prueba se estaría
 * contestando a sí misma y no mediría nada.
 */
function fakeFetch() {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("127.0.0.1")) return previous(url, init);
    return {
      ok: true,
      status: 200,
      async json() {
        return { content: [{ type: "text", text: "Hola desde Claude" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } };
      },
      async text() { return ""; },
    };
  };
  return { restore: () => { globalThis.fetch = previous; } };
}

async function withServer(fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Petición válida a /v1/complete (Claude, un mensaje de usuario). */
function complete(base) {
  return fetch(`${base}/v1/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      runId: RUN_ID,
      model: "design",
      messages: [{ role: "user", content: "hola" }],
      maxOutputTokens: 64,
    }),
  });
}

/** Sustituye `pool.query` durante la prueba y lo restaura al salir. */
async function withPool(fake, fn) {
  const previous = pool.query;
  pool.query = fake.query;
  try {
    return await fn(fake);
  } finally {
    pool.query = previous;
  }
}

test("si no se pueden persistir los tokens, 503 y la ejecución se cierra: nunca un 200 sin contabilidad", async () => {
  // FAIL-OPEN QUE CIERRA ESTA PRUEBA: sin persistir `tokens_in`/`tokens_out`,
  // `loadBudget` sigue leyendo el contador viejo y la ejecución gastaría sin
  // tope repitiendo llamadas. El texto ya está pagado, pero no se devuelve: la
  // regla es "ningún 200 sin contabilidad persistida".
  const f = fakeFetch();
  try {
    const fake = fakePool({ fail: { updateTokens: pgError("42501") } });
    await withPool(fake, async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: "accounting_unavailable" });

        // La ejecución se cierra en error para que no siga gastando.
        assert.ok(
          fake.calls.some((sql) => /UPDATE agent_runs SET status = 'error'/.test(sql)),
          "se cierra la ejecución en error",
        );

        // El proceso sigue atendiendo: esto es lo que antes no pasaba.
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});

test("si recordUsage falla, la respuesta sale igual y el proceso sigue vivo", async () => {
  const f = fakeFetch();
  try {
    await withPool(fakePool({ fail: { usage: pgError("42501") } }), async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 200);
        assert.equal((await res.json()).text, "Hola desde Claude");
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});

test("un fallo al cerrar por presupuesto agotado no impide el 429", async () => {
  const f = fakeFetch();
  const query = async (sql) => {
    if (/FROM agent_tokens/.test(sql)) return { rows: [{ scopes: ["llm:complete"], site_id: null }] };
    // Sin saldo: lo gastado ya llega al tope.
    if (/FROM agent_runs WHERE id/.test(sql)) return { rows: [{ prompt_tokens_max: 10, tokens_in: 7, tokens_out: 5, status: "running" }] };
    if (/UPDATE agent_runs SET status = 'budget_exhausted'/.test(sql)) throw pgError("42501");
    return { rows: [] };
  };
  try {
    await withPool({ query }, async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 429);
        assert.equal((await res.json()).error, "budget_exhausted");
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});

test("si la base no responde al autorizar, 503 controlado y el proceso sigue vivo", async () => {
  const f = fakeFetch();
  try {
    await withPool(fakePool({ fail: { authorize: pgError("08006") } }), async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).error, "authorization_unavailable");
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});

test("si la base no responde al leer el presupuesto, 503 controlado y el proceso sigue vivo", async () => {
  const f = fakeFetch();
  try {
    await withPool(fakePool({ fail: { loadBudget: pgError("08006") } }), async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).error, "budget_unavailable");
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});

test("una excepción no prevista en el handler responde 500 y el proceso sigue atendiendo", async () => {
  // El `.catch()` de `createServer` es la última red: si algo escapa de las
  // capturas concretas, el proceso NO puede caerse. Aquí se fuerza una excepción
  // que ninguna captura prevista cubre: un presupuesto corrupto (texto donde se
  // espera un número) hace que `budgetSchema.parse` lance.
  const f = fakeFetch();
  const query = async (sql) => {
    if (/FROM agent_tokens/.test(sql)) return { rows: [{ scopes: ["llm:complete"], site_id: null }] };
    // `prompt_tokens_max` no es un número: la comparación no corta y el esquema
    // del presupuesto lanza un ZodError.
    if (/FROM agent_runs WHERE id/.test(sql)) return { rows: [{ prompt_tokens_max: "muchos", tokens_in: 0, tokens_out: 0, status: "running" }] };
    return { rows: [] };
  };
  const antes = process.stderr.write;
  const lineas = [];
  process.stderr.write = (chunk) => { lineas.push(String(chunk)); return true; };
  try {
    await withPool({ query }, async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: "internal_error" });
        assert.ok(
          lineas.some((l) => l.includes("error no capturado")),
          "el fallo queda registrado",
        );
        // Y el proceso sigue atendiendo.
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).ok, true);
      });
    });
  } finally {
    process.stderr.write = antes;
    f.restore();
  }
});

test("si tampoco se puede cerrar la ejecución, el 503 sale igual y no se cae", async () => {
  const f = fakeFetch();
  try {
    const fake = fakePool({ fail: { updateTokens: pgError("42501"), closeOnError: pgError("42501") } });
    const antes = process.stderr.write;
    const lineas = [];
    process.stderr.write = (chunk) => { lineas.push(String(chunk)); return true; };
    try {
      await withPool(fake, async () => {
        await withServer(async (base) => {
          const res = await complete(base);
          assert.equal(res.status, 503);
          assert.deepEqual(await res.json(), { error: "accounting_unavailable" });
          assert.ok(lineas.some((l) => l.includes("cierre por fallo de contabilidad")), "el fallo del cierre se registra");
          const health = await fetch(`${base}/healthz`);
          assert.equal(health.status, 200);
        });
      });
    } finally {
      process.stderr.write = antes;
    }
  } finally {
    f.restore();
  }
});

test("si el UPDATE de tokens no toca ninguna fila, 503 y nunca 200", async () => {
  // Cierre concurrente entre el chequeo de estado y el UPDATE: la fila sale del
  // `USING (status='running')`, el UPDATE afecta 0 filas SIN lanzar y el gasto
  // se perdería con un 200. Igual que un fallo de contabilidad: 503.
  const f = fakeFetch();
  try {
    const fake = fakePool({ fail: { noRows: true } });
    await withPool(fake, async () => {
      await withServer(async (base) => {
        const res = await complete(base);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: "accounting_unavailable" });

        // No se intenta cerrar la ejecución: si no se tocó ninguna fila, ya está
        // cerrada o no existe.
        assert.equal(
          fake.calls.some((sql) => /UPDATE agent_runs SET status = 'error'/.test(sql)),
          false,
          "un UPDATE que no tocó la fila no dispara el cierre",
        );

        // El proceso sigue atendiendo.
        const health = await fetch(`${base}/healthz`);
        assert.equal(health.status, 200);
      });
    });
  } finally {
    f.restore();
  }
});
