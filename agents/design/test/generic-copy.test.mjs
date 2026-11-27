import { test } from "node:test";
import assert from "node:assert/strict";
import { PENDING_MARKER, genericCopy, guardCopy, normalizeBrief, siteCopySchema } from "../dist/index.js";

// Copy determinista de respaldo (spec T-002.2).
//
// No hay modelo de por medio: `genericCopy` arma un copy completo a partir del
// brief, sin el marcador y sin nada que la guardia tenga que podar. Lo que se
// prueba aquí es justo eso: que pase el esquema, que la guardia no caiga ni un
// campo, que no aparezca el marcador y que ningun literal parezca un dato.

/** Briefs de partida: desde el mas vacio hasta el que trae los cinco campos. */
const BRIEFS = {
  "solo description": { description: "somos una tienda de barrio que abre todos los dias" },
  "businessType, name y city": {
    businessType: "cafetería de especialidad",
    name: "Café Aurora",
    city: "Valencia",
  },
  "los cinco campos": {
    businessType: "cafetería de especialidad",
    name: "Café Aurora",
    city: "Valencia",
    service: "tueste propio y desayunos",
    contact: "hola@cafeaurora.test",
  },
  "con acentos en businessType y city": {
    businessType: "peluquería canina",
    city: "Alcalá de Henares",
  },
};

// Lo mismo que mira la guardia (`hasInvention`), mas las palabras concretas que
// el contrato prohibe por su nombre.
const DIGIT = /\d/;
const MONEY = /[€$%]/;
const CLAIM = /clientes satisfechos|años de experiencia|anos de experiencia|premiad|certificad|garantizad|líder|lider/i;

for (const [nombre, entrada] of Object.entries(BRIEFS)) {
  test(`genericCopy (${nombre}): esquema valido, guardia sin podas y sin marcador`, () => {
    const brief = normalizeBrief(entrada);
    const copy = genericCopy(brief);

    // 1. Pasa el esquema tal cual, sin recortes ni normalizacion previa.
    const parsed = siteCopySchema.safeParse(copy);
    assert.equal(parsed.success, true, `esquema: ${JSON.stringify(parsed.error?.issues)}`);

    // 2. La guardia no poda nada: el copy no lleva ni un dato inventado.
    assert.deepEqual(guardCopy(copy, brief).dropped, []);

    // 3. El marcador no aparece en ningun campo.
    const serializado = JSON.stringify(copy);
    assert.doesNotMatch(serializado, /pendiente de confirmar/);
    assert.doesNotMatch(serializado, new RegExp(PENDING_MARKER));

    // 4. Ni cifras, ni simbolos de dinero, ni reclamos.
    assert.doesNotMatch(serializado, DIGIT);
    assert.doesNotMatch(serializado, MONEY);
    assert.doesNotMatch(serializado, CLAIM);

    // 5. Forma completa: tres servicios, tres pasos, tres preguntas y un about.
    assert.equal(copy.services.length, 3);
    assert.equal(copy.process.length, 3);
    assert.equal(copy.faq.length, 3);
    assert.notEqual(copy.aboutBody, "");
    // El titular tiene que superar el minimo del esquema (8).
    assert.ok(copy.heroHeadline.length >= 8, `titular: ${copy.heroHeadline.length}`);
  });
}

test("genericCopy: sin ningun dato conocido usa los textos fijos y omite el nombre", () => {
  // T-011: una frase normal en `description` ya rellena `businessType`, asi que
  // para seguir probando la caida a los textos fijos la frase tiene que ser una
  // que el extractor descarta (solo digitos).
  const brief = normalizeBrief({ description: "12345" });
  const copy = genericCopy(brief);
  // `businessName` es opcional: si el dueño no lo dio, la clave no se inventa.
  assert.equal("businessName" in copy, false);
  assert.equal(copy.businessType, "negocio local");
  // Sin nombre ni ciudad el titular es el tipo de negocio, que ya cae al fijo
  // "negocio local": la frase final solo entra cuando eso no llega al minimo.
  // Contrato nuevo (mayuscula inicial): el titular, el encabezado del about y el
  // SEO empiezan en mayuscula porque son frases que se publican tal cual; el
  // `businessType` sigue en minusculas porque es un dato, no una frase.
  assert.equal(copy.heroHeadline, "Negocio local");
  assert.equal(copy.heroSubline, "Atención cercana y trabajo cuidado, sin complicaciones.");
  assert.equal(copy.aboutHeading, "Quiénes somos");
  // El about ya no lleva la frase fija de antes: dice cómo se trabaja en el
  // sector del brief (aquí, ninguno -> la neutra). Y empieza en mayúscula por
  // ser la primera frase del párrafo.
  assert.equal(copy.aboutBody, "Negocio local. Trabajamos de cerca con quien nos escribe: lo importante es entender bien lo que necesitas antes de empezar.");
  assert.equal(copy.seoDescription, "Negocio local. Escríbenos y te contamos cómo podemos ayudarte.");
});

