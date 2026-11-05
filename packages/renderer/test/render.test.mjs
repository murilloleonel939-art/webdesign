import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSite, escapeHtml } from "../dist/index.js";

const doc = { schemaVersion: 1, blocks: [{ type: "hero", id: "h1" }, { type: "text", id: "t1" }] };

test("escapes user text", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  const html = renderSite(doc, { h1: { text: "<img src=x onerror=alert(1)>" } });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("renders blocks in order with CSP and lang", () => {
  const html = renderSite(doc, { h1: { text: "Hola" }, t1: { text: "Texto" } }, "en");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.indexOf("Hola") < html.indexOf("Texto"));
});

test("rejects unknown block types", () => {
  assert.throws(() => renderSite({ schemaVersion: 1, blocks: [{ type: "raw_html", id: "x" }] }, {}));
});
