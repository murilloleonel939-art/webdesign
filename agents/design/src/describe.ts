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
const VERBS = ["quiero", "necesito", "hazme", "haz", "crea", "crear", "diseña", "diseñar", "monta", "prepara"] as const;
const FORMS = [
  "una landing page para",
  "una landing page",
  "una pagina web para",
  "una página web para",
  "una pagina web",
  "una página web",
  "una pagina para",
  "una página para",
  "una web para",
  "una web",
  "pagina web para",
  "página web para",
  "pagina web",
  "página web",
] as const;

/**
 * Cómo empieza (o acaba) el encargo, no el negocio.
 *
 * POR QUÉ ESTÁ "tengo un negocio de": la frase más natural del dueño —«tengo un
 * negocio de consultoría tributaria hazme una landing page»— colaba entera como
 * tipo de negocio, y ese texto acababa publicado en el hero, en el SEO y en el
 * encabezado de la sección de texto. Lo que sobrevive a quitar la coletilla es el
 * negocio; lo que no sobreviva con confianza, no se publica.
 */
const OWNER_PREFIXES = [
  "tengo un negocio de",
  "tengo un negocio",
  "tengo una empresa de",
  "tengo una empresa",
  "mi negocio es de",
  "mi negocio es",
  "mi negocio",
  "me dedico a",
  "me dedico",
  "trabajo en",
  "soy",
  "somos",
] as const;

const PREFIXES = [
  // Verbo + forma completa: todas las combinaciones, sin dejar ninguna coja.
  ...VERBS.flatMap((verb) => FORMS.map((form) => `${verb} ${form}`)),
  // Coletilla del dueño + forma completa ("tengo un negocio de una web para").
  ...OWNER_PREFIXES.flatMap((owner) => FORMS.map((form) => `${owner} ${form}`)),
  // El dueño a veces escribe el encargo sin verbo.
  ...FORMS,
  // Y a veces solo dice de qué va, sin pedir nada.
  ...OWNER_PREFIXES,
  // Y a veces solo el verbo ("quiero una web" no, "quiero" sí).
  ...VERBS,
].sort((a, b) => b.length - a.length);

/**
 * Cómo acaba el encargo, no el negocio.
 *
 * POR QUÉ TAMBIÉN AL FINAL: el dueño escribe el negocio primero y el encargo
 * después («consultoría tributaria, hazme una landing page»). Se prueban de la
 * más larga a la más corta y se repiten hasta que no quede ninguna, porque puede
 * encadenar dos («... una landing page por favor»).
 */
