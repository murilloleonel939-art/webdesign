import { z } from "zod";
import { PENDING_MARKER, containsMarker, type QuickBrief } from "./brief.js";
import { heroHeadline } from "./draft.js";
import { genericCopy } from "./generic-copy.js";

// Textos del sitio escritos por el modelo (spec 9.1, `generate_copy`).
//
// 9.1 permite que el modelo redacte los textos, pero le prohíbe inventar datos:
// clientes, cifras, años, premios, certificaciones, precios, testimonios, citas,
// direcciones y teléfonos. Aquí hay dos piezas que lo sostienen:
//
//   - `copyPrompt`: el encargo, con las reglas escritas literalmente.
//   - `guardCopy`: la guardia DETERMINISTA que no depende de que el modelo
//     obedezca. Lo que suena a dato inventado se cae del copy, no se publica.
//
// La guardia no interpreta: busca dígitos, símbolos de moneda y un puñado de
// palabras que solo se dicen con datos detrás. La única excepción es la cifra
// que el dueño escribió literalmente en cualquier campo del brief: esa no la
// inventó el modelo. Reclamos, dinero y el marcador se podan siempre (ver
// `hasInvention`).

/**
 * Topes por campo. El esquema los usa tal cual y `normalizeCopy` recorta a ellos
 * antes de validar: un texto un poco largo se recorta, no tumba todo el copy.
 */
export const COPY_LIMITS = {
  businessName: 60,
  businessType: 60,
  heroHeadline: 90,
  heroSubline: 220,
  heroCta: 30,
  servicesHeading: 80,
  serviceTitle: 60,
  serviceBody: 220,
  processHeading: 80,
  processTitle: 50,
  processBody: 180,
  aboutHeading: 80,
  aboutBody: 700,
  faqQ: 140,
  faqA: 400,
  closingHeadline: 90,
  closingCta: 30,
  seoDescription: 155,
  photoQuery: 60,
} as const;

const L = COPY_LIMITS;

/**
 * Forma exacta del JSON que se le pide al modelo.
 *
 * `services` y `process` aceptan desde 1 elemento: el dueño puede dar pocos datos
 * y un copy corto es mejor que ningún copy. Lo que la guardia poda NO se repone:
 * la sección se queda con los items validos o se omite en el borrador.
 */
export const siteCopySchema = z.object({
  businessName: z.string().max(L.businessName).optional(),
  businessType: z.string().max(L.businessType),
  heroHeadline: z.string().min(8).max(L.heroHeadline),
  heroSubline: z.string().max(L.heroSubline),
  heroCta: z.string().max(L.heroCta),
  servicesHeading: z.string().max(L.servicesHeading),
  services: z
    .array(z.object({ title: z.string().max(L.serviceTitle), body: z.string().max(L.serviceBody) }))
    .min(1)
    .max(6),
  processHeading: z.string().max(L.processHeading),
  process: z
    .array(z.object({ title: z.string().max(L.processTitle), body: z.string().max(L.processBody) }))
    .min(1)
    .max(4),
  aboutHeading: z.string().max(L.aboutHeading),
  aboutBody: z.string().max(L.aboutBody),
  faq: z.array(z.object({ q: z.string().max(L.faqQ), a: z.string().max(L.faqA) })).max(5),
  closingHeadline: z.string().max(L.closingHeadline),
  closingCta: z.string().max(L.closingCta),
  seoDescription: z.string().max(L.seoDescription),
  // Búsquedas de fotos genéricas del sector, en inglés (B1). Opcionales: sin ellas
  // el sitio sale sin fotos. `normalizeCopy` descarta el campo si viene mal.
  photoQueries: z
    .object({ hero: z.string().max(L.photoQuery), gallery: z.string().max(L.photoQuery) })
    .optional(),
});

export type SiteCopy = z.infer<typeof siteCopySchema>;

/** Los datos del brief que el dueño sí dio, en texto plano para el encargo. */
function briefLines(brief: QuickBrief): string {
  const lines = [
    `Tipo de negocio: ${brief.businessType}`,
    `Nombre: ${brief.name}`,
    `Ciudad: ${brief.city}`,
    `Servicio principal: ${brief.service}`,
  ];
  if (brief.description !== undefined) lines.push(`Lo que cuenta el dueno: ${brief.description}`);
  return lines.join("\n");
}

