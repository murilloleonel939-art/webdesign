// CI: falla si una clave existe en un idioma y no en el otro.
import { readFileSync } from "node:fs";
const load = (l) => JSON.parse(readFileSync(new URL(`../packages/i18n/locales/${l}.json`, import.meta.url), "utf8"));
const es = Object.keys(load("es")), en = Object.keys(load("en"));
const missingEn = es.filter((k) => !en.includes(k));
const missingEs = en.filter((k) => !es.includes(k));
if (missingEn.length || missingEs.length) {
  console.error("i18n mismatch", { missingEn, missingEs });
  process.exit(1);
}
console.log(`i18n ok: ${es.length} keys in es and en`);
