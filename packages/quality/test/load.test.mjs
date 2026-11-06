import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "@webdesign/platform/dist/server.js";
import { samplePage } from "./fixtures.mjs";

// Prueba de carga basica (spec 12, aceptacion de Fase 1). No hay umbrales en la
// especificacion: estos son un minimo verificable y holgado para no ser fragil en CI.
const CONCURRENCY = 50;
const TOTAL = 2000;
const P95_BUDGET_MS = 250;

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function run(label, fn, total) {
  const latencies = [];
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (next < total) {
      next += 1;
      const t0 = performance.now();
      try {
        const ok = await fn();
        if (!ok) failures += 1;
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - t0);
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  return {
    label,
    requests: latencies.length,
    failures,
    rps: Math.round(latencies.length / seconds),
    p95: Math.round(percentile(latencies, 95)),
  };
}

test("el servidor aguanta carga concurrente sin errores", async () => {
  const server = createApp({});
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const health = await run("healthz", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      await res.arrayBuffer();
      return res.status === 200;
    }, TOTAL);
    console.log(`healthz: ${health.requests} peticiones, ${health.rps} rps, p95 ${health.p95} ms`);
    assert.equal(health.failures, 0, JSON.stringify(health));
    assert.ok(health.p95 < P95_BUDGET_MS, `p95 ${health.p95} ms supera ${P95_BUDGET_MS} ms`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("renderizar una pagina publicada aguanta carga", async () => {
  const render = await run("render", async () => samplePage("p_home").includes("</html>"), TOTAL);
  console.log(`render: ${render.requests} paginas, ${render.rps} rps, p95 ${render.p95} ms`);
  assert.equal(render.failures, 0, JSON.stringify(render));
  assert.ok(render.p95 < P95_BUDGET_MS, `p95 ${render.p95} ms supera ${P95_BUDGET_MS} ms`);
});
