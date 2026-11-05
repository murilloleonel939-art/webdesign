import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { migrate, withUser } from "@webdesign/db";
import { publish, rollbackTo } from "../dist/index.js";
import { currentVersion } from "@webdesign/releases";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de publicacion omitidas: falta DB de pruebas", { skip: true }, () => {});
  process.exit(0);
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
let pool, root;

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

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  await pool.query("DROP TABLE IF EXISTS sites, site_members, site_drafts, site_versions, assets, audit_log, users, schema_migrations CASCADE");
  await migrate(pool);
  await pool.query(`INSERT INTO users (id, email, name) VALUES ('${OWNER}', 'a@b.co', 'Ana')`);
  await pool.query(`INSERT INTO sites (id, owner_id, name) VALUES ('${SITE}', '${OWNER}', 'Café')`);
  root = mkdtempSync(join(tmpdir(), "pub-"));
});
after(() => pool?.end());

test("publica, registra version y auditoria, y activa el sitio", async () => {
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE, doc: doc("Hola") });
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  const rows = await withUser(pool, OWNER, async (tx) => (await tx.query("SELECT version, doc_hash FROM site_versions")).rows);
  assert.equal(rows.length, 1);
  const audit = await withUser(pool, OWNER, async (tx) => (await tx.query("SELECT action FROM audit_log")).rows);
  assert.ok(audit.some((a) => a.action === "site.publish"));
  const site = await pool.query("SELECT status, published_version FROM sites WHERE id = $1", [SITE]);
  assert.equal(site.rows[0].status, "active");
  assert.equal(site.rows[0].published_version, 1);
});

test("bloquea un documento con un error del linter", async () => {
  const bad = doc("Hola");
  bad.pages[0].seo.title = "";
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE, doc: bad });
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "MISSING_TITLE"));
  assert.equal(currentVersion(root, SITE), 1);
});

test("el dueno puede publicar confirmando el aviso, y queda en auditoria", async () => {
  const bad = doc("Hola");
  bad.pages[0].seo.title = "";
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE, doc: bad, confirmWarnings: true });
  assert.equal(r.ok, true);
  assert.equal(r.version, 2);
  const audit = await withUser(pool, OWNER, async (tx) =>
    (await tx.query("SELECT meta FROM audit_log WHERE action = 'site.publish' ORDER BY at DESC LIMIT 1")).rows);
  assert.equal(audit[0].meta.confirmed, true);
});

test("revierte a la version anterior", async () => {
  const to = await rollbackTo(pool, { sitesRoot: root, userId: OWNER, siteId: SITE });
  assert.equal(to, 1);
  assert.equal(currentVersion(root, SITE), 1);
  const audit = await withUser(pool, OWNER, async (tx) => (await tx.query("SELECT action FROM audit_log WHERE action = 'site.rollback'")).rows);
  assert.equal(audit.length, 1);
});

test("rechaza un documento invalido sin tocar ficheros", async () => {
  const r = await publish(pool, { sitesRoot: root, userId: OWNER, siteId: SITE, doc: { schemaVersion: 1 } });
  assert.equal(r.ok, false);
  assert.equal(r.version, undefined);
  assert.equal(currentVersion(root, SITE), 1);
});
