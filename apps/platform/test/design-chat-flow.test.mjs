import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const out = await build({
  entryPoints: [new URL("../ui/design-chat-flow.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const { QUESTIONS, buildPayload, isSendKey, undoMessage, resumeFrom, pollDecision, pollDelay, shouldAutoStart, ownerPrompt } = mod;

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

test("resumeFrom(null) devuelve asking", () => {
  assert.deepEqual(resumeFrom(null, 1000), { phase: "asking" });
});

test("resumeFrom con status running devuelve running con runId", () => {
  const r = resumeFrom({ runId: "r1", status: "running", startedAt: "2024-01-01T00:00:00.000Z" }, 999);
  assert.equal(r.phase, "running");
  assert.equal(r.runId, "r1");
  assert.equal(r.startedAt, Date.parse("2024-01-01T00:00:00.000Z"));

  const sinFecha = resumeFrom({ runId: "r2", status: "running" }, 999);
  assert.equal(sinFecha.startedAt, 999);
});

test("resumeFrom con status ok devuelve done ok true y elapsed correcto", () => {
  const r = resumeFrom({
    runId: "r3",
    status: "ok",
    stopReason: "listo",
    startedAt: "2024-01-01T00:00:00.000Z",
    endedAt: "2024-01-01T00:00:10.000Z",
  }, 0);
  assert.deepEqual(r, { phase: "done", runId: "r3", ok: true, status: "ok", stopReason: "listo", elapsed: 10 });
});

test("resumeFrom con status failed devuelve done ok false", () => {
  const r = resumeFrom({ runId: "r4", status: "failed", stopReason: null }, 0);
  assert.equal(r.phase, "done");
  assert.equal(r.ok, false);
  assert.equal(r.elapsed, 0);
});

test("pollDecision: running y menos de 10 min sigue sondeando", () => {
  assert.equal(pollDecision("running", 0), "keep");
  assert.equal(pollDecision("running", 90000), "keep");
  assert.equal(pollDecision("running", 599999), "keep");
});

test("pollDecision: running y 10 min o mas pasa a stalled", () => {
  assert.equal(pollDecision("running", 600000), "stalled");
  assert.equal(pollDecision("running", 700000), "stalled");
});

test("pollDecision: un estado definido distinto de running es done", () => {
  assert.equal(pollDecision("ok", 100), "done");
  assert.equal(pollDecision("failed", 700000), "done");
  assert.equal(pollDecision("budget_exhausted", 0), "done");
});

test("pollDecision: sin estado todavia (undefined) sigue sondeando", () => {
  assert.equal(pollDecision(undefined, 0), "keep");
  assert.equal(pollDecision(undefined, 700000), "keep");
});

test("pollDelay: 2s antes de 90s, 4s desde los 90s", () => {
  assert.equal(pollDelay(0), 2000);
  assert.equal(pollDelay(89999), 2000);
  assert.equal(pollDelay(90000), 4000);
  assert.equal(pollDelay(600000), 4000);
});

test("shouldAutoStart: true solo con prompt no vacio y sin ejecucion previa", () => {
  assert.equal(shouldAutoStart("Una cafetería", false), true);
});

test("shouldAutoStart: false si ya hubo una ejecucion previa", () => {
  assert.equal(shouldAutoStart("Una cafetería", true), false);
});

test("shouldAutoStart: false sin prompt", () => {
  assert.equal(shouldAutoStart("", false), false);
  assert.equal(shouldAutoStart("   ", false), false);
});

// Bug: el chat pintaba la idea del diseno (doc.design.idea) como si fuera el
// mensaje del cliente. El texto del cliente esta en doc.design.brief.
test("ownerPrompt: usa design.brief, no la idea del diseno", () => {
  const doc = {
    design: { brief: "buffet de abogados en barranquilla", idea: "Terracota y crema: cercano, artesanal, sin estridencias." },
  };
  assert.equal(ownerPrompt(doc), "buffet de abogados en barranquilla");
});

test("ownerPrompt: un sitio recien creado trae el texto del dueno en idea y brief vacio", () => {
  // initialDoc (apps/platform/src/api.ts): design: { brief: "", idea, ... }
  const doc = { design: { brief: "", idea: "quiero una pagina web para un buffet de abogados" } };
  assert.equal(ownerPrompt(doc), "quiero una pagina web para un buffet de abogados");
});

test("ownerPrompt: recorta espacios de los dos campos", () => {
  assert.equal(ownerPrompt({ design: { brief: "  con brief  ", idea: "idea" } }), "con brief");
  assert.equal(ownerPrompt({ design: { brief: "   ", idea: "  con idea  " } }), "con idea");
});

test("ownerPrompt: sin datos devuelve cadena vacia (el chat no pinta burbuja)", () => {
  assert.equal(ownerPrompt({ design: { brief: "", idea: "" } }), "");
  assert.equal(ownerPrompt({ design: {} }), "");
  assert.equal(ownerPrompt(null), "");
  assert.equal(ownerPrompt(undefined), "");
  assert.equal(ownerPrompt({}), "");
});

// El agente compone `design.brief` con los campos, asi que la burbuja mostraba
// "buffet de abogados en barranquilla" y no la frase que escribio el dueno. La
// frase literal vive ahora en `design.ownerPrompt`.
test("ownerPrompt: prefiere la frase literal guardada por el agente", () => {
  const doc = {
    design: {
      ownerPrompt: "quiero una pagina web para un buffet de abogados en barranquilla",
      brief: "buffet de abogados en barranquilla",
      idea: "Terracota y crema: cercano, artesanal, sin estridencias.",
    },
  };
  assert.equal(ownerPrompt(doc), "quiero una pagina web para un buffet de abogados en barranquilla");
});

test("ownerPrompt: documento disenado antes del campo, cae al brief compuesto", () => {
  assert.equal(ownerPrompt({ design: { brief: "buffet de abogados en barranquilla", idea: "idea" } }),
    "buffet de abogados en barranquilla");
});

test("ownerPrompt: documento sin disenar usa idea (brief vacio) y arranca solo", () => {
  const frase = "quiero una pagina web para un buffet de abogados";
  const doc = { design: { ownerPrompt: "", brief: "", idea: frase } };
  assert.equal(ownerPrompt(doc), frase);
  assert.equal(shouldAutoStart(ownerPrompt(doc), false), true);
});

// El producto no promete marcas ni pide confirmar datos que ya no existen: el
// agente rechaza cualquier documento con el marcador
// (agents/design/src/draft.ts: "borrador invalido: contiene el marcador
// pendiente"), asi que no hay nada que anunciar ni que revisar por su nombre.
// Si alguien vuelve a copiar esa frase en la interfaz, esto falla.
const uiSrc = (f) => readFileSync(new URL(`../ui/${f}`, import.meta.url).pathname, "utf8");

test("la interfaz no habla de datos pendientes ni de confirmar marcas", () => {
  for (const f of ["panel.tsx", "DesignChat.tsx", "design-chat-flow.ts", "StyleStart.tsx"]) {
    const src = uiSrc(f);
    assert.doesNotMatch(src, /pendiente de confirmar/i, `${f} nombra el marcador`);
    assert.doesNotMatch(src, /datos? por confirmar/i, `${f} pide confirmar datos`);
  }
});

test("el cierre del chat invita a pedir cambios, sin contar nada", () => {
  assert.match(uiSrc("DesignChat.tsx"), /Listo\. Si quieres cambiar algo, dímelo con tus palabras\./);
});