/**
 * Encargo al modelo: solo JSON con las claves del esquema, en español.
 *
 * Las reglas van LITERALES y al final, que es donde más pesan: el modelo tiende a
 * rellenar con "más de 10 años de experiencia" cuando el hueco se queda vacío.
 */
export function copyPrompt(brief: QuickBrief): string {
  return [
    "Escribe los textos de la pagina web de este negocio.",
    "",
    "Datos que el dueno ha dado:",
    briefLines(brief),
    "",
    brief.businessType === PENDING_MARKER
      ? "El tipo de negocio no esta confirmado: describelo de la forma mas general posible, sin afirmar nada que no se sepa."
      : "",
    "",
    "Responde SOLO con un objeto JSON, sin explicacion y sin texto alrededor, con",
    "exactamente estas claves: businessName, businessType, heroHeadline,",
    "heroSubline, heroCta, servicesHeading, services, processHeading, process,",
    "aboutHeading, aboutBody, faq, closingHeadline, closingCta, seoDescription,",
    "photoQueries.",
    "services es una lista de 3 a 6 objetos {title, body} (si no das tres datos,",
    "los que sepas, al menos uno); process una lista de 3 a 4 objetos {title, body};",
    "faq una lista de 0 a 5 objetos {q, a}.",
    "photoQueries es {hero, gallery}: dos busquedas EN INGLES de 2 a 4 palabras para",
    "fotos genericas del sector (una escena, por ejemplo 'coffee shop interior').",
    "Sin marcas, sin nombres de personas y sin texto en la imagen.",
    "",
    "Tono profesional y concreto, escrito para el cliente final del negocio: quien",
    "va a leer la pagina quiere saber que le ofreceis y como empezar. Frases cortas.",
    "Escribe en espanol de Espana, en segunda persona del plural o impersonal.",
    "",
    "Reglas obligatorias:",
    "- No inventes cifras, anos, porcentajes, numero de clientes, premios,",
    "  certificaciones, precios, testimonios, direcciones ni telefonos.",
    "- Si algo no se sabe, escribe sin ello: no lo rellenes con un dato plausible.",
    "- Las preguntas frecuentes, solo sobre como trabajar con el negocio; sin",
    "  plazos ni precios concretos.",
    "- No menciones marcas, personas ni entidades que no aparezcan en los datos.",
    "- No uses la palabra 'pendiente' ni dejes huecos: escribe frases completas.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// --- Lectura tolerante ------------------------------------------------------

/**
 * Recorta a `max` caracteres en límite de palabra. Nunca deja espacio ni coma
 * colgando al final. Si no hay espacio razonable, corta en duro.
 */
export function trimWord(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const base = space >= max * 0.5 ? cut.slice(0, space) : cut;
  return base.replace(/[\s,;:\-–]+$/u, "");
}

type Obj = Record<string, unknown>;

function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = trimWord(value, max);
  return t === "" ? undefined : t;
}

/** Lista: descarta lo que no pase `pick` y recorta a `max` elementos. */
function listOf(value: unknown, max: number, pick: (o: Obj) => Obj | undefined): unknown {
  if (!Array.isArray(value)) return value;
  const out: Obj[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const kept = pick(item as Obj);
    if (kept) out.push(kept);
    if (out.length === max) break;
  }
  return out;
}

const pairOf = (titleMax: number, bodyMax: number) => (o: Obj): Obj | undefined => {
  const title = asText(o["title"], titleMax);
  const body = asText(o["body"], bodyMax);
  return title && body ? { title, body } : undefined;
};

const qaOf = (o: Obj): Obj | undefined => {
  const q = asText(o["q"], L.faqQ);
  const a = asText(o["a"], L.faqA);
  return q && a ? { q, a } : undefined;
};

/**
 * Forma del copy antes de validar: recorta textos a su tope, descarta items sin
 * los campos que llevan y tira `photoQueries` si viene mal. No inventa nada: un
 * campo que falta sigue faltando y el esquema lo dice.
 */
export function normalizeCopy(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const o = raw as Obj;
  const pq = o["photoQueries"];
  const photo =
    typeof pq === "object" && pq !== null
      ? { hero: asText((pq as Obj)["hero"], L.photoQuery), gallery: asText((pq as Obj)["gallery"], L.photoQuery) }
      : undefined;
  return {
    ...o,
    businessName: asText(o["businessName"], L.businessName),
    businessType: asText(o["businessType"], L.businessType) ?? o["businessType"],
    heroHeadline: asText(o["heroHeadline"], L.heroHeadline) ?? o["heroHeadline"],
    heroSubline: asText(o["heroSubline"], L.heroSubline) ?? o["heroSubline"],
    heroCta: asText(o["heroCta"], L.heroCta) ?? o["heroCta"],
    servicesHeading: asText(o["servicesHeading"], L.servicesHeading) ?? o["servicesHeading"],
    services: listOf(o["services"], 6, pairOf(L.serviceTitle, L.serviceBody)),
    processHeading: asText(o["processHeading"], L.processHeading) ?? o["processHeading"],
    process: listOf(o["process"], 4, pairOf(L.processTitle, L.processBody)),
    aboutHeading: asText(o["aboutHeading"], L.aboutHeading) ?? o["aboutHeading"],
    aboutBody: asText(o["aboutBody"], L.aboutBody) ?? o["aboutBody"],
    faq: listOf(o["faq"], 5, qaOf),
    closingHeadline: asText(o["closingHeadline"], L.closingHeadline) ?? o["closingHeadline"],
    closingCta: asText(o["closingCta"], L.closingCta) ?? o["closingCta"],
    seoDescription: asText(o["seoDescription"], L.seoDescription) ?? o["seoDescription"],
    photoQueries: photo && photo.hero && photo.gallery ? photo : undefined,
  };
}

/** Motivo cerrado de un copy que no sirve: nunca lleva texto del dueño. */
export type CopyReadResult = { ok: true; copy: SiteCopy } | { ok: false; reason: string };

/**
 * Lee la respuesta del modelo como copy. Tolera prosa y bloque ```json antes y
 * después: se toma desde el primer `{` hasta el último `}`.
 *
 * Motivos: `truncated` (se cortó por longitud o le faltan llaves), `empty_text`,
 * `json_parse` y `schema:<rutas>` con hasta cinco campos que no pasan.
 */
export function readCopy(text: string, finishReason: string): CopyReadResult {
  if (finishReason === "length") return { ok: false, reason: "truncated" };
  if (text.trim() === "") return { ok: false, reason: "empty_text" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1) return { ok: false, reason: "json_parse" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    const opens = text.split("{").length - 1;
    const closes = text.split("}").length - 1;
    return { ok: false, reason: opens > closes ? "truncated" : "json_parse" };
  }
  const parsed = siteCopySchema.safeParse(normalizeCopy(raw));
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "raiz"))].slice(0, 5);
    return { ok: false, reason: `schema:${paths.join(",")}` };
  }
  return { ok: true, copy: parsed.data };
}

