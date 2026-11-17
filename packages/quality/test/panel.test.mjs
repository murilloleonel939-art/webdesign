import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Smoke del panel del editor: el bundle real debe montar en un DOM sin lanzar.
// Requiere `apps/platform/ui-dist` construido (lo hace el build de platform).
const UI = join(import.meta.dirname, "../../../apps/platform/ui-dist");

test("el panel monta en el DOM sin errores de carga", { skip: !existsSync(join(UI, "panel.js")) && "panel no construido" }, async () => {
  const html = readFileSync(join(UI, "panel.html"), "utf8").replace(/<script[^>]*><\/script>/, "");
  const dom = new JSDOM(html, { url: "http://localhost/app/?site=11111111-1111-4111-8111-111111111111", runScripts: "outside-only", pretendToBeVisual: true });
  const doc = {
    schemaVersion: 1, meta: { name: "Café", lang: "es" },
    design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
    theme: { colors: { ground: "#fff", ink: "#000", accent: "#b00" }, typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 100 }, radius: "square" },
    pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: false }, sections: [] }],
    assets: [],
  };
  // jsdom no implementa ResizeObserver (lo usa Puck para medir el lienzo).
  const errors = [];
  dom.window.addEventListener("error", (e) => errors.push(String(e.message)));
  // jsdom tampoco implementa matchMedia (lo usa Puck para el modo responsive).
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // React 19 usa MessageChannel para programar tareas; jsdom no lo trae. Se toma
  // el de Node, que cumple el mismo contrato.
  const channels = [];
  dom.window.MessageChannel = class extends MessageChannel {
    constructor() {
      super();
      channels.push(this);
      // Los puertos de Node mantienen vivo el event loop y el proceso no termina.
      this.port1.unref?.();
      this.port2.unref?.();
    }
  };
  // React 19 / Puck también esperan TextEncoder y TextDecoder (scheduler y parseo).
  dom.window.TextEncoder = TextEncoder;
  dom.window.TextDecoder = TextDecoder;
  dom.window.fetch = async () => ({ status: 200, ok: true, json: async () => ({ rev: 1, doc }) });
  try {
    assert.doesNotThrow(() => dom.window.eval(readFileSync(join(UI, "panel.js"), "utf8")));
    await new Promise((r) => setTimeout(r, 400));
    const root = dom.window.document.getElementById("root");
    assert.ok(root.children.length > 0, `el panel no monto nada; errores: ${JSON.stringify(errors.slice(0,3))}`);
  } finally {
    // Cerrar el DOM y los puertos abiertos: unref() solo no basta, el puerto 1
    // vuelve a quedar referenciado por el scheduler de React.
    dom.window.close();
    for (const ch of channels) {
      try { ch.port1.close(); } catch {}
      try { ch.port2.close(); } catch {}
    }
  }
});
