import { PENDING_MARKER, describeFromText, type Described } from "@webdesign/agent-design";

// Herencia del brief en un rediseño (T-028).
//
// El panel manda a `POST /api/sites/:id/design-runs` solo lo que el dueño
// contestó EN ESA SESIÓN. Cuando pide un rediseño sin volver a dar sus datos, el
// brief llega casi vacío, `normalizeBrief` no encuentra nada que heredar y
// `draftSite` reconstruye el sitio desde cero: el negocio se encoge a una landing
// y pierde sus páginas y su `meta.name`.
//
// El documento guardado ya sabe todo eso. Aquí se lee de vuelta y se completa el
// brief SOLO en los huecos: lo que el dueño acaba de escribir en el chat manda
// siempre. Esta completitud va antes de `normalizeBrief` (la hace el worker al
// recibir el trabajo), para que `pending` se calcule con los datos heredados y la
// página no vuelva a pedir lo que ya sabe.
//
// Nada de esto inventa: cada campo sale de un sitio concreto del documento, y lo
// que no está se queda sin heredar.

/** Topes de `quickBriefSchema`. Un heredado más largo haría fallar el brief entero. */
const MAX = { businessType: 120, name: 80, city: 80, service: 200, contact: 200 } as const;

/**
 * ¿Sirve como dato? Vacío, sólo espacios o el propio marcador no sirven: el
 * marcador ya está en el documento y volver a heredarlo lo dejaría como si fuera
 * un dato del dueño.
 */
function dato(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const limpio = value.trim();
  if (limpio === "" || limpio.toLowerCase() === PENDING_MARKER) return undefined;
  return limpio;
}

/** Recorta al tope del campo sin dejar espacio suelto al final. */
function acotar(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd();
}

interface PartesDelBrief {
  businessType?: string;
  city?: string;
  name?: string;
  service?: string;
  contact?: string;
}

/** Prefijo de las partes con nombre propio en `design.brief`. */
const PREFIJOS: Record<string, "name" | "service" | "contact"> = {
  nombre: "name",
  servicio: "service",
  contacto: "contact",
};

/**
 * Lee `design.brief`, que `designBrief` compone con un formato fijo:
 * `"<tipo> en <ciudad>; nombre: …; servicio: …; contacto: …"`.
 *
 * Las partes con prefijo no tienen ambigüedad. La cabeza sí: sólo se parte por
 * " en ". Cuando la cabeza es una sola palabra no se puede saber si es el tipo
 * de negocio o la ciudad (`designBrief` quita con `known()` lo que falta), y
 * adivinar metería una ciudad en el titular o un tipo inventado en el brief. En
 * ese caso no se hereda nada de la cabeza: `ownerPrompt` cubre el hueco.
 */
function partesDelBrief(texto: unknown): PartesDelBrief {
  const raw = dato(texto);
  if (raw === undefined) return {};
  const out: PartesDelBrief = {};
  for (const parte of raw.split(";")) {
    const trozo = parte.trim();
    if (trozo === "") continue;
    const prefijo = /^(nombre|servicio|contacto)\s*:\s*(.+)$/i.exec(trozo);
    if (prefijo !== null) {
      const clave = PREFIJOS[(prefijo[1] as string).toLowerCase()];
      const valor = dato(prefijo[2]);
      if (clave !== undefined && valor !== undefined && out[clave] === undefined) out[clave] = valor;
      continue;
    }
    const lugar = /^(.+?)\s+en\s+(.+)$/i.exec(trozo);
    if (lugar === null) continue;
    const tipo = dato(lugar[1]);
    const ciudad = dato(lugar[2]);
    if (tipo !== undefined) out.businessType ??= tipo;
    if (ciudad !== undefined) out.city ??= ciudad;
  }
  return out;
}