/**
 * Línea extra del reintento: el motivo del fallo y la orden de ser más corto.
 *
 * `empty_services` no es un fallo de lectura: la guardia podo todos los
 * servicios por llevar datos que el dueno no dio. Decirle al modelo "no se
 * pudo leer" lo hace reintentar a ciegas y repetir la misma cifra inventada,
 * asi que esa familia recibe un texto propio que nombra los datos prohibidos
 * en vez de la causa falsa. El resto (motivos de esquema y cualquier otro) no
 * se toca: no se afirma una causa que no se conoce.
 */
export function retryLine(reason: string): string {
  if (reason === "empty_services") {
    return "Los servicios anteriores se descartaron porque llevaban datos que el dueno no dio (cifras, anos, porcentajes, premios, certificaciones, precios o testimonios). Escribe servicios nuevos sin nada de eso. Responde SOLO el objeto JSON, mas corto: frases breves y listas de 3 a 4 elementos como mucho.";
  }
  return `Tu respuesta anterior no se pudo leer (${reason}). Responde SOLO el objeto JSON, mas corto: frases breves y listas de 3 a 4 elementos como mucho.`;
}

// --- Guardia determinista ---------------------------------------------------

/**
 * Un titular que solo se escribe con datos detrás (T-002.4, Fix C).
 *
 * Cada familia lleva sus flexiones EXPLÍCITAS y `\b` a los dos lados. La
 * versión anterior quitaba el `\b` final para cubrir los plurales, y con eso
 * podaba "liderar" o "liderazgo" (actividades, no reclamos) y seguía dejando
 * pasar "certificaciones". Aquí no hay raíces abiertas: o es una de estas
 * formas, o no es un reclamo.
 *
 * La política (T-002.5) es una sola frase: **se podan las afirmaciones de
 * estado** (sustantivos y participios que presumen algo del negocio) y **se
 * conservan las actividades** (verbos que describen lo que se hace).
 *
 *   - Se podan: premiado/a/os/as, certificado/a/os/as, certificación/es,
 *     garantizado/a/os/as, líder/es, liderazgo/s, nº 1, clientes satisfechos y
 *     años de experiencia.
 *   - No se podan: "liderar", "coliderar", "liderando" (actividades) ni
 *     "certificar" (describe un trámite, no afirma que el negocio lo tenga).
 *
 * "liderazgo" es un sustantivo que presume posición, no una actividad: entra
 * con `azgos?`, para que el plural quede cubierto igual que en las demás
 * familias.
 */
