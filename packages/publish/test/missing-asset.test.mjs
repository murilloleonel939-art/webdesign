import { test } from "node:test";
import assert from "node:assert/strict";
import { publish } from "../dist/index.js";

// Un asset que no resuelve se publicaba como seccion vacia: el sitio salia con
// un hueco y nadie se enteraba. Ahora corta y dice cual falta.
const doc = {
  schemaVersion: 1,
  meta: { name: "Sitio", lang: "es" },
  design: { brief: "", idea: "", presetId: "p", dials: { variance: 3, motion: 2, density: 5 } },
  theme: {
    colors: { ground: "#ffffff", ink: "#111111", accent: "#0b5fff" },
    typography: { family: "Inter", scale: "normal" },
    spacing: { margin: 64, sectionGap: 72 }, radius: "rounded",
  },
  pages: [{
    id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: true },
    sections: [{ id: "img-1", type: "image", props: { assetId: "A-1", alt: "foto" } }],
  }],
  assets: [{ id: "A-1", alt: "foto" }],
  // `own`: el dueño subio la imagen, asi que la licencia esta en regla y el
  // unico hallazgo que se prueba es el asset ausente.
};

test("no se publica un bloque de imagen cuyo fichero no existe", async () => {
  const r = await publish({}, { sitesRoot: "/tmp/nada", userId: "11111111-1111-4111-8111-111111111111", siteId: "33333333-3333-4333-8333-333333333333", doc, licensedAssetIds: ["A-1"] });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.ok(r.findings.some((f) => f.code === "MISSING_ASSET"), "debe decir que falta el asset");
});

// Con el asset resuelto ya no corta, asi que llega a la base: se le da un pool
// falso que no hace nada, porque lo unico que se comprueba es el hallazgo.
const poolFalso = {
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
};

test("con el asset resuelto no se queja", async () => {
  const r = await publish(poolFalso, {
    sitesRoot: "/tmp/nada", userId: "11111111-1111-4111-8111-111111111111", siteId: "33333333-3333-4333-8333-333333333333", doc,
    licensedAssetIds: ["A-1"],
    resolveAssetPath: (id) => (id === "A-1" ? "/assets/33333333-3333-4333-8333-333333333333/image/f.jpg" : undefined),
  });
  assert.equal(r.findings.some((f) => f.code === "MISSING_ASSET"), false);
});
