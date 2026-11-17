#!/usr/bin/env node
// Uso:
//   node bin/import.mjs --dry-run          informe: cuantas filas entran y por que caen
//   node bin/import.mjs --sql > out.sql    SQL idempotente para revisar o aplicar
//
// No conecta a la base. Escribir en produccion es aplicar el SQL generado con el
// rol de migracion, igual que cualquier otra migracion: queda revisado en el diff.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, parseCsv, sqlForReport, SOURCE_COMMIT } from "../dist/index.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const read = (name) => parseCsv(readFileSync(join(DATA, `${name}.csv`), "utf8"));

const report = buildReport({
  colors: read("colors"),
  typography: read("typography"),
  landing: read("landing"),
  products: read("products"),
  styles: read("styles"),
});

const mode = process.argv[2] ?? "--dry-run";

if (mode === "--sql") {
  process.stdout.write(sqlForReport(report));
} else if (mode === "--dry-run") {
  const count = (rows) => ({
    active: rows.filter((r) => r.status === "active").length,
    supplemental: rows.filter((r) => r.status === "supplemental").length,
  });
  const tabla = {
    estilos_referencia: count(report.styles),
    paletas: count(report.palettes),
    parejas_tipograficas: count(report.pairings),
    patrones_landing: count(report.patterns),
    tipos_producto: count(report.products),
  };
  console.log(`Origen: ui-ux-pro-max @ ${SOURCE_COMMIT.slice(0, 12)}`);
  console.table(tabla);
  // Motivos agregados: es lo que el operador necesita para decidir.
  const motivos = new Map();
  for (const r of [...report.palettes, ...report.pairings, ...report.patterns, ...report.styles]) {
    for (const m of r.reasons) {
      const clave = m.replace(/[\d.]+/g, "N").replace(/^traducida: .*/, "traducida a familia del sistema");
      motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
    }
  }
  console.log("Motivos de supplemental:");
  for (const [m, n] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${m}`);
  console.log(`Descartadas: ${report.skipped.length}`);
} else {
  console.error(`modo desconocido: ${mode} (usa --dry-run o --sql)`);
  process.exit(2);
}