test("genericCopy: los datos conocidos entran tal cual y el resto se compone con ellos", () => {
  const brief = normalizeBrief({
    businessType: "cafetería de especialidad",
    name: "Café Aurora",
    city: "Valencia",
    service: "tueste propio y desayunos",
    contact: "hola@cafeaurora.test",
  });
  const copy = genericCopy(brief);
  assert.equal(copy.businessName, "Café Aurora");
  assert.equal(copy.businessType, "cafetería de especialidad");
  // Con nombre, el titular es el nombre; sin ciudad, no se inventa el "en ...".
  assert.equal(copy.heroHeadline, "Café Aurora");
  assert.equal(copy.heroSubline, "tueste propio y desayunos");
  // Encabezado, about y SEO empiezan en mayúscula (contrato nuevo) y el about y
  // el SEO cierran con la frase DEL SECTOR (hostelería aquí), no con la misma
  // para todos los negocios. `businessType` sigue siendo el dato en minúsculas.
  assert.equal(copy.aboutHeading, "Cafetería de especialidad");
  assert.match(copy.aboutBody, /^Cafetería de especialidad en Valencia\. /);
  assert.equal(copy.seoDescription, "Cafetería de especialidad en Valencia. Carta, reservas y pedidos, sin complicaciones.");
  // Los servicios también son del oficio, no las tres ventajas de plantilla.
  assert.deepEqual(copy.services.map((s) => s.title), ["Carta", "Reservas", "Pedidos"]);
  // Los fijos del arquitecto, literales.
  assert.equal(copy.heroCta, "Contactar");
  assert.equal(copy.servicesHeading, "Qué hacemos");
  assert.equal(copy.processHeading, "Cómo trabajamos");
  assert.equal(copy.closingHeadline, "Hablemos de lo que necesitas");
  assert.equal(copy.closingCta, "Escribir");
  // CONTRATO NUEVO: las consultas de fotos son DEL SECTOR (aquí hostelería), no
  // las fijas de antes. Con las mismas para todos, una cafetería y una
  // consultoría pedían el mismo tipo de foto y el banco local —que está
  // organizado por sector— recibía una búsqueda que no le tocaba.
  assert.deepEqual(copy.photoQueries, { hero: "restaurant interior empty tables", gallery: "cafe interior counter" });
});

test("genericCopy: sin nombre pero con tipo y ciudad el titular los usa", () => {
  const brief = normalizeBrief({ businessType: "peluquería canina", city: "Alcalá de Henares" });
  const copy = genericCopy(brief);
  // Mayúscula inicial en el titular (contrato nuevo): es una frase publicada.
  assert.equal(copy.heroHeadline, "Peluquería canina en Alcalá de Henares");
  assert.equal("businessName" in copy, false);
  // Los acentos del brief no se normalizan ni se pierden.
  assert.match(copy.aboutBody, /Alcalá de Henares/);
  assert.match(copy.seoDescription, /Peluquería canina en Alcalá de Henares/);
});

test("genericCopy: sin nombre ni ciudad cae al tipo de negocio, y sin tipo al fijo 'negocio local'", () => {
  const conTipo = genericCopy(normalizeBrief({ businessType: "panadería artesanal" }));
  assert.equal(conTipo.heroHeadline, "Panadería artesanal");
  // T-011: la frase de antes ya no cae al fijo porque el extractor saca de ella
  // el tipo de negocio; el caso "sin nada" necesita una frase descartada.
  const sinNada = genericCopy(normalizeBrief({ description: "12345" }));
  assert.equal(sinNada.heroHeadline, "Negocio local");
});

test("genericCopy: con un tipo de negocio demasiado corto el titular llega al minimo del esquema", () => {
  // "bar" no llega a los 8 caracteres que exige `heroHeadline`: se usa el fijo
  // en vez de devolver un copy que el esquema iba a rechazar.
  const copy = genericCopy(normalizeBrief({ businessType: "bar" }));
  assert.equal(copy.heroHeadline, "Tu negocio, más cerca");
  assert.equal(siteCopySchema.safeParse(copy).success, true);
});

