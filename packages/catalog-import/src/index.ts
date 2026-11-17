// @webdesign/catalog-import — trae el catalogo de diseno de fuentes abiertas y lo
// adapta al shape de la plataforma (spec 7.5).
//
// Principio: adaptar, no copiar. Cada dato de origen se mide y se traduce a lo que
// el renderer sabe pintar; lo que no encaja entra degradado con su motivo escrito,
// nunca se descarta en silencio ni se rellena con una invencion.

export { parseCsv, slug } from "./csv.js";
export { MIN_CONTRAST, isHex, normalizePalette, type PaletteIn, type PaletteOut, type Verdict } from "./palette.js";
export {
  KNOWN_FAMILIES,
  SCALES,
  mapFamily,
  normalizePairing,
  normalizeScale,
  normalizeSections,
  assertKnownSections,
  type FamilyMapping,
  type KnownFamily,
  type PairingOut,
  type Scale,
  type SectionsOut,
} from "./typography.js";
export {
  LICENSE,
  LICENSE_URL,
  SOURCE,
  SOURCE_COMMIT,
  VERIFIED_AT,
  buildReport,
  type ImportReport,
  type PaletteRow,
  type PairingRow,
  type PatternRow,
  type ProductRow,
  type StyleRow,
} from "./build.js";
export { lit, sqlForPalettes, sqlForPairings, sqlForPatterns, sqlForProducts, sqlForReport, sqlForStyles } from "./sql.js";
