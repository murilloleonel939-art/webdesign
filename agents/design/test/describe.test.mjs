import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFromText, genericCopy, normalizeBrief } from "../dist/index.js";

// Extracción determinista del texto libre (T-011).
//
// El dueño escribe una frase y los cinco campos del brief llegan vacíos: de esa
// frase solo se sacan tipo de negocio y ciudad, y sin modelo de por medio. Lo que
// no se puede leer con confianza no se rellena.

/** La tabla del contrato, tal cual. Una fila por test. */
const TABLA = [
  {
    entrada: "quiero una pagina web para un buffet de abogados en barranquilla",
    businessType: "buffet de abogados",
    city: "barranquilla",
  },
  {
    entrada: "Necesito una web para mi clínica dental en Bogotá",
    businessType: "mi clínica dental",
    city: "Bogotá",
  },
  { entrada: "hazme una pagina para una peluquería", businessType: "peluquería" },
  { entrada: "restaurante", businessType: "restaurante" },
  { entrada: "Hola" },
  { entrada: "quiero una web" },
  { entrada: "taller mecánico en Calle 45", businessType: "taller mecánico" },
];

// Los siete casos de la tabla, como aserciones normales.
for (const fila of TABLA) {
  test(`describeFromText: «${fila.entrada}»`, () => {
    const out = describeFromText(fila.entrada);
    assert.equal(out.businessType, fila.businessType);
    assert.equal(out.city, fila.city);
  });
}

test("describeFromText: un saludo cualquiera no es un tipo de negocio", () => {
  for (const saludo of ["hola", "Hola", "buenas", "buenos dias", "Buenos días", "hey"]) {
    assert.deepEqual(describeFromText(saludo), {}, `saludo: ${saludo}`);
  }
});

test("describeFromText: «en barranquilla» da ciudad sin tipo de negocio", () => {
  assert.deepEqual(describeFromText("en barranquilla"), { city: "barranquilla" });
});

test("describeFromText: «mi bar en el centro» — lo que hoy hace la regla 3", () => {
  // La regla 3 es mecánica: toda cola " en <1-3 palabras>" es ciudad, así que
  // "el centro" se publica como ciudad. Distinguir un lugar de una frase hecha
  // pediría una lista de ciudades, que el contrato no tiene.
  assert.deepEqual(describeFromText("mi bar en el centro"), {
    businessType: "mi bar",
    city: "el centro",
  });
});

test("describeFromText: texto vacío o en blanco no da nada", () => {
  assert.deepEqual(describeFromText(""), {});
  assert.deepEqual(describeFromText("   "), {});
});

test("describeFromText: la coletilla sola no es un tipo de negocio", () => {
  assert.deepEqual(describeFromText("quiero una pagina web para"), {});
});

test("describeFromText: solo dígitos no es un tipo de negocio", () => {
  assert.deepEqual(describeFromText("12345"), {});
});

test("describeFromText: conserva mayúsculas y acentos del original", () => {
  assert.deepEqual(describeFromText("Hazme una página web para una Panadería La Espiga en Medellín"), {
    businessType: "Panadería La Espiga",
    city: "Medellín",
  });
});

test("describeFromText: la ciudad puede venir seguida de coma y no deja restos", () => {
  // La regla 3 solo quita " en <ciudad>": lo que venga detrás de la coma no se
  // toca, porque el contrato no manda borrarlo.
  assert.deepEqual(describeFromText("una web para una floristería en Cali,"), {
    businessType: "floristería",
    city: "Cali",
  });
  assert.deepEqual(describeFromText("una web para una floristería en Cali, Colombia"), {
    businessType: "floristería, Colombia",
    city: "Cali",
  });
});

test("describeFromText: un tipo de negocio largo se recorta a 120 sin inventar", () => {
  const out = describeFromText(`una web para ${"x".repeat(200)}`);
  assert.equal(out.businessType?.length, 120);
  assert.equal(out.city, undefined);
});

test("normalizeBrief: la frase rellena businessType y city y salen de pending", () => {
  const brief = normalizeBrief({
    description: "quiero una pagina web para un buffet de abogados en barranquilla",
  });
  assert.equal(brief.businessType, "buffet de abogados");
  assert.equal(brief.city, "barranquilla");
  // Los tres que nadie dio siguen pidiéndose: nombre, servicio y contacto.
  assert.deepEqual(brief.pending, ["name", "service", "contact"]);
  assert.equal(brief.pending.length, 3);
});

test("normalizeBrief: lo que el dueño dio por separado no se sobrescribe", () => {
  const brief = normalizeBrief({
    description: "quiero una pagina web para un buffet de abogados en barranquilla",
    city: "Cartagena",
    businessType: "restaurante",
  });
  assert.equal(brief.city, "Cartagena");
  assert.equal(brief.businessType, "restaurante");
  assert.deepEqual(brief.pending, ["name", "service", "contact"]);
});

test("normalizeBrief: sin frase no se rellena nada (sigue el marcador)", () => {
  const brief = normalizeBrief({ name: "Café Aurora" });
  assert.equal(brief.businessType, "pendiente de confirmar");
  assert.equal(brief.city, "pendiente de confirmar");
  assert.deepEqual(brief.pending, ["businessType", "city", "service", "contact"]);
});