test("genericCopy: es determinista, no comparte estructuras y no toca el brief", () => {
  const brief = normalizeBrief({ businessType: "cafetería de especialidad", city: "Valencia" });
  const primero = genericCopy(brief);
  const segundo = genericCopy(brief);
  assert.deepEqual(primero, segundo);
  // Mutar una copia no cambia la otra: los servicios no se comparten por referencia.
  primero.services[0].title = "otra cosa";
  // El primer servicio ya no es la ventaja fija: es el del oficio del brief
  // (cafetería -> hostelería -> «Carta»). Lo que se prueba es la referencia.
  assert.equal(segundo.services[0].title, "Carta");
  assert.equal(brief.businessType, "cafetería de especialidad");
});

// --- T-002.9: Fix 2 — sin recortes que creen números parciales -----------------

test("T-002.9: tipo con año no produce número parcial en seoDescription ni aboutBody", () => {
  // «Negocio con 2019 locales» es un brief real que antes producía «20» suelto
  // al recortar seoDescription: el límite caía en mitad de «2019».
  // Con `safeCompose` se elige la variante que cabe sin recortar.
  const brief = normalizeBrief({ businessType: "Negocio con 2019 locales", city: "A".repeat(80) });
  const copy = genericCopy(brief);
  const serializado = JSON.stringify(copy);
  // Ningún número del brief debe aparecer parcialmente: «2019» sí; «20» suelto, no.
  assert.doesNotMatch(serializado, /(?<!\d)20(?!\d|19)/,
    "ningun campo contiene el número 2019 partido en «20»");
  assert.ok(copy.seoDescription.length <= 155, `seoDescription ${copy.seoDescription.length} > 155`);
  assert.ok(copy.aboutBody.length <= 700, `aboutBody ${copy.aboutBody.length} > 700`);
  assert.equal(siteCopySchema.safeParse(copy).success, true);
});

test("T-002.9: nombre de 80 caracteres hace que businessName se omita, copy sigue válido", () => {
  // businessName máx 60; un nombre de 80 no cabe. Se omite entero en vez de
  // recortarse (un nombre a medias es peor que ninguno: T-002.9, Fix 2).
  const nombre80 = "A".repeat(80);
  const copy = genericCopy(normalizeBrief({ name: nombre80 }));
  assert.equal("businessName" in copy, false, "businessName omitido cuando name > 60");
  assert.equal(siteCopySchema.safeParse(copy).success, true);
});

test("T-002.9: todos los campos del brief al máximo simultáneamente pasan el esquema", () => {
  // Verifica que safeCompose cubre también el peor caso combinado.
  const brief = normalizeBrief({
    businessType: "Á".repeat(120),
    name: "N".repeat(80),
    city: "C".repeat(80),
    service: "S".repeat(200),
    contact: "hola@test.es",
    description: "Á".repeat(500),
  });
  const copy = genericCopy(brief);
  const parsed = siteCopySchema.safeParse(copy);
  assert.equal(parsed.success, true, JSON.stringify(parsed.success ? [] : parsed.error.issues));
  assert.ok(copy.seoDescription.length <= 155);
  assert.ok(copy.aboutBody.length <= 700);
  assert.ok(copy.heroHeadline.length >= 8 && copy.heroHeadline.length <= 90);
});

test("T-002.9: emoji en el punto de corte de heroHeadline no produce sustituto suelto", () => {
  // heroHeadline máx 90; «a» + 44 emojis = 89 unidades UTF-16 (cabe); con una
  // más serían 91 (no cabe). safeCompose cae a la variante siguiente sin cortar.
  const brief = normalizeBrief({ name: "a" + "😀".repeat(45) }); // 1+90=91 unidades
  const copy = genericCopy(brief);
  assert.doesNotMatch(
    JSON.stringify(copy),
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    "ningun campo del copy contiene un sustituto suelto",
  );
  assert.ok(copy.heroHeadline.length <= 90);
  assert.equal(siteCopySchema.safeParse(copy).success, true);
});

test("T-002.9: un texto que cabe en su límite se conserva íntegro", () => {
  // safeCompose no debe tocar nada cuando la variante larga ya cabe.
  const brief = normalizeBrief({
    businessType: "cafetería de especialidad",
    city: "Valencia",
  });
  const copy = genericCopy(brief);
  // La composición «cafetería de especialidad en Valencia» más el cierre del
  // sector (hostelería) cabe en seoDescription (155), así que safeCompose deja
  // la variante larga intacta: no la acorta ni cae a la corta. Es lo que se
  // prueba aquí; el texto del cierre lo fija la tabla del sector.
  assert.equal(copy.seoDescription, "Cafetería de especialidad en Valencia. Carta, reservas y pedidos, sin complicaciones.");
  assert.match(copy.aboutBody, /^Cafetería de especialidad en Valencia\./);
});