const POSTFIXES = [
  "hazme una landing page",
  "haz una landing page",
  "hazme una pagina web",
  "hazme una página web",
  "haz una pagina web",
  "haz una página web",
  "hazme una web",
  "haz una web",
  "hazme una pagina",
  "hazme una página",
  "una landing page",
  "landing page",
  "una pagina web",
  "una página web",
  "una pagina",
  "una página",
  "una web",
  "por favor",
  "gracias",
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

/**
 * Lo que queda cuando la frase solo traía el encargo.
 *
 * "quiero una web" deja "web": no es un tipo de negocio, es el encargo otra vez.
 * Publicar eso como titular es exactamente el fallo que esto evita.
 */
const NOISE = new Set<string>([...GREETINGS, "web", "pagina", "página", "landing page", "landing", "sitio", "sitio web"]);

/** Tope del tipo de negocio. Coincide con `quickBriefSchema`. */
const BUSINESS_MAX = 120;

/** Tope de la ciudad. Coincide con `quickBriefSchema`. */
const CITY_MAX = 80;

/** Mínimo del tipo de negocio: por debajo de 3 no hay palabra que publicar. */
const BUSINESS_MIN = 3;

/**
 * Resto mínimo cuando lo que se quita es una coletilla del dueño («somos»,
 * «trabajo en»).
 *
 * POR QUÉ HACE FALTA UN MÍNIMO PROPIO: esas coletillas se parecen al principio de
 * un nombre de verdad («somos dos», «trabajo en alto»), y quitarlas dejaba una
 * palabra suelta publicada como negocio. Con el listón en 6, un resto corto hace
 * que se descarte el barrido entero y se conserve lo que escribió el dueño.
 */
const OWNER_MIN_REST = 6;

/**
 * A partir de cuántos dígitos un texto no es un tipo de negocio.
 *
 * Cinco: un teléfono tiene nueve y una dirección suele llevar más. Un nombre de
 * negocio con un número dentro («taller 24 horas», «café 1900») se queda muy por
 * debajo, y el que llega justo a cinco ya es más teléfono que nombre.
 */
const MAX_BUSINESS_DIGITS = 5;

/**
 * Artículos que se quitan TRAS una coletilla del dueño («somos un bar» → «bar»,
 * «me dedico a la fontanería» → «fontanería»). Incluye los determinados, que no
 * se tocan en el barrido general para no cargarse un nombre propio que empiece
 * por «La» («La Espiga»).
 */
const OWNER_ARTICLES = ["unos ", "unas ", "una ", "un ", "los ", "las ", "el ", "la "] as const;

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

/**
 * ¿Lo que queda sirve como tipo de negocio?
 *
 * POR QUÉ NO BASTA CON "TIENE ALGO": `"+34 600 123 123"` y `"hola@despacho.es"`
 * pasaban el filtro viejo (solo rechazaba lo que era todo dígitos) y acababan
 * publicados como titular del hero y como `seo.title`. Un contacto NO es un tipo
 * de negocio, y una web que se llama «hola@despacho.es» no se puede vender.
 *
 * Las tres condiciones: algo más que el mínimo, ni correo ni teléfono (`@`, `+`)
 * y al menos una letra. Un número DENTRO de un nombre real sigue valiendo
 * («taller 24 horas»), que es lo que distingue este caso del anterior.
 */
function isBusinessType(candidate: string): boolean {
  // Tres letras ya son un negocio («bar», «spa», «tax»): antes el mínimo era 4 y
  // «somos un bar» se quedaba sin tipo. Lo que no vale con tres letras es el
  // encargo otra vez («web»), y de eso se encarga `NOISE`.
  if (candidate.length < BUSINESS_MIN) return false;
  if (candidate.includes("@") || candidate.includes("+")) return false;
  // Un teléfono escrito con letras delante («Tel. 600 123 123», «WhatsApp
  // 600123123») pasaba por tener letras y se publicaba como titular. Un nombre
  // de negocio no lleva cinco dígitos ni de casualidad; «taller 24 horas» lleva
  // dos y sigue siendo un tipo de negocio.
  const digits = candidate.match(/\d/g)?.length ?? 0;
  if (digits >= MAX_BUSINESS_DIGITS) return false;
  return /\p{L}/u.test(candidate);
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

  // 1-2. Coletilla de encargo, por delante y por detrás, y artículo que quede
  //      colgando; en bucle hasta que no cambie nada. La frase puede traer el
  //      encargo al principio («tengo un negocio de...»), al final («... hazme
  //      una landing page») o en los dos sitios, y quitar solo un lado deja el
  //      otro publicado.
  const original = rest;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = rest;
    let quitoColetillaDelDueno = false;
    let quitoArticulo = false;
    const lower = rest.toLowerCase();
    for (const prefix of PREFIXES) {
      if (!lower.startsWith(prefix)) continue;
      // ¿Es una coletilla de las que el dueño usa para presentarse («somos»,
      // «trabajo en») o una petición explícita («hazme una web para»)? Solo las
      // primeras pueden comerse el principio de un nombre real.
      quitoColetillaDelDueno = OWNER_PREFIXES.some((owner) => prefix === owner || prefix.startsWith(`${owner} `));
      rest = clean(rest.slice(prefix.length));
      // Tras la coletilla suele quedar el artículo («somos un bar», «me dedico a
      // la fontanería»). Se quita aquí, pegado a la colectilla y no en el
      // barrido general: «La Espiga» es un nombre y no se toca.
      if (quitoColetillaDelDueno) {
        for (const article of OWNER_ARTICLES) {
          // SOLO EN MINÚSCULA: «un», «la», «el»... son artículos; «La Espiga» es
          // el nombre del negocio y forma parte de él. Comparar en minúsculas se
          // comía el «La» de «soy La Espiga» y publicaba «Espiga».
          if (!rest.startsWith(article)) continue;
          rest = clean(rest.slice(article.length));
          quitoArticulo = true;
          break;
        }
      }
      break;
    }
    const withTail = rest.toLowerCase();
    for (const postfix of POSTFIXES) {
      if (!withTail.endsWith(postfix)) continue;
      rest = clean(rest.slice(0, rest.length - postfix.length)).replace(/[,\s]+$/, "");
      break;
    }
    const afterPrefix = rest.toLowerCase();
    for (const article of ARTICLES) {
      if (afterPrefix.startsWith(article)) {
        rest = clean(rest.slice(article.length));
        break;
      }
    }
    if (rest === before) break;
    // GUARDA: si quitar «somos» o «trabajo en» deja un resto sin sustancia
    // («somos dos» → «dos», «trabajo en alto» → «alto»), el barrido se descarta
    // y se conserva el texto original. Un texto real no se recorta por parecerse
    // a una coletilla; antes, «somos dos» se publicaba como «Dos».
    //
    // EXCEPCIÓN: si había artículo («somos un bar»), el resto ya es el sustantivo
    // que se buscaba y el mínimo no aplica: «bar» es el negocio.
    if (quitoColetillaDelDueno && !quitoArticulo && rest.length < OWNER_MIN_REST) {
      return isBusinessType(original) ? { businessType: original.slice(0, BUSINESS_MAX) } : {};
    }
  }

  // 2b. Lo que queda es un saludo, o el encargo otra vez ("web", "landing
  //     page"): no es un negocio y no se publica como si lo fuera.
  if (rest === "") return {};
  if (NOISE.has(rest.toLowerCase())) return {};

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
