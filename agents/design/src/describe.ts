// Lo que se puede leer de la frase libre del dueño (T-011).
//
// El panel manda a veces una sola frase ("quiero una pagina web para un buffet
// de abogados en barranquilla") y los cinco campos del brief llegan vacíos. Sin
// esto, el copy de emergencia solo puede decir "negocio local" aunque el dueño
// acabe de escribir de qué va su negocio.
//
// Aquí NO hay modelo: se saca lo poco que una frase dice sin ambigüedad (tipo de
// negocio y ciudad) con reglas fijas. Lo que no se puede leer con confianza no se
// rellena: la regla de 9.1 sigue mandando y el agente no inventa datos.

/** Lo que se puede sacar de una frase sin preguntar a nadie. */
export interface Described {
  businessType?: string;
  city?: string;
}

/**
 * Coletillas de encargo, tal cual las escribe el dueño.
 *
 * Se prueban de la más larga a la más corta para que "quiero una pagina web
 * para" gane a "quiero": si gana la corta, el resto empieza por "una pagina web
 * para" y el tipo de negocio sale con basura delante.
 */
const VERBS = ["quiero", "necesito", "hazme"] as const;
const FORMS = [
  "una pagina web para",
  "una página web para",
  "una pagina para",
  "una página para",
  "una web para",
] as const;

const PREFIXES = [
  // Verbo + forma completa: las nueve combinaciones, sin dejar ninguna coja.
  ...VERBS.flatMap((verb) => FORMS.map((form) => `${verb} ${form}`)),
  // El dueño a veces escribe el encargo sin verbo.
  ...FORMS,
  "pagina web para",
  "página web para",
  // Y a veces solo el verbo ("quiero una web" no, "quiero" sí).
  ...VERBS,
].sort((a, b) => b.length - a.length);

/** Artículos que quedan colgando delante del tipo tras quitar la coletilla. */
const ARTICLES = ["unos ", "unas ", "una ", "un "];

/**
 * Saludos que no dicen nada del negocio.
 *
 * Se comparan con el texto entero que queda tras quitar coletilla y artículo:
 * "Hola" no es un tipo de negocio, y quedarse con él llenaría el titular con una
 * palabra que el dueño solo usó para saludar.
 */
const GREETINGS = ["hola", "buenas", "buenos dias", "buenos días", "hey"];

/** Tope del tipo de negocio. Coincide con `quickBriefSchema`. */
const BUSINESS_MAX = 120;

/** Tope de la ciudad. Coincide con `quickBriefSchema`. */
const CITY_MAX = 80;

/** Mínimo del tipo de negocio: con 3 o menos caracteres no dice nada ("web"). */
const BUSINESS_MIN = 3;

/**
 * Cola " en <ciudad>", al final o seguida de coma.
 *
 * Como mucho tres palabras y sin comas dentro: " en Calle 45", " en Bogotá",
 * " en barranquilla". El `(?:^|\s)` evita cortar por dentro de una palabra
 * ("también" no arranca una ciudad).
 */
const CITY_TAIL = /(?:^|\s)en\s+([^\s,]+(?:\s+[^\s,]+){0,2})\s*(?=$|,)/i;

/** Recorta y colapsa espacios sin tocar mayúsculas ni acentos. */
function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * ¿La cola parece un nombre de ciudad?
 *
 * Un número descarta el candidato ("en Calle 45" es una dirección, no una
 * ciudad): se quita del tipo de negocio, pero no se publica como ciudad.
 */
function isCity(candidate: string): boolean {
  return candidate !== "" && candidate.length <= CITY_MAX && !/\d/.test(candidate);
}

/** ¿Lo que queda sirve como tipo de negocio? */
function isBusinessType(candidate: string): boolean {
  return candidate.length > BUSINESS_MIN && !/^\d+$/.test(candidate);
}

/**
 * Saca tipo de negocio y ciudad de una frase escrita por el dueño.
 *
 * Devuelve `{}` cuando no hay nada que sacar con confianza: es la respuesta
 * correcta para "Hola" o para una frase que solo es el encargo.
 */
export function describeFromText(text: string): Described {
  let rest = clean(text);
  if (rest === "") return {};

  // 1. Coletilla de encargo. Se recorta sobre el original para no perder
  //    mayúsculas ni acentos; la comparación va en minúsculas.
  const lower = rest.toLowerCase();
  for (const prefix of PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    rest = clean(rest.slice(prefix.length));
    break;
  }

  // 2. Artículo que quedó delante ("un buffet...", "una peluquería").
  const afterPrefix = rest.toLowerCase();
  for (const article of ARTICLES) {
    if (afterPrefix.startsWith(article)) {
      rest = clean(rest.slice(article.length));
      break;
    }
  }

  // 2b. Un saludo a secas no es un negocio: ya sin coletilla ni artículo,
  //     "Hola" o "buenos días" no dejan nada que publicar.
  if (GREETINGS.includes(rest.toLowerCase())) return {};

  // 3. Ciudad al final (o antes de una coma). Se quita del resto aunque el
  //    candidato no valga: "en Calle 45" no es ciudad, pero tampoco es negocio.
  const described: Described = {};
  const cityMatch = CITY_TAIL.exec(rest);
  if (cityMatch !== null) {
    const candidate = clean(cityMatch[1] ?? "");
    const start = cityMatch.index;
    const end = start + cityMatch[0].length;
    // Se une con un espacio y se limpian las comas que queden en los bordes:
    // la ciudad puede venir seguida de coma y no debe dejar ", ," ni colas.
    const before = rest.slice(0, start);
    const after = rest.slice(end);
    rest = clean(`${before} ${after}`)
      .replace(/\s+,/g, ",")
      .replace(/^,\s*/, "")
      .replace(/\s*,$/, "");
    if (isCity(candidate)) described.city = candidate;
  }

  // 4. Tipo de negocio: lo que queda. Nunca se inventa ni se completa.
  const businessType = rest.slice(0, BUSINESS_MAX).trim();
  if (isBusinessType(businessType)) described.businessType = businessType;

  return described;
}
