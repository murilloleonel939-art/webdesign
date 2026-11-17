import { test } from "node:test";
import assert from "node:assert/strict";

// Spec 8.3: el gateway valida modelo, presupuesto, tamano de prompt, usuario,
// sitio y scopes, y revoca tokens al terminar. Estas pruebas cubren la parte
// que se puede comprobar sin proveedor ni base: la tabla de modelos y el
// presupuesto, que es lo que decide si una llamada se permite.

const { resolveModel, costOf, BudgetTracker } = await import("@webdesign/llm");

test("un alias de modelo desconocido no se resuelve", () => {
  assert.throws(() => resolveModel("gpt-9-imaginario"), /unknown model alias/);
});

test("el coste se calcula por tokens, no por peticion", () => {
  assert.equal(costOf("fast-small", 0, 0), 0);
  assert.ok(costOf("fast-large", 1000, 1000) > costOf("fast-small", 1000, 1000));
});

test("el presupuesto se agota y lo dice con un motivo", () => {
  const t = new BudgetTracker({ maxTokens: 100, maxToolCalls: 1, maxCostUsd: 1, timeoutMs: 60_000, maxContextTokens: 100 });
  assert.equal(t.check(50), null);
  t.record({ tokensIn: 40, tokensOut: 40, costUsd: 0 });
  assert.deepEqual(t.check(50), { kind: "budget", limit: "tokens" });
});

test("el coste se agota aunque queden tokens", () => {
  const t = new BudgetTracker({ maxTokens: 10000, maxToolCalls: 10, maxCostUsd: 0.01, timeoutMs: 60_000, maxContextTokens: 10000 });
  t.record({ tokensIn: 100, tokensOut: 100, costUsd: 0.02 });
  assert.deepEqual(t.check(1), { kind: "budget", limit: "cost" });
});
