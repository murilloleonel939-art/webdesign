import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";

// El dueno del sitio no es programador: findingLabel() (ui/panel.tsx) debe
// traducir TODOS los codigos de hallazgo a castellano llano. Esta prueba lee
// los codigos de las fuentes reales (no los copia a mano) para que un codigo
// nuevo en el linter estatico o en el visual la haga fallar en vez de llegar
// crudo, en ingles, a la pantalla del dueno (el bug real: SLOP_HEADING_SKIP).

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

// --- extraer findingLabel() de ui/panel.tsx sin montar React/Puck -------
const panelSrc = readFileSync(join(here, "..", "ui", "panel.tsx"), "utf8");
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start !== -1, `no se encontro function ${name} en panel.tsx`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`llave sin cerrar para function ${name}`);
}
const findingLabelTs = extractFunction(panelSrc, "findingLabel");
const { code: findingLabelJs } = transformSync(findingLabelTs, { loader: "ts" });
const findingLabel = new Function(`${findingLabelJs}\nreturn findingLabel;`)();

// --- leer los 42 codigos reales de las dos fuentes -----------------------
function severityCodes() {
  const src = readFileSync(join(root, "packages/lint-visual/src/base.ts"), "utf8");
  const block = src.slice(src.indexOf("const SEVERITY"), src.indexOf("};", src.indexOf("const SEVERITY")));
  return [...block.matchAll(/^\s*([A-Z][A-Z0-9_]+):\s*"(?:error|warning|info)"/gm)].map((m) => m[1]);
}
function linterCodes() {
  const src = readFileSync(join(root, "packages/linter/src/index.ts"), "utf8");
  return [...src.matchAll(/code:\s*"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]);
}

const allCodes = [...new Set([...severityCodes(), ...linterCodes()])];

test("findingLabel() lee codigos reales de ambas fuentes (sanidad del fixture)", () => {
  assert.ok(allCodes.length >= 40, `se esperaban ~42 codigos, se leyeron ${allCodes.length}`);
});

test("findingLabel() tiene etiqueta en castellano para todos los codigos de SEVERITY y del linter", () => {
  const sinEtiqueta = allCodes.filter((code) => {
    const label = findingLabel(code);
    // "cruda" = la etiqueta es exactamente el codigo (el fallback devolvia
    // `code` tal cual; esto es justo lo que vio el dueno del sitio).
    return typeof label !== "string" || label === code;
  });
  assert.deepEqual(sinEtiqueta, [], `codigos sin traducir (llegan crudos al dueno): ${sinEtiqueta.join(", ")}`);
});

test("el fallback de findingLabel() nunca es el codigo crudo, ni para codigos desconocidos", () => {
  const label = findingLabel("UN_CODIGO_QUE_NO_EXISTE_TODAVIA");
  assert.notEqual(label, "UN_CODIGO_QUE_NO_EXISTE_TODAVIA");
  assert.ok(label.length > 0);
  assert.ok(!/^[A-Z0-9_]+$/.test(label), "el fallback no debe parecer un codigo en mayusculas crudo");
});
