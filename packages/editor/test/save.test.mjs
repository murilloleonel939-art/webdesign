import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate, ensureTestDatabase, withUser } from "@webdesign/db";
import { saveDraft, loadDraft } from "../dist/save.js";

if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL) {
  test("pruebas de guardado omitidas: falta DB de pruebas", { skip: true }, () => {});
  process.exit(0);
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";
let pool;

const doc = (headline) => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: { colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" }, spacing: { margin: 24, sectionGap: 160 }, radius: "square" },
  pages: [{ id: "p_home", slug: "/", seo: { title: "Inicio", description: "d", noindex: false },
    sections: [{ id: "s_hero", type: "hero", props: { headline } }] }],
  assets: [],
});

before(async () => {
  const admin = new pg.Pool({ connectionString: process.env.DB_TEST_URL });
  const url = await ensureTestDatabase(admin, process.env.DB_TEST_URL, "editor");
  await admin.end();
  pool = new pg.Pool({ connectionString: url });
  await pool.query("DROP TABLE IF EXISTS sites, site_members, site_drafts, site_versions, assets, audit_log, users, schema_migrations CASCADE");
  await migrate(pool);
  await pool.query(`INSERT INTO users (id, email, name) VALUES ('${OWNER}', 'a@b.co', 'Ana')`);
  await pool.query(`INSERT INTO sites (id, owner_id, name) VALUES ('${SITE}', '${OWNER}', 'Café')`);
});
after(() => pool?.end());

test("a first save creates rev 1 and writes audit", async () => {
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: doc("Hola"), expectedRev: 0, actorType: "user" });
  assert.equal(r.ok, true);
  assert.equal(r.rev, 1);
  const audit = await withUser(pool, OWNER, async (tx) => (await tx.query("SELECT action, meta FROM audit_log")).rows);
  assert.equal(audit.filter((a) => a.action === "draft.save").length, 1);
  assert.equal(audit[0].meta.rev, 1);
});

test("a stale revision is a conflict, not an overwrite", async () => {
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: doc("Pisado"), expectedRev: 0, actorType: "user" });
  assert.deepEqual(r, { ok: false, reason: "conflict", currentRev: 1 });
  const loaded = await loadDraft(pool, OWNER, SITE);
  assert.equal(loaded.doc.pages[0].sections[0].props.headline, "Hola");
});

test("a valid revision advances and keeps only the latest draft", async () => {
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: doc("Segundo"), expectedRev: 1, actorType: "user" });
  assert.equal(r.ok, true);
  assert.equal(r.rev, 2);
  const loaded = await loadDraft(pool, OWNER, SITE);
  assert.equal(loaded.rev, 2);
  assert.equal(loaded.doc.pages[0].sections[0].props.headline, "Segundo");
});

test("an invalid document never reaches the database", async () => {
  const bad = doc("x");
  bad.pages[0].sections[0].type = "raw_html";
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: bad, expectedRev: 2, actorType: "agent" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid");
  assert.equal((await loadDraft(pool, OWNER, SITE)).rev, 2);
});

test("findings come back on save but do not block it", async () => {
  const d = doc("x");
  d.pages[0].seo.title = "";
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: d, expectedRev: 2, actorType: "user" });
  assert.equal(r.ok, true);
  assert.ok(r.findings.some((f) => f.code === "MISSING_TITLE"));
});

test("an agent save is recorded as agent in audit", async () => {
  const r = await saveDraft(pool, { userId: OWNER, siteId: SITE, doc: doc("Agente"), expectedRev: 3, actorType: "agent" });
  assert.equal(r.ok, true);
  const rows = await withUser(pool, OWNER, async (tx) =>
    (await tx.query("SELECT actor_type FROM audit_log WHERE action = 'draft.save' ORDER BY at DESC LIMIT 1")).rows);
  assert.equal(rows[0].actor_type, "agent");
});
