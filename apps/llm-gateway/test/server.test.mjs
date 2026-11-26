import { test } from "node:test";
import assert from "node:assert/strict";

// `GET /healthz`: no debe mentir. Comprueba las variables imprescindibles sin
// llamar al proveedor (eso gastaria dinero y colgaria el chequeo) y sin tocar
// la base de datos (el pool se crea al importar, pero esta ruta no consulta).
//
// Variables antes de importar: `providerModelId`/`designPricing` y el propio
// `pg.Pool` leen el entorno al cargar el modulo o al usarse; se fijan antes del
// import dinamico para que el modulo arranque en un estado conocido.
process.env["LLM_PROVIDER_API_KEY"] = "sk-prueba-no-real";
process.env["DATABASE_URL"] = "postgres://prueba/prueba";

const { server } = await import("../dist/server.js");

/** Hace una peticion HTTP real contra el servidor en un puerto efimero. */
async function withServer(fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Pone/quita variables de entorno durante la prueba y las restaura al salir. */
async function withEnv(vars, fn) {
  const before = {};
  for (const k of Object.keys(vars)) {
    before[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("/healthz sin LLM_PROVIDER_API_KEY responde 503 y lista la variable que falta", async () => {
  await withEnv({ LLM_PROVIDER_API_KEY: undefined }, async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.ok, false);
      assert.ok(body.missing.includes("LLM_PROVIDER_API_KEY"));
    });
  });
});

test("/healthz sin DATABASE_URL responde 503 y lista la variable que falta", async () => {
  await withEnv({ DATABASE_URL: undefined }, async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.ok(body.missing.includes("DATABASE_URL"));
    });
  });
});

test("/healthz con las dos variables definidas responde 200 { ok: true }", async () => {
  await withEnv({ LLM_PROVIDER_API_KEY: "sk-prueba-no-real", DATABASE_URL: "postgres://prueba/prueba" }, async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(body, { ok: true });
    });
  });
});

test("la respuesta de /healthz nunca contiene el valor de la clave", async () => {
  await withEnv({ LLM_PROVIDER_API_KEY: "sk-prueba-no-real", DATABASE_URL: "postgres://prueba/prueba" }, async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      const text = await res.text();
      assert.ok(!text.includes("sk-prueba-no-real"));
    });
  });
  // Tambien en el caso 503: el nombre de la variable se expone, su valor nunca.
  await withEnv({ LLM_PROVIDER_API_KEY: undefined, DATABASE_URL: "postgres://prueba/prueba" }, async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/healthz`);
      const text = await res.text();
      assert.ok(!text.includes("sk-prueba-no-real"));
    });
  });
});

// --- Log del 502: motivo visible en stderr, sin secretos --------------------
//
// No se prueba aqui end-to-end contra `/v1/complete` porque esa ruta exige
// `DATABASE_URL` real (autorizacion y presupuesto viven en Postgres) antes de
// llegar siquiera al transporte: montar esa cadena solo para este test seria
// una prueba fragil que depende de infraestructura, no del log en si. Se deja
// dicho en vez de inventar un test debil: la forma exacta del log (reason,
// code, message recortado/sin saltos, run, model) se revisa en el diff de
// `logProviderFailure` en `src/server.ts`.
test("aviso: el log del 502 end-to-end no se prueba aqui (requiere DATABASE_URL real); ver nota en el archivo", () => {
  assert.ok(true);
});
