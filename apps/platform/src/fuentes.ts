// Fuentes de las fotos, en un archivo del sitio. NUNCA en la pagina.
//
// La licencia de Pexels no exige atribucion visible, asi que la web no lleva
// creditos (decision literal del dueno). Lo que si queda es la trazabilidad: de
// donde salio cada imagen, quien la hizo y bajo que licencia. Se guarda por
// sitio, en `<sitesRoot>/<siteId>/FUENTES.md`.
//
// El formato es una tabla Markdown porque el archivo lo lee una persona. La
// generacion es una funcion pura (`fuentesMarkdown`) para poder probarla sin
// disco; la escritura solo anade, nunca reescribe la historia.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Mismo UUID que exige `assertSiteId` (@webdesign/storage). Se repite aqui en vez
// de importar el paquete porque `platform` no lo tiene como dependencia y no
// merece una entrada nueva en `package.json` por una comprobacion de formato:
// el `siteId` se interpola en una RUTA, y una ruta se valida o se sale de ella.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FuenteRow {
  /** Id del asset registrado. Es lo que permite cruzarlo con las releases. */
  assetId: string;
  author: string;
  /** Enlace a la ficha de la foto en el banco de origen. */
  sourceUrl: string;
  license: string;
  /** Fecha en ISO corto (AAAA-MM-DD). */
  date: string;
}

const HEADER = "| Asset | Autor | Enlace | Licencia | Fecha |\n| --- | --- | --- | --- | --- |";

// Un `|` dentro de un campo rompe la tabla y una celda vacia la desalinea, asi
// que se escapa o se marca. Tambien se quitan saltos de linea: una celda es una
// linea de Markdown, no un parrafo.
function cell(value: string): string {
  const clean = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return clean === "" ? "—" : clean.replace(/\|/g, "\\|");
}

/** Una fila de la tabla, con su salto de linea. */
export function fuenteFila(r: FuenteRow): string {
  return `| ${cell(r.assetId)} | ${cell(r.author)} | ${cell(r.sourceUrl)} | ${cell(r.license)} | ${cell(r.date)} |\n`;
}

export function fuentesMarkdown(rows: FuenteRow[]): string {
  return [
    "# Fuentes de las imágenes",
    "",
    "Este archivo no se publica en la web: la licencia de Pexels no exige",
    "atribución visible. Queda aquí como trazabilidad de cada foto usada.",
    "",
    HEADER,
    ...rows.map((r) => fuenteFila(r).trimEnd()),
    "",
  ].join("\n");
}

/** Ruta del archivo de fuentes de un sitio. `siteId` se valida: es un UUID. */
export function fuentesPath(sitesRoot: string, siteId: string): string {
  if (!UUID.test(siteId)) throw new Error("invalid siteId: must be a UUID");
  return join(sitesRoot, siteId, "FUENTES.md");
}

/**
 * Anade una fila al archivo de fuentes del sitio.
 *
 * No lanza: si no se puede escribir, la subida de la foto ya se hizo y no se
 * deshace por un fallo de documentacion. Como mucho deja un `console.warn`.
 */
export async function appendFuente(sitesRoot: string, siteId: string, row: FuenteRow): Promise<boolean> {
  let path: string;
  try {
    path = fuentesPath(sitesRoot, siteId);
  } catch (error) {
    console.warn("fuentes_write_failed", { siteId, error: String((error as Error).message || error) });
    return false;
  }
  try {
    let base: string;
    try {
      base = await readFile(path, "utf8");
      // Un archivo creado a mano puede no acabar en salto: se normaliza.
      if (!base.endsWith("\n")) base += "\n";
    } catch {
      // Todavia no hay archivo: se crea con la cabecera, no con una tabla huerfana.
      base = fuentesMarkdown([]);
    }
    await mkdir(dirname(path), { recursive: true });
    // Escritura atomica: el archivo nunca queda a medias.
    const tmp = `${path}.tmp`;
    await writeFile(tmp, base + fuenteFila(row), "utf8");
    await rename(tmp, path);
    return true;
  } catch (error) {
    console.warn("fuentes_write_failed", { siteId, error: String((error as Error).message || error) });
    return false;
  }
}
