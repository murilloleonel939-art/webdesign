import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({
  entryPoints: [new URL("../ui/design-chat-flow.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const { QUESTIONS, buildPayload, isSendKey, undoMessage } = mod;

test("QUESTIONS tiene solo 2 preguntas y sin keys city/service", () => {
  assert.equal(QUESTIONS.length, 2);
  for (const q of QUESTIONS) {
    assert.notEqual(q.key, "city");
    assert.notEqual(q.key, "service");
  }
});

test("buildPayload sin datos y sin prompt devuelve null", () => {
  assert.equal(buildPayload({}, undefined, ""), null);
});

test("buildPayload con solo nombre envia brief.name y sin prompt", () => {
  const r = buildPayload({ name: "Café Aurora" }, undefined, "");
  assert.deepEqual(r.brief, { name: "Café Aurora" });
  assert.equal(r.prompt, "");
});

test("buildPayload une initialPrompt y composerText con '. ' y recorta a 500", () => {
  const r = buildPayload({}, "hola", "mundo");
  assert.equal(r.prompt, "hola. mundo");

  const largo = "a".repeat(600);
  const r2 = buildPayload({}, largo, "");
  assert.equal(r2.prompt.length, 500);
});

test("isSendKey", () => {
  assert.equal(isSendKey({ key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(isSendKey({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(isSendKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
});

test("undoMessage traduce estados HTTP", () => {
  assert.equal(undoMessage(200, {}).kind, "ok");
  assert.equal(undoMessage(409, { error: "edited_after" }).kind, "confirm");
  assert.equal(undoMessage(401, {}).kind, "gone");
  assert.equal(undoMessage(404, {}).kind, "gone");
  assert.equal(undoMessage(500, {}).kind, "retry");
});

test("ningun text incluye codigos HTTP", () => {
  const codigos = ["200", "409", "401", "404", "500"];
  const casos = [
    undoMessage(200, {}),
    undoMessage(409, { error: "edited_after" }),
    undoMessage(401, {}),
    undoMessage(404, {}),
    undoMessage(500, {}),
  ];
  for (const c of casos) {
    for (const cod of codigos) {
      assert.equal(c.text.includes(cod), false);
    }
  }
});
