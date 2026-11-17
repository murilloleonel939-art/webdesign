import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "../dist/index.js";

// Spec 1.15: "un solo sitio publicado por cuenta". La regla la impone la base
// con el indice parcial sites_one_active_per_owner (0003:33, 0008:163), y es
// correcta: no se toca. Lo que se prueba aqui es que la aplicacion lo trate
// como un resultado y no como una excepcion. En produccion, el UPDATE chocaba
// con el indice (23505), el throw subia por el handler async y mataba el
// proceso: el dueno veia un 502 opaco.

const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const doc = (headline) => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: false },
    sections: [{ id: "s_hero", type: "hero", props: { headline, cta: { label: "Ir", href: "https://x.com" } } }] }],
  assets: [],
});

// Doble en memoria del cliente Postgres: sin base en esta maquina, la decision
// se prueba igual. Contesta lo justo que `publish` consulta antes de escribir:
// el cerrojo consultivo y la busqueda del otro sitio activo. Cualquier otra
// consulta revienta a proposito: si `publish` llegara a escribir, el test
// falla en vez de pasar en verde.
function doublePool({ activeId, activeName }) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push(typeof sql === "string" ? sql.trim() : String(sql));
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM sites WHERE owner_id = \$1 AND status = 'active'/.test(sql)) {
        return { rows: activeId ? [{ id: activeId, name: activeName }] : [], rowCount: activeId ? 1 : 0 };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/set_config/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`consulta inesperada (no deberia escribir nada): ${sql} :: ${JSON.stringify(params)}`);
    },
    release: () => {},
  };
  return { pool: { connect: async () => client }, calls };
}

test("con otro sitio activo no lanza: devuelve el motivo tipado", async () => {
  const root = mkdtempSync(join(tmpdir(), "another-"));
  const { pool } = doublePool({ activeId: SITE_A, activeName: "Café Central" });
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE_B, doc: doc("Hola") });

  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "another_site_active");
  assert.equal(r.activeSiteId, SITE_A);
  assert.equal(r.activeSiteName, "Café Central");
  // Sin `findings` en esta variante: quien los lea sin estrechar no compila.
  assert.equal("findings" in r, false);
});

test("bloqueado antes de escribir el release: no queda nada en disco", async () => {
  const root = mkdtempSync(join(tmpdir(), "another-"));
  const { pool } = doublePool({ activeId: SITE_A, activeName: "Café Central" });
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE_B, doc: doc("Hola") });

  assert.equal(r.reason, "another_site_active");
  // `publishRelease` escribe /data/sites/<id>/releases/v1 y mueve `public`.
  // La comprobacion va ANTES justo para esto: si fuera despues quedarian
  // ficheros de una release que no existe en la base.
  assert.equal(existsSync(join(root, SITE_B)), false);
  assert.deepEqual(readdirSync(root), []);
});
