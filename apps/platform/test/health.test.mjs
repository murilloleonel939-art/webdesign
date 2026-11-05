import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/server.js";

test("healthz responds ok", async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: "ok" });
  } finally {
    server.close();
  }
});