const CLAIM = /\b(clientes satisfechos|años de experiencia|anos de experiencia|premiad[oa]s?|certificad[oa]s?|certificaci[oó]n(es)?|garantizad[oa]s?|l[íi]der(azgos?|es)?|n[ºo°]\s*1)\b/i;
const DIGIT = /\d/;
const MONEY = /[€$%]/;
/** Cifra completa: la misma regex para el texto del modelo y para el corpus del dueño. */
const NUMBER = /\d+([.,]\d+)?/g;

/**
 * Las cifras que escribió el dueño, como tokens completos.
 *
 * El corpus son los campos donde el dueño describe su negocio (T-002.3):
 * `description`, `name`, `businessType`, `city` y `service`. Un campo que
 * contiene el marcador no es un dato suyo y no avala nada.
 *
 * `contact` queda FUERA (T-002.5, hallazgo 1 de seguridad): un teléfono o un
 * correo no autorizan cifras. Con el contacto dentro, un "24" del número
 * validaba "Entrega en 24 horas", un plazo que el dueño nunca dio. El contacto
 * se sigue publicando tal cual en la sección de contacto, que es donde tiene
 * sentido; lo que no hace es acreditar afirmaciones del texto.
 *
 * Se guardan tokens, no el texto (T-002.4, Fix B): con `includes`, el "19" de
 * "Tenemos 19 sucursales" quedaba avalado por el "2019" de "Café 2019".
 */
function ownerNumbers(brief: QuickBrief): Set<string> {
  const corpus = [brief.description, brief.name, brief.businessType, brief.city, brief.service]
    .filter((value): value is string => value !== undefined && value !== PENDING_MARKER && !containsMarker(value))
    .join("\n");
  return new Set(corpus.match(NUMBER) ?? []);
}

/**
 * ¿El texto lleva un dato que el dueño no dio?
 *
 * Una cifra cuenta como del dueño solo si aparece COMPLETA, como token, en algún
 * campo del brief: "2019" avala "2019", nunca "19" ni "201".
 *
 * `CLAIM` y `MONEY` se podan SIEMPRE, aunque el dueño los haya escrito. No es
 * desconfianza hacia el dueño: es que la plataforma no puede avalar "líderes del
 * sector", "premiados" ni un porcentaje. Publicarlo sería poner una afirmación
 * comercial en boca del producto, y quien tendría que defenderla es quien lo
 * publica. Mismo criterio para los importes: un precio que el dueño dictó por
 * chat no es un precio confirmado. Y el marcador tampoco se publica nunca.
 */
function hasInvention(value: string, owned: Set<string>): boolean {
  if (containsMarker(value)) return true;
  if (!DIGIT.test(value) && !MONEY.test(value) && !CLAIM.test(value)) return false;
  // Los reclamos y el dinero no se ablandan con el corpus: se podan igual.
  if (CLAIM.test(value) || MONEY.test(value)) return true;
  return (value.match(NUMBER) ?? []).some((n) => !owned.has(n));
}

/**
 * ¿Se puede publicar este valor del brief tal cual? (T-002.4, Fix D)
 *
 * Es el MISMO predicado de la guardia, aplicado a lo que el dueño escribió antes
 * de interpolarlo en un texto de respaldo. Las cifras del propio dueño pasan; un
 * reclamo, un importe o el marcador no, aunque los haya escrito él. No se sanea
 * recortando palabras: o el dato pasa entero, o no se usa y se cae al neutro.
 */
