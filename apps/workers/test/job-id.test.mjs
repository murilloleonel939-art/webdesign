import { test } from "node:test";
import assert from "node:assert/strict";
import { lintJobId, designJobId } from "../dist/index.js";

// BullMQ 5 rechaza un `jobId` que contenga `:` con el error
// "Custom Id cannot contain :". Como ese id viaja como `jobId` en `queue.add`,
// un separador de dos puntos tumbaba TODO encolado (lint visual y diseño).
// Estas pruebas fijan el contrato que lo evita: sin `:` y determinista.

const SITE = "77777777-7777-4777-8777-777777777777";
const RUN = "88888888-8888-4888-8888-888888888888";

test("lintJobId no lleva ':' y es determinista", () => {
  const a = lintJobId({ siteId: SITE, version: 7 });
  const b = lintJobId({ siteId: SITE, version: 7 });
  assert.ok(!a.includes(":"), `lintJobId contiene ':' -> "${a}"`);
  assert.equal(a, b);
  assert.equal(a, `lint-${SITE}-7`);
});

test("designJobId no lleva ':' y es determinista", () => {
  const a = designJobId({ runId: RUN });
  const b = designJobId({ runId: RUN });
  assert.ok(!a.includes(":"), `designJobId contiene ':' -> "${a}"`);
  assert.equal(a, b);
  assert.equal(a, `design-${RUN}`);
});

test("entradas distintas dan ids distintos", () => {
  assert.notEqual(lintJobId({ siteId: SITE, version: 7 }), lintJobId({ siteId: SITE, version: 8 }));
  assert.notEqual(
    lintJobId({ siteId: SITE, version: 7 }),
    lintJobId({ siteId: "99999999-9999-4999-8999-999999999999", version: 7 }),
  );
  assert.notEqual(designJobId({ runId: RUN }), designJobId({ runId: SITE }));
});
