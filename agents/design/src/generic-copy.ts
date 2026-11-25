import { PENDING_MARKER, type QuickBrief } from "./brief.js";
import { COPY_LIMITS, briefValueOk, type SiteCopy } from "./copy.js";

// Copy determinista de respaldo (T-002.2).
//
// Cuando no hay copy del modelo, el sitio no puede quedarse con el marcador
// `pendiente de confirmar` ni con secciones vacias. Esta funcion arma un copy
// completo con lo que el brief SI sabe y con textos genericos de negocio local:
// nada de cifras, anos, premios, certificaciones, precios ni testimonios, asi
// que la guardia no tiene nada que podar y el esquema lo acepta tal cual.
//
// El brief manda en lo que dice; lo que no dice NO se rellena con una suposicion.
// Si el dueño no dio nombre, `businessName` se omite en vez de inventarlo, y el
// resto de huecos caen a frases que no afirman ningun hecho del negocio.
//
// Los textos estan fijados por el contrato de T-002.2: se copian literales, sin
// reescribirlos. El cableado en el flujo (`runFastDesign`, `draftSite`) es T-002.3.

/** Minimo del esquema para `heroHeadline`: por debajo no es un titular. */
const HERO_HEADLINE_MIN = 8;

/**
 * Recorta PROSA sin datos al máximo del esquema, en frontera de palabra, sin
 * partir caracteres multibyte (T-002.9, Fix 2).
 *
 * Solo se llama sobre textos fijos que no contienen cifras ni datos del brief.
 * Nunca se llama sobre textos compuestos con valores del dueño: esos usan
 * `safeCompose` para elegir la variante más corta en vez de recortar.
 */
const cutProse = (value: string, max: number): string => {
  if (value.length <= max) return value;
  let out = value.slice(0, max);
  // No se parte un carácter multibyte (emoji, etc.).
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  // Frontera de palabra: no dejar una sílaba suelta.
  const space = out.lastIndexOf(" ");
  if (space > max * 0.5) out = out.slice(0, space);
  return out.trimEnd();
};

/**
 * Elige la primera variante que cabe en `max` sin recortar (T-002.9, Fix 2).
 *
 * Un recorte de un texto con datos del brief puede dejar un número parcial
 * («Café 2019» → «Café 20»), que es exactamente lo que la guardia prohíbe. No
 * se recorta: si no cabe la variante larga, se prueba la corta; si tampoco, el
 * neutro. El neutro siempre cabe (sus longitudes se verifican en test).
 */
function safeCompose(variants: string[], max: number): string {
  for (const v of variants) {
    if (v.length <= max) return v;
  }
  // Nunca debe llegar aquí: el llamador debe incluir un neutro que quepa.
  throw new Error(`safeCompose: ninguna variante cabe en ${max}`);
}

/**
 * Recorta TODOS los campos del copy a los límites del esquema (T-002.8/T-002.9).
 *
 * Los campos fijos sin datos del brief se recortan con `cutProse` (en frontera
 * de palabra, sin partir multibyte). Los campos compuestos con datos del dueño
 * (seoDescription, aboutBody, businessName, heroHeadline) NO pasan por aquí:
 * se componen con `safeCompose` antes de llegar, eligiendo ya la variante que
 * cabe. Pasar un valor de esos por `cutProse` podría dejar un número parcial.
 */
function fit(copy: SiteCopy): SiteCopy {
  const t = cutProse;
  const fitted: SiteCopy = {
    ...copy,
    businessType: t(copy.businessType, COPY_LIMITS.businessType),
    // heroHeadline y heroSubline se componen con safeCompose: llegan ya dentro del límite.
    heroHeadline: copy.heroHeadline,
    heroSubline: t(copy.heroSubline, COPY_LIMITS.heroSubline),
    heroCta: t(copy.heroCta, COPY_LIMITS.heroCta),
    servicesHeading: t(copy.servicesHeading, COPY_LIMITS.servicesHeading),
    services: copy.services.map((item) => ({
      title: t(item.title, COPY_LIMITS.serviceTitle),
      body: t(item.body, COPY_LIMITS.serviceBody),
    })),
    processHeading: t(copy.processHeading, COPY_LIMITS.processHeading),
    process: copy.process.map((item) => ({
      title: t(item.title, COPY_LIMITS.processTitle),
      body: t(item.body, COPY_LIMITS.processBody),
    })),
    aboutHeading: t(copy.aboutHeading, COPY_LIMITS.aboutHeading),
    // aboutBody y seoDescription se componen con safeCompose: llegan ya dentro del límite.
    aboutBody: copy.aboutBody,
    faq: copy.faq.map((item) => ({ q: t(item.q, COPY_LIMITS.faqQ), a: t(item.a, COPY_LIMITS.faqA) })),
    closingHeadline: t(copy.closingHeadline, COPY_LIMITS.closingHeadline),
    closingCta: t(copy.closingCta, COPY_LIMITS.closingCta),
    // seoDescription se compone con safeCompose: llega ya dentro del límite.
    seoDescription: copy.seoDescription,
  };
  // businessName: si llegó es porque ya pasó por safeCompose/omisión.
  if (copy.businessName !== undefined) fitted.businessName = copy.businessName;
  if (copy.photoQueries !== undefined) {
    fitted.photoQueries = {
      hero: t(copy.photoQueries.hero, COPY_LIMITS.photoQuery),
      gallery: t(copy.photoQueries.gallery, COPY_LIMITS.photoQuery),
    };
  }
  return fitted;
}

