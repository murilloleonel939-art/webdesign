import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const caddy = readFileSync(new URL("./Caddyfile", import.meta.url), "utf8");

test("Caddy sirve por host, separa formularios/chat y protege headers", () => {
  assert.match(caddy, /root \* \/data\/hosts\/\{host\}/);
  assert.match(caddy, /handle \/_f\/\* \{[\s\S]*reverse_proxy platform:3000/);
  assert.match(caddy, /handle \/_c\/\* \{[\s\S]*reverse_proxy platform:3000/);
  assert.match(caddy, /file_server/);
  assert.match(caddy, /X-Content-Type-Options "nosniff"/);
  // El CSP del borde se intersecta con el <meta> del renderer: tiene que
  // permitir el <style> en linea del tema y las imagenes incrustadas, o los
  // bloquea aunque el sitio los emita bien.
  const csp = caddy.match(/Content-Security-Policy "([^"]*)"/)?.[1] ?? "";
  assert.match(csp, /style-src[^;]*'unsafe-inline'/);
  assert.match(csp, /img-src[^;]*data:/);
  assert.match(caddy, /header @html Cache-Control "no-cache"/);
  assert.match(caddy, /respond @badhost 404/);
});

test("Caddy no expone administracion y mantiene datos fuera de sites", () => {
  assert.match(caddy, /admin off/);
  assert.match(caddy, /storage file_system \/caddy-data/);
  assert.doesNotMatch(caddy, /root \* \/caddy-data/);
});
