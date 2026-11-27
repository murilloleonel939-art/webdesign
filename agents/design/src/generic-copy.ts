import { PENDING_MARKER, isPlaceholderName, type QuickBrief } from "./brief.js";
import { COPY_LIMITS, briefValueOk, type SiteCopy } from "./copy.js";
import { sectorForBrief, type Sector } from "./sector.js";

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

/**
 * Servicios concretos por RAIZ de negocio.
 *
 * POR QUÉ UNA TABLA Y NO UNA FRASE DE PLANTILLA: el respaldo publicaba las mismas
 * tres ventajas («Atención directa», «Trabajo a medida», «Seguimiento») para una
 * peluquería y para una consultoría. Eso no vende: no dice nada del negocio. Con
 * esta tabla, una consultoría tributaria enseña «Declaraciones y liquidaciones» y
 * una peluquería enseña «Corte y peinado», sin que el agente invente nada: son
 * los servicios propios de ese oficio, no hechos del negocio (ni cifras, ni años,
 * ni premios, ni testimonios, ni precios).
 *
 * Los cuerpos se quedan en cómo se trabaja, no en qué se consigue: la guardia de
 * `copy.ts` sigue mandando y no hay nada que prometa un resultado.
 */
const SERVICE_GROUPS: ReadonlyArray<{
  signals: readonly string[];
  items: ReadonlyArray<{ title: string; body: string }>;
}> = [
  {
    signals: ["fiscal", "contab", "asesor", "consultor", "gestor", "tributar"],
    items: [
      { title: "Declaraciones y liquidaciones", body: "Nos ocupamos de presentar lo que toca y en plazo, con la documentación revisada antes." },
      { title: "Asesoría para autónomos y pymes", body: "Te contamos qué opciones hay para tu caso y qué hace falta para cada una." },
      { title: "Revisión de cuentas", body: "Repasamos lo que ya tienes para ver qué falta o qué conviene corregir." },
    ],
  },
  {
    signals: ["abogad", "juridic", "bufete", "buffet", "notar", "legal"],
    items: [
      { title: "Consultas", body: "Nos cuentas el caso y te decimos por dónde se puede empezar." },
      { title: "Documentos y escritos", body: "Preparamos lo que haya que presentar, con el texto revisado contigo." },
      { title: "Acompañamiento en trámites", body: "Te decimos qué pasos hay y en qué punto está cada uno." },
    ],
  },
  {
    signals: ["dent", "clinic", "medic", "fisio", "psicolog", "veterinari", "salud", "farmaci", "optic"],
    items: [
      { title: "Consultas", body: "Te escuchamos, revisamos tu caso y te explicamos qué se puede hacer." },
      { title: "Revisiones", body: "Seguimos la evolución de lo que ya tratamos y ajustamos si hace falta." },
      { title: "Seguimiento", body: "Te decimos cuándo toca volver y qué conviene hacer mientras tanto." },
    ],
  },
  {
    signals: ["peluquer", "barber", "estetic", "uñas", "manicur", "maquillaj", "spa", "masaj", "belleza"],
    items: [
      { title: "Corte y peinado", body: "Lo que pidas, con un rato para ver cómo queda antes de terminar." },
      { title: "Color y tratamientos", body: "Te contamos qué opciones hay y cuánto aguanta cada una en tu caso." },
      { title: "Cita previa", body: "Pide hora y te decimos cuándo hay hueco." },
    ],
  },
  {
    signals: ["restauran", "bar ", "cafe", "cafeter", "hostel", "cocina", "bakery", "panader", "pizzer"],
    items: [
      { title: "Carta", body: "Lo que hay para comer y beber, actualizado con lo que hay en cada momento." },
      { title: "Reservas", body: "Dinos cuántos sois y cuándo, y te confirmamos el hueco." },
      { title: "Pedidos", body: "Pregúntanos por lo que necesites y te decimos cómo funciona." },
    ],
  },
  {
    signals: ["taller", "garage", "garaj", "mecanic", "carpinter", "cerrajer", "reforma", "electric", "fontaner"],
    items: [
      { title: "Reparaciones", body: "Nos cuentas qué pasa y te decimos qué se puede hacer." },
      { title: "Mantenimiento", body: "Revisamos lo que ya funciona para que siga funcionando." },
      { title: "Presupuestos", body: "Te damos el detalle de lo que costaría antes de empezar." },
    ],
  },
  {
    signals: ["tienda", "comercio", "boutique", "retail", "shop", "moda"],
    items: [
      { title: "Producto", body: "Lo que hay disponible, contado tal cual, sin adornos." },
      { title: "Pedidos", body: "Pregúntanos por lo que buscas y te decimos cómo conseguirlo." },
      { title: "Atención en tienda", body: "Si vienes, te enseñamos lo que tenemos y resolvemos dudas." },
    ],
  },
];

