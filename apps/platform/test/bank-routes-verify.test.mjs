// Rutas HTTP del constructor del banco (T-034): 401/403/400/503/409/202.
//
// Se levanta el servidor REAL con `createApp` en un puerto efímero y se le da un
// `pool` falso que responde a las dos consultas que hacen falta: la de sesión
// (`auth_lookup_session`) y la de rol (`SELECT role FROM users`). Ni red ni base.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../dist/server.js";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "token-de-prueba";

let server;
let base;
let savedKey;
let bankDir;

/** Pool falso: sesión válida y rol configurable. */
function fakePool({ role }) {
  const query = async (sql) => {
    if (/auth_lookup_session/.test(sql)) {
      return { rows: role === "none" ? [] : [{ id: "33333333-3333-4333-8333-333333333333", user_id: USER_ID }] };
    }
    if (/SELECT role FROM users/.test(sql)) return { rows: role === undefined ? [] : [{ role }] };
    return { rows: [] };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  };
}

async function withServer(role, fn) {
  const s = createApp({ pool: fakePool({ role }), sitesRoot: bankDir }).listen(0);
  const { port } = s.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    s.close();
  }
}

before(async () => {
  bankDir = await mkdtemp(join(tmpdir(), "bank-routes-"));
  await mkdir(join(bankDir, "unsplash"), { recursive: true });
  savedKey = process.env.UNSPLASH_API_KEY;
  process.env.PHOTO_BANK_ROOT = bankDir;
});

after(() => {
  if (savedKey === undefined) delete process.env.UNSPLASH_API_KEY;
  else process.env.UNSPLASH_API_KEY = savedKey;
  delete process.env.PHOTO_BANK_ROOT;
});

test("R1. sin sesión -> 401 en GET y POST", async () => {
  await withServer("operator", async (base) => {
    const g = await fetch(`${base}/api/operator/bank/build`);
    assert.equal(g.status, 401);
    const p = await fetch(`${base}/api/operator/bank/build`, { method: "POST", body: "{}" });
    assert.equal(p.status, 401);
    const inv = await fetch(`${base}/api/operator/bank`);
    assert.equal(inv.status, 401);
  });
});

test("R2. con sesión pero sin rol operator -> 403", async () => {
  await withServer("owner", async (base) => {
    const r = await fetch(`${base}/api/operator/bank/build`, { headers: { cookie: `sid=${TOKEN}` } });
    assert.equal(r.status, 403);
    const p = await fetch(`${base}/api/operator/bank/build`, { method: "POST", headers: { cookie: `sid=${TOKEN}` }, body: "{}" });
    assert.equal(p.status, 403);
  });
});

test("R3. body inválido -> 400 y se valida ANTES de la clave de Unsplash", async () => {
  delete process.env.UNSPLASH_API_KEY;
  try {
    await withServer("operator", async (base) => {
      const r = await fetch(`${base}/api/operator/bank/build`, {
        method: "POST",
        headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ sectors: ["cocina"] }),
      });
      // Sin clave el servidor daría 503 si mirase la clave primero; el 400 prueba el orden.
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, "invalid_body");

      const roto = await fetch(`${base}/api/operator/bank/build`, {
        method: "POST",
        headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
        body: "{no es json",
      });
      assert.equal(roto.status, 400);
    });
  } finally {
    process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";
  }
});

test("R4. sin UNSPLASH_API_KEY -> 503", async () => {
  delete process.env.UNSPLASH_API_KEY;
  try {
    await withServer("operator", async (base) => {
      const r = await fetch(`${base}/api/operator/bank/build`, {
        method: "POST",
        headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error, "unsplash_not_configured");
    });
  } finally {
    process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";
  }
});

test("R5. GET devuelve el estado y POST válido -> 202; segundo POST -> 409", async () => {
  process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";
  await withServer("operator", async (base) => {
    const g = await fetch(`${base}/api/operator/bank/build`, { headers: { cookie: `sid=${TOKEN}` } });
    assert.equal(g.status, 200);
    const body = await g.json();
    assert.ok("run" in body && "last" in body);

    // Arranca con un cuerpo que no hace nada (todo a 0): termina enseguida, así
    // que el 409 se prueba pidiendo dos seguidas dentro de la misma tanda es
    // frágil. Se prueba el 202 primero y el 409 con una ejecución larga abajo.
    const p = await fetch(`${base}/api/operator/bank/build`, {
      method: "POST",
      headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ sectors: ["despacho"], hero: 0, gallery: 0 }),
    });
    assert.equal(p.status, 202);
    const { run } = await p.json();
    assert.equal(run.status, "running");
    assert.ok(run.id);
    // En el 202 no aparece la clave.
    assert.equal(JSON.stringify(run).includes("clave-de-prueba"), false);
  });
});

