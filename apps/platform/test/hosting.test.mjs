import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, statSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugifyLabel, isReserved, labelFor, linkHost, unlinkHost } from "../dist/hosting.js";

test("la etiqueta DNS es valida para cualquier nombre de sitio", () => {
  assert.equal(slugifyLabel("Panadería Luna"), "panaderia-luna");
  assert.equal(slugifyLabel("Ñoño Ñandú"), "nono-nandu");
  // Un nombre de solo simbolos no puede producir un hostname vacio.
  assert.equal(slugifyLabel("---"), "");
  assert.equal(slugifyLabel("a"), "");
  // Una etiqueta DNS no puede empezar por numero.
  assert.equal(slugifyLabel("123"), "s-123");
  assert.ok(slugifyLabel("x".repeat(80)).length <= 63);
});

test("dos sitios con el mismo nombre no colisionan", () => {
  const a = labelFor("Panaderia Luna", "5f9aecb9-dd51-4397-8f89-467eff25bb81");
  const b = labelFor("Panaderia Luna", "3c7edd4b-3e27-43f4-87b8-4d5c83a3051a");
  assert.notEqual(a, b);
  assert.match(a, /^[a-z0-9-]+$/);
});

test("los subdominios sensibles quedan reservados", () => {
  for (const r of ["banco", "pago", "app", "admin", "paypal", "verificacion"]) {
    assert.equal(isReserved(r), true, r);
  }
  assert.equal(isReserved("panaderia"), false);
});

test("el enlace de host apunta a la release publicada y se puede deshacer", () => {
  const root = mkdtempSync(join(tmpdir(), "hosts-"));
  const sites = join(root, "sites");
  const hosts = join(root, "hosts");
  mkdirSync(join(sites, "s1", "public"), { recursive: true });

  linkHost(hosts, "pan.luna.test", sites, "s1");
  const link = join(hosts, "pan.luna.test");
  assert.ok(existsSync(link));
  // Caddy sirve este enlace: debe ser un directorio con el contenido publicado.
  assert.ok(statSync(link).isDirectory());
  assert.equal(readlinkSync(link), join(sites, "s1", "public"));

  // Republicar no debe romper el enlace ni dejar temporales sueltos.
  linkHost(hosts, "pan.luna.test", sites, "s1");
  linkHost(hosts, "PAN.LUNA.TEST", sites, "s1");
  assert.equal(readlinkSync(link), join(sites, "s1", "public"));

  unlinkHost(hosts, "pan.luna.test");
  assert.equal(existsSync(link), false);
  // Desenlazar algo que no existe no debe fallar.
  unlinkHost(hosts, "no-existe.test");
  rmSync(root, { recursive: true, force: true });
});
