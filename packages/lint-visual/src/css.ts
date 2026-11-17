// Parser CSS minimo para el linter visual (spec 6.5).
//
// No se usa un motor de navegador: el linter corre en `workers` y en CI, y
// jsdom no calcula layout. Lo que si se puede hacer sin navegador es leer las
// declaraciones del CSS que el propio renderer genera y razonar sobre ellas.
// Por eso este parser existe: la mayoria de las reglas de 6.5 son propiedades
// del CSS, no medidas de pixeles.

export interface Rule {
  selectors: string[];
  decls: Record<string, string>;
}

/** Quita comentarios para que no confundan al tokenizador. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Aplana el CSS en reglas sueltas. No se resuelven anidamientos ni `@media`
 * como estructura: las at-rules se devuelven aparte porque
 * SLOP_UNRESPONSIVE_GRID necesita saber que existe una consulta de 768px.
 */
export function parseCss(css: string): { rules: Rule[]; atRules: { name: string; params: string; body: string }[] } {
  const clean = stripComments(css);
  const rules: Rule[] = [];
  const atRules: { name: string; params: string; body: string }[] = [];

  let i = 0;
  while (i < clean.length) {
    const open = clean.indexOf("{", i);
    if (open === -1) break;
    const prelude = clean.slice(i, open).trim();

    // Recorrer hasta la llave que cierra, contando profundidad por si el bloque
    // contiene otros bloques (caso de @media).
    let depth = 1;
    let j = open + 1;
    while (j < clean.length && depth > 0) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") depth--;
      j++;
    }
    const body = clean.slice(open + 1, j - 1);

    if (prelude.startsWith("@")) {
      const m = /^@([\w-]+)\s*([^{]*)$/.exec(prelude);
      atRules.push({ name: m?.[1] ?? "", params: (m?.[2] ?? "").trim(), body });
      // Las reglas dentro de @media se aplanan: interesa saber que existen y
      // que selectores tocan.
      if (m?.[1] === "media") {
        for (const inner of parseCss(body).rules) rules.push(inner);
      }
    } else if (prelude) {
      const decls: Record<string, string> = {};
      for (const part of body.split(";")) {
        const colon = part.indexOf(":");
        if (colon === -1) continue;
        const prop = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (prop && value) decls[prop] = value;
      }
      rules.push({
        selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean),
        decls,
      });
    }
    i = j;
  }
  return { rules, atRules };
}

/** Extrae el contenido de los `<style>` del HTML generado. */
export function inlineStyles(html: string): string[] {
  const out: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1] ?? "");
  return out;
}

/** Lee los `--token` declarados en `:root`, que es como emite el tema. */
export function cssVariables(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of parseCss(css).rules) {
    if (!rule.selectors.includes(":root")) continue;
    for (const [prop, value] of Object.entries(rule.decls)) {
      if (prop.startsWith("--")) out[prop] = value;
    }
  }
  return out;
}

/** Sustituye `var(--x)` por su valor para poder comparar colores y medidas. */
export function resolveVars(value: string, vars: Record<string, string>): string {
  let out = value;
  // Dos pasadas: los tokens del tema pueden referirse a otros.
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => {
      return vars[name] ?? fallback ?? "";
    });
  }
  return out.trim();
}