/** Secciones de cualquier página del documento, tolerando un documento a medias. */
function secciones(doc: unknown): Array<{ type?: unknown; props?: unknown }> {
  if (doc === null || typeof doc !== "object") return [];
  const pages = (doc as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const out: Array<{ type?: unknown; props?: unknown }> = [];
  for (const page of pages) {
    const sections = (page as { sections?: unknown } | null)?.sections;
    if (!Array.isArray(sections)) continue;
    for (const s of sections) if (s !== null && typeof s === "object") out.push(s as { type?: unknown; props?: unknown });
  }
  return out;
}

/**
 * Contacto del dueño tal como quedó en la sección `contact` del documento.
 *
 * El brief lleva UN contacto en lenguaje natural y `ownerContact` acepta correo o
 * teléfono, no los dos. Se prefiere el correo: es el que el dueño escribe para
 * que le lleguen los mensajes del formulario.
 */
function contactoDelDocumento(doc: unknown): string | undefined {
  for (const s of secciones(doc)) {
    if (s.type !== "contact") continue;
    const props = (s.props ?? {}) as { email?: unknown; phone?: unknown };
    const email = dato(props.email);
    if (email !== undefined) return email;
    const phone = dato(props.phone);
    if (phone !== undefined) return phone;
  }
  return undefined;
}

/**
 * Campos que el documento sabe y el cuerpo no trae, listos para el brief.
 *
 * Devuelve sólo los huecos: nunca un campo que el cuerpo ya trae con valor.
 * - `name`: `meta.name`.
 * - `businessType` y `city`: la cabeza de `design.brief` (formato fijo); si no
 *   está, `describeFromText` sobre `design.ownerPrompt`, que es la frase que
 *   escribió el dueño y de la que ya se sacan tipo y ciudad (T-011).
 * - `service`: la parte `servicio:` de `design.brief`.
 * - `contact`: la sección `contact` (correo, o teléfono si no hay correo).
 */
function heredados(provided: Record<string, unknown>, doc: unknown): Record<string, string> {
  if (doc === null || typeof doc !== "object") return {};
  const out: Record<string, string> = {};
  const falta = (k: keyof typeof MAX) => dato(provided[k]) === undefined;

  const meta = (doc as { meta?: { name?: unknown } }).meta;
  const nombre = dato(meta?.name);
  if (nombre !== undefined && falta("name")) out.name = acotar(nombre, MAX.name);

  const design = (doc as { design?: { brief?: unknown; ownerPrompt?: unknown } }).design;
  const partes = partesDelBrief(design?.brief);
  // La frase del dueño sólo rellena lo que la cabeza no dio: lo que compone
  // `designBrief` con los campos es más exacto que lo que se lee de una frase.
  const descrito: Described = partes.businessType === undefined || partes.city === undefined
    ? describeFromText(dato(design?.ownerPrompt) ?? "")
    : {};

  const tipo = partes.businessType ?? descrito.businessType;
  if (tipo !== undefined && falta("businessType")) out.businessType = acotar(tipo, MAX.businessType);
  const ciudad = partes.city ?? descrito.city;
  if (ciudad !== undefined && falta("city")) out.city = acotar(ciudad, MAX.city);
  if (partes.service !== undefined && falta("service")) out.service = acotar(partes.service, MAX.service);

  const contacto = contactoDelDocumento(doc);
  if (contacto !== undefined && falta("contact")) out.contact = acotar(contacto, MAX.contact);
  return out;
}

/**
 * Cuerpo del brief completado con lo que ya sabe el documento.
 *
 * `doc` es el `site_drafts.doc` del sitio, o `undefined` si todavía no hay
 * borrador: entonces se devuelve el cuerpo tal cual y todo se comporta como
 * antes (el brief vacío se sigue rechazando con 400).
 */
export function completeBriefInput(body: unknown, doc: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = body !== null && typeof body === "object"
    ? { ...(body as Record<string, unknown>) }
    : {};
  return { ...base, ...heredados(base, doc) };
}