export function briefValueOk(value: string, brief: QuickBrief): boolean {
  if (value === PENDING_MARKER || value.trim() === "") return false;
  return !hasInvention(value, ownerNumbers(brief));
}

/**
 * Poda los textos inventados de un copy ya validado.
 *
 * Sustituye campo a campo en vez de rechazar el copy entero: perder una ventaja
 * con una cifra es mejor que quedarse sin ningún texto. En listas se cae el item
 * completo; en titulares se usa el titular derivado del brief, que solo dice lo
 * que el dueño escribió.
 */
export function guardCopy(copy: SiteCopy, brief: QuickBrief): { copy: SiteCopy; dropped: string[] } {
  const dropped: string[] = [];
  // Un solo corpus para toda la guardia: las cifras de los seis campos del dueño.
  const corpus = ownerNumbers(brief);
  const headline = heroHeadline(brief);

  const keepText = (field: string, value: string, fallback: string): string => {
    if (!hasInvention(value, corpus)) return value;
    dropped.push(field);
    return fallback;
  };

  // Los respaldos que antes eran `brief.businessType` podian valer el marcador
  // si el dueño no dio el tipo: salen del copy generico, que nunca lo lleva.
  const generic = genericCopy(brief);
  const businessType = keepText("businessType", copy.businessType, generic.businessType);
  const heroCta = keepText("heroCta", copy.heroCta, "Contactar");
  const closingCta = keepText("closingCta", copy.closingCta, "Contactar");

  const services = copy.services.filter((item, i) => {
    const bad = hasInvention(item.title, corpus) || hasInvention(item.body, corpus);
    if (bad) dropped.push(`services[${i}]`);
    return !bad;
  });
  // No se repone nada: la lista se queda con los items validos que haya. El
  // esquema admite desde 1 (normalizeCopy) y el borrador omite la seccion si no
  // queda ninguno, en vez de publicar una tarjeta "pendiente de confirmar".

  const process = copy.process.filter((item, i) => {
    const bad = hasInvention(item.title, corpus) || hasInvention(item.body, corpus);
    if (bad) dropped.push(`process[${i}]`);
    return !bad;
  });

  const faq = copy.faq.filter((item, i) => {
    const bad = hasInvention(item.q, corpus) || hasInvention(item.a, corpus);
    if (bad) dropped.push(`faq[${i}]`);
    return !bad;
  });

  // Se calculan antes del objeto: el fallback del SEO baja por esta cadena
  // (subtitular y, si no hay, titular) en vez de caer a un marcador.
  const heroHeadlineText = keepText("heroHeadline", copy.heroHeadline, headline);
  // El respaldo del subtitular es el servicio del dueño, pero solo si pasa la
  // misma guardia: un respaldo no puede restaurar lo que se acaba de podar.
  const heroSublineText = keepText("heroSubline", copy.heroSubline, briefValueOk(brief.service, brief) ? brief.service : "");
  const seoFallback = trimWord(heroSublineText !== "" ? heroSublineText : heroHeadlineText, 160);

  const guarded: SiteCopy = {
    ...copy,
    businessType,
    heroHeadline: heroHeadlineText,
    heroSubline: heroSublineText,
    heroCta,
    servicesHeading: keepText("servicesHeading", copy.servicesHeading, "Servicios"),
    services,
    processHeading: keepText("processHeading", copy.processHeading, "Como trabajamos"),
    process,
    aboutHeading: keepText("aboutHeading", copy.aboutHeading, generic.aboutHeading),
    // Sin texto propio no se escribe un parrafo de relleno: el vacio hace que el
    // borrador omita la seccion `about` entera (draft.ts).
    aboutBody: keepText("aboutBody", copy.aboutBody, ""),
    faq,
    closingHeadline: keepText("closingHeadline", copy.closingHeadline, "Hablemos"),
    closingCta,
    seoDescription: keepText("seoDescription", copy.seoDescription, seoFallback),
  };
  // `services`, `process`, `aboutBody` y `faq` se quedan sin relleno: si no
  // quedan items validos, la seccion entera se cae en el borrador y el plan dice
  // lo mismo. Nunca se fabrica un paso ni una tarjeta con el marcador.
  return { copy: guarded, dropped };
}