/** Servicios del sector cuando el nombre del negocio no dice nada más fino. */
const SECTOR_SERVICES: Readonly<Record<Sector, ReadonlyArray<{ title: string; body: string }>>> = {
  despacho: SERVICE_GROUPS[0]!.items,
  hosteleria: SERVICE_GROUPS[4]!.items,
  comercio: SERVICE_GROUPS[6]!.items,
  salud: SERVICE_GROUPS[2]!.items,
  taller: SERVICE_GROUPS[5]!.items,
  belleza: SERVICE_GROUPS[3]!.items,
  // Sin sector claro no se inventan servicios del oficio, pero SÍ tienen que ser
  // tres: `MIN_SERVICES` de `plan.ts` pide tres para que la página tenga sección
  // de servicios, y con dos el respaldo entregaba una landing sin «Qué hacemos»
  // (T-002.6 se rompía justo en los negocios de sector desconocido). Estos tres
  // no dicen nada del oficio, que es lo honesto cuando no se sabe.
  neutro: [
    { title: "Atención directa", body: "Escribes y te contesta una persona, sin formularios largos ni intermediarios." },
    { title: "Trabajo a medida", body: "Cada encargo se ajusta a lo que necesitas y a cómo lo necesitas." },
    { title: "Seguimiento", body: "Te contamos cómo va lo que pediste y resolvemos las dudas que vayan saliendo." },
  ],
};

/** Cómo se trabaja, por sector: el «quiénes somos» no puede ser el mismo párrafo. */
const SECTOR_ABOUT: Readonly<Record<Sector, string>> = {
  despacho: "Trabajamos por encargo: nos cuentas qué necesitas y te decimos cómo lo haríamos y qué documentación hace falta.",
  hosteleria: "Trabajamos con lo que hay cada día: te contamos qué hay, cómo se prepara y qué puedes pedir.",
  comercio: "Trabajamos con lo que tenemos en tienda: te enseñamos el producto y te contamos sus detalles antes de decidir.",
  salud: "Trabajamos por consulta: escuchamos tu caso, lo revisamos y te explicamos qué opciones hay antes de hacer nada.",
  taller: "Trabajamos por encargo: nos cuentas qué pasa, lo miramos y te decimos qué se puede hacer y cuánto costaría.",
  belleza: "Atendemos con cita: nos dices qué buscas y te proponemos lo que mejor encaja con tu pelo y tu día a día.",
  neutro: "Trabajamos de cerca con quien nos escribe: lo importante es entender bien lo que necesitas antes de empezar.",
};

/** Cierre del `seo.description`, por sector: una frase corta y cierta. */
const SECTOR_SEO: Readonly<Record<Sector, string>> = {
  despacho: "Consultas, trámites y revisión de cuentas, explicado sin tecnicismos.",
  hosteleria: "Carta, reservas y pedidos, sin complicaciones.",
  comercio: "Producto, pedidos y atención en tienda.",
  salud: "Consultas, revisiones y seguimiento.",
  taller: "Reparaciones, mantenimiento y presupuestos.",
  belleza: "Cita previa, corte, color y tratamientos.",
  neutro: "Escríbenos y te contamos cómo podemos ayudarte.",
};

