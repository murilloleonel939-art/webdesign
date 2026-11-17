// Lector de CSV minimo y estricto (RFC 4180: comillas dobles, comas y saltos de
// linea dentro de campo). Sin dependencia externa: los datos de origen son unos
// cientos de filas y una libreria mas es otra cosa que auditar.

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // BOM al principio de archivos guardados desde Excel.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (quoted) throw new Error("CSV mal formado: comilla sin cerrar");

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells) => {
    const out: Record<string, string> = {};
    header.forEach((h, idx) => {
      out[h.trim()] = (cells[idx] ?? "").trim();
    });
    return out;
  });
}

// Id estable a partir de un nombre: la importacion es idempotente (ON CONFLICT)
// solo si el mismo origen produce siempre el mismo id.
export function slug(prefix: string, name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${prefix}-${base || "sin-nombre"}`;
}