/** ¿El dueño dio este dato, o el brief lo dejo con el marcador? */
function known(value: string): boolean {
  return value !== PENDING_MARKER && value.trim() !== "";
}

/**
 * ¿El dato del dueño se puede publicar? (T-002.4, Fix D)
 *
 * Se pasa ANTES de interpolar cualquier valor del brief en un texto de respaldo.
 * `briefValueOk` es el mismo predicado de la guardia, así que un tipo de negocio
 * como "taller certificado" no entra en el «about» ni en el SEO aunque venga del
 * dueño. Sin esto, el respaldo genérico restauraba justo el reclamo que la
 * guardia acababa de podar.
 *
 * No se sanea recortando palabras: o el dato pasa entero, o se cae al neutro.
 */
function publishable(value: string, brief: QuickBrief): boolean {
  return known(value) && briefValueOk(value, brief);
}

export function genericCopy(brief: QuickBrief): SiteCopy {
  const businessType = publishable(brief.businessType, brief) ? brief.businessType : "negocio local";
  const city = publishable(brief.city, brief) ? brief.city : "";
  // El lugar solo se compone con datos que ya pasaron la guardia.
  const place = city === "" ? businessType : `${businessType} en ${city}`;

  // heroHeadline: variantes más cortas antes que recortar (T-002.9, Fix 2).
  // Si el candidato no cabe en el máximo del esquema (90), probamos sin ciudad,
  // luego sin tipo, y por último la frase fija, que siempre cabe.
  const candidatoConNombre = publishable(brief.name, brief) ? brief.name : null;
  const heroVariants = [
    candidatoConNombre ?? place,          // nombre del dueño, o tipo con ciudad
    candidatoConNombre ? place : businessType, // tipo con ciudad, o solo tipo
    businessType,                          // solo el tipo
    "Tu negocio, más cerca",               // frase fija, siempre cabe
  ];
  const rawHeadline = heroVariants.find((v) => v.length >= HERO_HEADLINE_MIN && v.length <= COPY_LIMITS.heroHeadline)
    ?? "Tu negocio, más cerca";

  // seoDescription: variantes sin recorte (T-002.9, Fix 2).
  // La composición con tipo y ciudad puede superar el límite (155) con datos
  // largos del brief; en ese caso caemos a variantes más cortas, nunca cortamos.
  const SEO_SUFFIX = ". Escríbenos y te contamos cómo podemos ayudarte.";
  const seoDescription = safeCompose(
    [
      `${place}${SEO_SUFFIX}`,
      `${businessType}${SEO_SUFFIX}`,
      `Escríbenos y te contamos cómo podemos ayudarte.`,
    ],
    COPY_LIMITS.seoDescription,
  );

  // aboutBody: variantes sin recorte (T-002.9, Fix 2).
  const ABOUT_SUFFIX = ". Trabajamos de cerca con quien nos escribe: lo importante es entender bien lo que necesitas antes de empezar. Si quieres saber si podemos ayudarte, escríbenos y te lo contamos.";
  const aboutBody = safeCompose(
    [
      `${place}${ABOUT_SUFFIX}`,
      `${businessType}${ABOUT_SUFFIX}`,
      `Trabajamos de cerca con quien nos escribe. Si quieres saber si podemos ayudarte, escríbenos y te lo contamos.`,
    ],
    COPY_LIMITS.aboutBody,
  );

  const copy: SiteCopy = {
    businessType,
    heroHeadline: rawHeadline,
    heroSubline: publishable(brief.service, brief) ? brief.service : "Atención cercana y trabajo cuidado, sin complicaciones.",
    heroCta: "Contactar",
    servicesHeading: "Qué hacemos",
    services: [
      {
        title: "Atención directa",
        body: "Escribes y te contesta una persona, sin formularios largos ni intermediarios.",
      },
      {
        title: "Trabajo a medida",
        body: "Cada encargo se ajusta a lo que necesitas y a cómo lo necesitas.",
      },
      {
        title: "Seguimiento",
        body: "Te contamos cómo va lo que pediste y resolvemos las dudas que vayan saliendo.",
      },
    ],
    processHeading: "Cómo trabajamos",
    process: [
      { title: "Nos escribes", body: "Cuéntanos qué necesitas y para cuándo." },
      { title: "Lo concretamos", body: "Vemos juntos la mejor forma de hacerlo y te decimos cómo seguimos." },
      { title: "Lo llevamos a cabo", body: "Nos ponemos con ello y te mantenemos al día." },
    ],
    aboutHeading: publishable(brief.businessType, brief) ? brief.businessType : "Quiénes somos",
    aboutBody,
    faq: [
      { q: "¿Cómo puedo contactar?", a: "Escríbenos desde el formulario de esta página y te contestamos." },
      { q: "¿Trabajáis en mi zona?", a: "Cuéntanos qué necesitas y te decimos si podemos ayudarte." },
      { q: "¿Cuánto tarda?", a: "Depende de lo que pidas; te damos una idea cuando nos escribes." },
    ],
    closingHeadline: "Hablemos de lo que necesitas",
    closingCta: "Escribir",
    seoDescription,
    photoQueries: { hero: "local business storefront", gallery: "small business interior" },
  };
  // `businessName` es opcional en el esquema. Si no cabe (máx 60) se omite en
  // vez de recortarlo: un nombre a medias es peor que ninguno (T-002.9, Fix 2).
  if (publishable(brief.name, brief) && brief.name.length <= COPY_LIMITS.businessName) {
    copy.businessName = brief.name;
  }
  // Un último paso, uno solo, que recorta los campos de prosa fija.
  return fit(copy);
}