/** Subtítulo del hero cuando el dueño no dio servicio. */
const SECTOR_SUBLINE: Readonly<Record<Sector, string>> = {
  despacho: "Te contamos qué opciones hay para tu caso y qué hace falta para empezar.",
  hosteleria: "Te contamos qué hay y cómo pedirlo.",
  comercio: "Te enseñamos el producto y resolvemos dudas.",
  salud: "Escuchamos tu caso y te explicamos qué se puede hacer.",
  taller: "Nos cuentas qué pasa y te decimos qué se puede hacer.",
  belleza: "Pide cita y te decimos cuándo hay hueco.",
  neutro: "Atención cercana y trabajo cuidado, sin complicaciones.",
};

/**
 * Consultas de fotos EN INGLÉS, por sector (banco local, T-020/T-034).
 *
 * POR QUÉ NO SON SIEMPRE LAS MISMAS: el respaldo pedía "local business
 * storefront" / "small business interior" para cualquier negocio, así que una
 * peluquería y una consultoría acababan con el mismo encargo de fotos. El banco
 * local organiza las suyas por sector (`deploy/photo-bank/unsplash/<sector>/`),
 * así que una consulta del sector encaja con lo que de verdad hay ahí.
 */
const SECTOR_PHOTO_QUERIES: Readonly<Record<Sector, { hero: string; gallery: string }>> = {
  despacho: { hero: "modern office interior desks", gallery: "office workspace interior" },
  hosteleria: { hero: "restaurant interior empty tables", gallery: "cafe interior counter" },
  comercio: { hero: "boutique store interior shelves", gallery: "retail shop display shelves" },
  salud: { hero: "medical office interior equipment", gallery: "dental clinic interior room" },
  taller: { hero: "woodworking workshop workbench", gallery: "garage workshop tools wall" },
  belleza: { hero: "hair salon interior chairs mirrors", gallery: "barber shop interior mirror" },
  neutro: { hero: "local business storefront", gallery: "small business interior" },
};