// El caso de producción completo: el titular del copy de emergencia deja de
// decir "negocio local" cuando el dueño escribió de qué va su negocio.
test("genericCopy: el titular nombra el negocio de la frase y ya no dice 'negocio local'", () => {
  const brief = normalizeBrief({
    description: "quiero una pagina web para un buffet de abogados en barranquilla",
  });
  const copy = genericCopy(brief);
  assert.equal(copy.businessType, "buffet de abogados");
  // El titular empieza en mayúscula (contrato nuevo: es una frase publicada) y la
  // ciudad se queda tal como la escribió el dueño, sin retocarla. Por eso la
  // comprobación no distingue mayúsculas.
  assert.match(copy.heroHeadline, /buffet de abogados/i);
  assert.doesNotMatch(copy.heroHeadline, /negocio local/i);
  // Lo que `genericCopy` compone hoy de verdad: `service` sigue pendiente, así
  // que la bajada NO nombra el negocio y cae a la frase de su sector (despacho,
  // por «abogados»), no a una neutra igual para todos.
  assert.match(copy.heroSubline, /Te contamos qué opciones hay para tu caso/);
  assert.doesNotMatch(copy.heroSubline, /negocio local/i);
  // El resto del copy de emergencia sí lleva el negocio con su ciudad.
  assert.match(copy.aboutBody, /buffet de abogados en barranquilla/i);
  assert.match(copy.seoDescription, /buffet de abogados en barranquilla/i);
});

// --- Correcciones de la auditoría (contacto no es negocio; barrido no vacía texto) ---

test("describeFromText: un teléfono o un correo no son tipo de negocio", () => {
  for (const contacto of ["+34 600 123 123", "600-123-123", "hola@despacho.es", "600123123"]) {
    assert.deepEqual(describeFromText(contacto), {}, `contacto: ${contacto}`);
  }
  // Control: un número DENTRO de un nombre real sigue valiendo.
  assert.deepEqual(describeFromText("taller 24 horas"), { businessType: "taller 24 horas" });
});

test("describeFromText: el barrido no vacía un texto real al quitar la coletilla", () => {
  // «somos» y «trabajo en» son coletillas del dueño: si lo que queda es
  // demasiado corto, se descarta el barrido y se conserva el texto original en
  // vez de publicar la palabra suelta que dejaba el recorte.
  assert.deepEqual(describeFromText("somos dos"), { businessType: "somos dos" });
  assert.deepEqual(describeFromText("trabajo en alto"), { businessType: "trabajo en alto" });
  // Caso normal: con sustancia de sobra, el barrido se aplica igual que antes.
  assert.deepEqual(describeFromText("somos una peluquería en Getafe"), {
    businessType: "peluquería",
    city: "Getafe",
  });
});

test("describeFromText: un teléfono con letras delante tampoco es tipo de negocio", () => {
  // «Tel.» y «WhatsApp» llevan letras, así que el filtro anterior los dejaba
  // pasar y el titular del hero publicaba el teléfono. Cinco dígitos o más (o un
  // correo) ya no son un nombre de negocio.
  assert.deepEqual(describeFromText("Tel. 600 123 123"), {});
  assert.deepEqual(describeFromText("WhatsApp 600123123"), {});
  // Con ciudad, la ciudad sí se guarda: es el único dato cierto de la frase.
  assert.deepEqual(describeFromText("+34-600-123-123 en Madrid"), { city: "Madrid" });
  assert.deepEqual(describeFromText("hola@x.es en Getafe"), { city: "Getafe" });
  // Un número DENTRO de un nombre real sigue valiendo (dos dígitos).
  assert.deepEqual(describeFromText("taller 24 horas"), { businessType: "taller 24 horas" });
});

test("describeFromText: tras la coletilla del dueño se quita también el artículo", () => {
  // El barrido se descartaba por corto y dejaba la coletilla publicada.
  assert.deepEqual(describeFromText("somos un bar"), { businessType: "bar" });
  assert.deepEqual(describeFromText("me dedico a la fontanería"), { businessType: "fontanería" });
  assert.deepEqual(describeFromText("soy peluquero"), { businessType: "peluquero" });
  // Sin artículo y sin sustancia, se conserva el original (no se publica «dos»).
  assert.deepEqual(describeFromText("somos dos"), { businessType: "somos dos" });
});

test("describeFromText: el artículo solo se quita en minúscula, nunca de un nombre propio", () => {
  // «La» en «La Espiga» es parte del nombre, no un artículo suelto: comparar el
  // artículo en minúsculas se lo comía y publicaba «Espiga» como negocio.
  assert.deepEqual(describeFromText("soy La Espiga"), { businessType: "La Espiga" });
  // Control: en minúscula el artículo sí se quita, como antes.
  assert.deepEqual(describeFromText("me dedico a la fontanería"), { businessType: "fontanería" });
  assert.deepEqual(describeFromText("trabajo en el taller"), { businessType: "taller" });
});
