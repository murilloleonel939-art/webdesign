import { z } from "zod";
import { PENDING_MARKER, type QuickBrief } from "./brief.js";
import { heroHeadline } from "./draft.js";

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
// que el dueño escribió literalmente en `brief.description`: esa no la inventó
// el modelo.

/** Forma exacta del JSON que se le pide al modelo. */
export const siteCopySchema = z.object({
  businessName: z.string().max(60).optional(),
  businessType: z.string().max(60),
  heroHeadline: z.string().min(8).max(90),
  heroSubline: z.string().max(220),
  heroCta: z.string().max(30),
  servicesHeading: z.string().max(80),
  services: z
    .array(z.object({ title: z.string().max(60), body: z.string().max(220) }))
    .min(3)
    .max(6),
  processHeading: z.string().max(80),
  process: z
    .array(z.object({ title: z.string().max(50), body: z.string().max(180) }))
    .min(3)
    .max(4),
  aboutHeading: z.string().max(80),
  aboutBody: z.string().max(700),
  faq: z.array(z.object({ q: z.string().max(140), a: z.string().max(400) })).max(5),
  closingHeadline: z.string().max(90),
  closingCta: z.string().max(30),
  seoDescription: z.string().max(155),
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
    "aboutHeading, aboutBody, faq, closingHeadline, closingCta, seoDescription.",
    "services es una lista de 3 a 6 objetos {title, body}; process una lista de 3",
    "a 4 objetos {title, body}; faq una lista de 0 a 5 objetos {q, a}.",
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

// --- Guardia determinista ---------------------------------------------------

/** Un titular que solo se escribe con datos detrás. */
const CLAIM = /\b(clientes satisfechos|años de experiencia|anos de experiencia|premiad|certificad|garantizad|n[ºo°]\s*1|líder|lider)\b/i;
const DIGIT = /\d/;
const MONEY = /[€$%]/;

const MIN_SERVICES = 3;

const PENDING_PAIR = { title: PENDING_MARKER, body: PENDING_MARKER };

/**
 * ¿El texto lleva un dato que el dueño no dio?
 *
 * Una cifra que aparece LITERAL en `brief.description` no cuenta como invento:
 * la escribió el dueño. Se compara el fragmento numérico, no el texto entero,
 * porque el modelo puede repetir "3" en otra frase.
 */
function hasInvention(value: string, briefDescription: string | undefined): boolean {
  if (!DIGIT.test(value) && !MONEY.test(value) && !CLAIM.test(value)) return false;
  const numbers = value.match(/\d+([.,]\d+)?/g) ?? [];
  const unsupported = numbers.some((n) => !(briefDescription ?? "").includes(n));
  if (unsupported) return true;
  // Sin cifras a la vista sigue habiendo reclamos: "premiados", "100 %" (ya
  // cubierto por MONEY) o "líderes del sector". Nada de eso sale del brief.
  return CLAIM.test(value) || MONEY.test(value);
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
  const desc = brief.description;
  const headline = heroHeadline(brief);

  const keepText = (field: string, value: string, fallback: string): string => {
    if (!hasInvention(value, desc)) return value;
    dropped.push(field);
    return fallback;
  };

  const businessType = keepText("businessType", copy.businessType, brief.businessType);
  const heroCta = keepText("heroCta", copy.heroCta, "Contactar");
  const closingCta = keepText("closingCta", copy.closingCta, "Contactar");

  const services = copy.services.filter((item, i) => {
    const bad = hasInvention(item.title, desc) || hasInvention(item.body, desc);
    if (bad) dropped.push(`services[${i}]`);
    return !bad;
  });
  // Sin el mínimo de 3 el esquema no valida: los huecos se marcan como
  // pendientes en vez de rellenarse con texto inventado.
  while (services.length < MIN_SERVICES) {
    dropped.push(`services[${services.length}]`);
    services.push({ ...PENDING_PAIR });
  }

  const process = copy.process.filter((item, i) => {
    const bad = hasInvention(item.title, desc) || hasInvention(item.body, desc);
    if (bad) dropped.push(`process[${i}]`);
    return !bad;
  });

  const faq = copy.faq.filter((item, i) => {
    const bad = hasInvention(item.q, desc) || hasInvention(item.a, desc);
    if (bad) dropped.push(`faq[${i}]`);
    return !bad;
  });

  const guarded: SiteCopy = {
    ...copy,
    businessType,
    heroHeadline: keepText("heroHeadline", copy.heroHeadline, headline),
    heroSubline: keepText("heroSubline", copy.heroSubline, brief.service === PENDING_MARKER ? "" : brief.service),
    heroCta,
    servicesHeading: keepText("servicesHeading", copy.servicesHeading, "Servicios"),
    services,
    processHeading: keepText("processHeading", copy.processHeading, "Como trabajamos"),
    process,
    aboutHeading: keepText("aboutHeading", copy.aboutHeading, brief.businessType),
    aboutBody: keepText("aboutBody", copy.aboutBody, PENDING_MARKER),
    faq,
    closingHeadline: keepText("closingHeadline", copy.closingHeadline, "Hablemos"),
    closingCta,
    seoDescription: keepText("seoDescription", copy.seoDescription, PENDING_MARKER),
  };
  // `process` no tiene relleno de marcador: si cae por debajo del mínimo, se cae
  // la sección entera en el borrador, no se fabrica un paso.
  return { copy: guarded, dropped };
}