/** Minúsculas y sin acentos, para comparar señales sin depender de la tilde. */
function fold(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Primera letra en mayúscula y el resto tal cual: el tipo de negocio sale del
 * texto del dueño en minúsculas («consultoría tributaria»), pero un titular, un
 * `seo.title` y el nombre del sitio empiezan en mayúscula. No se toca nada más:
 * los acentos quedan como están y una sigla («SEO») tampoco se destrosa.
 *
 * Se exporta porque `draft.ts` compone el mismo «tipo en ciudad» para el titular
 * y comparten regla; duplicarla dejaba un sitio en minúscula y otro no.
 */
export function sentenceCase(value: string): string {
  const clean = value.trim();
  return clean === "" ? clean : clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Los servicios del negocio: por su oficio, y si no se sabe, los del sector. */
function servicesFor(brief: QuickBrief, sector: Sector): ReadonlyArray<{ title: string; body: string }> {
  const haystack = fold(`${brief.businessType} ${brief.service}`);
  for (const group of SERVICE_GROUPS) {
    if (group.signals.some((signal) => haystack.includes(signal))) return group.items;
  }
  return SECTOR_SERVICES[sector];
}

export function genericCopy(brief: QuickBrief): SiteCopy {
  const businessType = publishable(brief.businessType, brief) ? brief.businessType : "negocio local";
  const city = publishable(brief.city, brief) ? brief.city : "";
  // El lugar solo se compone con datos que ya pasaron la guardia.
  const place = city === "" ? businessType : `${businessType} en ${city}`;
  const sector = sectorForBrief(brief);
  // El nombre cuenta solo si el dueño lo dio y no es relleno: «Mi sitio» es el
  // hueco que deja la plataforma, no un nombre, y publicarlo como titular es lo
  // que hacía que la web no se pudiera vender. `normalizeBrief` ya lo descarta;
  // aquí se vuelve a comprobar porque `genericCopy` se llama desde más sitios.
  const realName = publishable(brief.name, brief) && !isPlaceholderName(brief.name) ? brief.name : null;

  // heroHeadline: nombre del dueño; si no hay, «<tipo> en <ciudad>»; si no,
  // «<Tipo>». Con la mayúscula inicial puesta: el tipo sale del texto del dueño
  // en minúsculas («consultoría tributaria») y un titular empieza en mayúscula.
  // Se prueban variantes más cortas antes que recortar (T-002.9, Fix 2).
  const conCiudad = sentenceCase(place);
  const soloTipo = sentenceCase(businessType);
  const heroVariants = [
    realName ?? conCiudad,
    conCiudad,
    soloTipo,
    "Tu negocio, más cerca",
  ];
  const rawHeadline = heroVariants.find((v) => v.length >= HERO_HEADLINE_MIN && v.length <= COPY_LIMITS.heroHeadline)
    ?? "Tu negocio, más cerca";

  // seoDescription y aboutBody: tipo + ciudad + una frase DEL SECTOR, no la misma
  // para todos los negocios. Variantes sin recorte (T-002.9, Fix 2).
  const seoDescription = safeCompose(
    [
      `${conCiudad}. ${SECTOR_SEO[sector]}`,
      `${soloTipo}. ${SECTOR_SEO[sector]}`,
      SECTOR_SEO[sector],
      "Escríbenos y te contamos cómo podemos ayudarte.",
    ],
    COPY_LIMITS.seoDescription,
  );
  const aboutBody = safeCompose(
    [
      `${conCiudad}. ${SECTOR_ABOUT[sector]}`,
      `${soloTipo}. ${SECTOR_ABOUT[sector]}`,
      SECTOR_ABOUT[sector],
    ],
    COPY_LIMITS.aboutBody,
  );

  // El tipo de negocio, solo cuando lo dio el dueño: «en negocio local» no dice
  // nada y en un texto de relleno se nota.
  const tipoDado = publishable(brief.businessType, brief) ? businessType : "";
  const enElNegocio = tipoDado === "" ? "" : `en ${tipoDado} `;
  const dondeAtiende = city === "" ? "" : ` en ${city}`;

  const copy: SiteCopy = {
    businessType,
    heroHeadline: rawHeadline,
    heroSubline: publishable(brief.service, brief) ? brief.service : SECTOR_SUBLINE[sector],
    heroCta: "Contactar",
    servicesHeading: "Qué hacemos",
    services: servicesFor(brief, sector).map((item) => ({ title: item.title, body: item.body })),
    processHeading: "Cómo trabajamos",
    process: [
      { title: "Nos escribes", body: `Cuéntanos qué necesitas${dondeAtiende} y para cuándo.` },
      { title: "Lo concretamos", body: `Vemos ${enElNegocio}la mejor forma de hacerlo y te decimos cómo seguimos.` },
      { title: "Lo llevamos a cabo", body: "Nos ponemos con ello y te mantenemos al día." },
    ],
    aboutHeading: tipoDado === "" ? "Quiénes somos" : sentenceCase(businessType),
    aboutBody,
    faq: [
      {
        q: "¿Cómo puedo contactar?",
        a: `Escríbenos desde el formulario de esta página: ${enElNegocio}te contestamos por ahí.`,
      },
      {
        q: city === "" ? "¿Trabajáis en mi zona?" : `¿Dónde estáis?`,
        a: city === "" ? "Cuéntanos qué necesitas y te decimos si podemos ayudarte." : `Atendemos${dondeAtiende}. Escríbenos y te decimos cómo llegar o cómo empezar.`,
      },
      { q: "¿Cuánto tarda?", a: "Depende de lo que pidas; te damos una idea cuando nos escribes." },
    ],
    closingHeadline: "Hablemos de lo que necesitas",
    closingCta: "Escribir",
    seoDescription,
    photoQueries: SECTOR_PHOTO_QUERIES[sector],
  };
  // `businessName` es opcional en el esquema. Se publica SOLO con un nombre que
  // dio el dueño (`realName` ya descarta rellenos como «Mi sitio» y reclamos), y
  // se omite entero si no cabe en su máximo (60): un nombre a medias es peor que
  // ninguno (T-002.9, Fix 2). Sin nombre del dueño, la clave no se inventa.
  if (realName !== null && realName.length <= COPY_LIMITS.businessName) {
    copy.businessName = realName;
  }
  // Un último paso, uno solo, que recorta los campos de prosa fija.
  return fit(copy);
}