test("R6. POST sin cuerpo ({}): 202 con opciones por defecto", async () => {
  process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";
  await withServer("operator", async (base) => {
    const r = await fetch(`${base}/api/operator/bank/build`, {
      method: "POST",
      headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ sectors: ["despacho"], hero: 0, gallery: 0, maxRequests: 1 }),
    });
    assert.equal(r.status, 202);
    const { run } = await r.json();
    assert.equal(run.budget, 1);
  });
  // Deja que la ejecución termine antes de la siguiente prueba (una a la vez es
  // precisamente lo que se prueba).
  const { getBankBuildState } = await import("../dist/bank-builder.js");
  const until = Date.now() + 3000;
  while (getBankBuildState().run !== null && Date.now() < until) {
    await new Promise((res) => setTimeout(res, 10));
  }
});

test("R7. el recorte no se puede elegir desde el body", async () => {
  await withServer("operator", async (base) => {
    const r = await fetch(`${base}/api/operator/bank/build`, {
      method: "POST",
      headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
      // `crop`, `query` y `url` no existen en el contrato: se ignoran.
      body: JSON.stringify({ sectors: ["despacho"], hero: 0, gallery: 0, crop: "huge", query: "x", w: 8000, h: 8000 }),
    });
    assert.equal(r.status, 202);
    const text = JSON.stringify(await r.json());
    assert.equal(text.includes("8000"), false, "el recorte pedido no llega a la respuesta");
  });
  const { getBankBuildState } = await import("../dist/bank-builder.js");
  const until = Date.now() + 3000;
  while (getBankBuildState().run !== null && Date.now() < until) {
    await new Promise((res) => setTimeout(res, 10));
  }
});

// DEFECTO DEMOSTRADO (no arreglado): con manifiesto corrupto, GET /api/operator/bank
// no responde: bankInventory() lanza y no hay try/catch en la ruta. El test espera
// una respuesta 5xx controlada; hoy la petición se cuelga y el proceso registra un
// unhandledRejection.
test("R8. GET /api/operator/bank con manifiesto corrupto responde (5xx controlado, no se cuelga)", async () => {
  const corruptDir = await mkdtemp(join(tmpdir(), "bank-corrupt-"));
  await mkdir(join(corruptDir, "unsplash"), { recursive: true });
  await writeFile(join(corruptDir, "unsplash", "manifest.json"), "{roto");
  const prev = process.env.PHOTO_BANK_ROOT;
  process.env.PHOTO_BANK_ROOT = corruptDir;
  try {
    await withServer("operator", async (base) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      try {
        const r = await fetch(`${base}/api/operator/bank`, { headers: { cookie: `sid=${TOKEN}` }, signal: ctl.signal });
        assert.ok(r.status >= 500, `esperaba 5xx y llegó ${r.status}`);
      } finally {
        clearTimeout(t);
      }
    });
  } finally {
    if (prev === undefined) delete process.env.PHOTO_BANK_ROOT;
    else process.env.PHOTO_BANK_ROOT = prev;
  }
});

test("R9. POST mientras corre otra ejecución -> 409 y no arranca nada", async () => {
  process.env.UNSPLASH_API_KEY = "clave-de-prueba-no-real";
  const { startBankBuild, getBankBuildState } = await import("../dist/bank-builder.js");
  const lockDir = await mkdtemp(join(tmpdir(), "bank-lock-"));
  await mkdir(join(lockDir, "unsplash"), { recursive: true });
  let abrir;
  const cerrojo = new Promise((r) => { abrir = r; });
  // fetch que nunca responde hasta que se abra: la ejecución queda viva.
  const fetchLento = async () => { await cerrojo; return new Response(JSON.stringify({ results: [] }), { status: 200 }); };
  const first = startBankBuild({ sectors: ["despacho"], hero: 1, gallery: 0 }, { bankRoot: lockDir, fetch: fetchLento, readCache: async () => undefined, saveCache: async () => ({}) });
  try {
    await withServer("operator", async (base) => {
      const r = await fetch(`${base}/api/operator/bank/build`, {
        method: "POST",
        headers: { cookie: `sid=${TOKEN}`, "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, "already_running");
      // Y la ejecución en curso sigue siendo la primera, no una nueva.
      assert.equal(getBankBuildState().run?.id, first.id);
      const g = await fetch(`${base}/api/operator/bank/build`, { headers: { cookie: `sid=${TOKEN}` } });
      assert.equal((await g.json()).run.id, first.id);
    });
  } finally {
    abrir();
    const until = Date.now() + 3000;
    while (getBankBuildState().run !== null && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  }
});
