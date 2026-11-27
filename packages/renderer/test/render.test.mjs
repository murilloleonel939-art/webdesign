import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, escapeHtml, themeCss } from "../dist/index.js";
import { validateSiteDocument } from "@webdesign/site-schema";

const doc = () => ({
  schemaVersion: 1,
  meta: { name: "Café", lang: "es" },
  design: { brief: "b", idea: "i", presetId: "p", dials: { variance: 5, motion: 5, density: 5 } },
  theme: {
    colors: { ground: "#F4EFE6", ink: "#1B1B1B", accent: "#B3422B" },
    typography: { family: "Inter", scale: "s" },
    spacing: { margin: 24, sectionGap: 160 },
    radius: "square",
  },
  pages: [{
    id: "p_home", slug: "/", seo: { title: "Inicio", description: "desc", noindex: false },
    sections: [
      { id: "s_hero", type: "hero", props: { headline: "Hola", cta: { label: "Ir", href: "https://x.com" } } },
      { id: "s_img", type: "image", props: { assetId: "a1" } },
    ],
  }],
  assets: [{ id: "a1", alt: "Foto" }],
});

test("escapes user text", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;");
  const d = doc();
  d.pages[0].sections[0].props.headline = "<img src=x onerror=alert(1)>";
  const html = renderPage(d, "p_home");
  assert.ok(!html.includes("<img src=x onerror"));
});

test("renders title, description, CSP and lang", () => {
  const html = renderPage(doc(), "p_home");
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="es">/);
  assert.match(html, /<title>Inicio<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'none'/);
});

test("external links carry rel noopener", () => {
  assert.match(renderPage(doc(), "p_home"), /rel="noopener noreferrer"/);
});

test("asset resolver supplies src", () => {
  const html = renderPage(doc(), "p_home", (id) => (id === "a1" ? { src: "/a/1.webp", alt: "Foto" } : undefined));
  assert.match(html, /src="\/a\/1.webp"/);
});

test("unknown page throws", () => {
  assert.throws(() => renderPage(doc(), "nope"), /page not found/);
});

test("an unverified testimonial never reaches the published HTML", () => {
  const d = doc();
  d.pages[0].sections = [{ id: "s_t", type: "testimonial", props: { quote: "cita inventada", author: "X" } }];
  const html = renderPage(d, "p_home");
  assert.ok(!html.includes("cita inventada"));
  assert.ok(!html.includes("<blockquote"));
  const ok = structuredClone(d);
  ok.pages[0].sections[0].props.ownerProvided = true;
  assert.match(renderPage(ok, "p_home"), /cita inventada/);
});

test("el sitio publicado lleva el CSS de su tema y el formulario", () => {
  const doc = {
    schemaVersion: 1,
    meta: { name: "Luna", lang: "es" },
    design: { brief: "", idea: "", presetId: "tech", dials: { variance: 3, motion: 2, density: 5 } },
    theme: {
      colors: { ground: "#0e1117", ink: "#e8eef7", accent: "#7dd3fc" },
      typography: { family: "Inter", scale: "normal" },
      spacing: { margin: 48, sectionGap: 64 },
      radius: "rounded",
    },
    pages: [{ id: "p_home", slug: "/", seo: { title: "Luna", description: "", noindex: true },
      sections: [{ id: "s1", type: "contact", props: { email: "ana@ejemplo.com" } }] }],
    assets: [],
  };
  const html = renderPage(doc, "p_home");
  // Regresion: antes el renderer no emitia CSS y el sitio salia sin tema.
  assert.ok(html.includes("<style>"), "debe incluir la hoja del tema");
  assert.ok(html.includes("#0e1117"), "debe usar el color del documento");
  assert.ok(html.includes("/_f/lead"), "el formulario apunta al endpoint");
  // Sin fuentes externas: cargarlas revelaria el sitio del cliente a un tercero.
  assert.equal(/fonts\.googleapis|fonts\.gstatic/.test(html), false);
});

// Regresion: React 19 serializa `maxLength`/`autoComplete` en camelCase y los
// booleanos como `required=""`. El navegador lo toleraba, pero el HTML dejaba de
// ser valido y `@webdesign/quality` lo detecto en CI. Se normaliza en el
// renderer para que ningun componente tenga que saberlo.
test("los atributos salen en minusculas y los booleanos sin valor", () => {
  const d = doc();
  d.pages[0].sections = [{ id: "s_c", type: "contact", props: { email: "a@b.example", phone: "600000000" } }];
  const html = renderPage(d, "p_home");
  assert.ok(!/maxLength|autoComplete|readOnly/.test(html), html.slice(0, 400));
  assert.ok(!/required=""/.test(html));
  assert.match(html, /<input[^>]*maxlength="\d+"/);
  // El valor de un atributo no se toca: solo el nombre.
  const img = renderPage(doc(), "p_home", (id) => (id === "a1" ? { src: "/a1.png", alt: "Taza de Café XL" } : undefined));
  assert.match(img, /alt="Taza de Café XL"/);
});

// --- T-003.1: barra de navegación entre páginas ------------------------------

function multiDoc() {
  const base = doc();
  base.pages = [
    { id: "p_home", slug: "/", seo: { title: "Inicio", description: "", noindex: false },
      sections: [{ id: "s1", type: "hero", props: { headline: "Hola", cta: { label: "Ir", href: "https://x.com" } } }] },
    { id: "p_servicios", slug: "/servicios", seo: { title: "Servicios", description: "", noindex: false },
      sections: [{ id: "s2", type: "hero", props: { headline: "Servicios", cta: { label: "Ir", href: "https://x.com" } } }] },
    { id: "p_sobre", slug: "/sobre-nosotros", seo: { title: "Sobre nosotros", description: "", noindex: false },
      sections: [{ id: "s3", type: "hero", props: { headline: "Sobre", cta: { label: "Ir", href: "https://x.com" } } }] },
  ];
  return base;
}

test("T-003.1: una sola página no emite site-nav ni aria-current", () => {
  const single = doc(); // una sola página
  const htmlBefore = renderPage(single, "p_home");
  const html = renderPage(single, "p_home");
  // La clase .site-nav y el selector aria-current están en el CSS pero no como
  // elemento HTML con 1 página: se comprueba que no hay el elemento nav.
  assert.doesNotMatch(html, /<nav class="site-nav"/, "no debe haber elemento nav.site-nav con 1 página");
  // aria-current no debe aparecer en un atributo HTML (fuera del CSS).
  // El CSS lo usa como selector: `a[aria-current="page"]`. Solo buscamos el
  // atributo en etiquetas de apertura, que nunca forman parte del CSS.
  const bodyStart = html.indexOf("</head>");
  const bodyHtml = bodyStart > -1 ? html.slice(bodyStart) : html;
  assert.doesNotMatch(bodyHtml, /aria-current="page"/, "no debe haber aria-current en el HTML con 1 página");
  // El HTML es idéntico entre dos llamadas: el comportamiento de 1 página no cambió.
  assert.equal(html, htmlBefore);
});

test("T-003.1: 3 páginas - nav con 3 enlaces, hrefs correctos, etiquetas y aria-current", () => {
  const d = multiDoc();
  const html = renderPage(d, "p_home");
  assert.match(html, /class="site-nav"/, "debe haber site-nav");
  // 3 enlaces
  const links = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
  const navLinks = links.filter((m) => m[0].includes("site-nav") || html.slice(html.indexOf("site-nav"), html.indexOf("</nav>", html.indexOf("site-nav"))).includes(m[0]));
  // Extrae el nav completo para contar los enlaces dentro
  const navMatch = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, "nav.site-nav debe existir");
  const navHtml = navMatch[1];
  const navLinkMatches = [...navHtml.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
  assert.equal(navLinkMatches.length, 3, "debe haber 3 enlaces en el nav");
  // hrefs correctos
  assert.equal(navLinkMatches[0][1], "/");
  assert.equal(navLinkMatches[1][1], "/servicios");
  assert.equal(navLinkMatches[2][1], "/sobre-nosotros");
  // etiquetas
  assert.equal(navLinkMatches[0][2].trim(), "Inicio");
  assert.equal(navLinkMatches[1][2].trim(), "Servicios");
  assert.equal(navLinkMatches[2][2].trim(), "Sobre nosotros");
  // aria-current solo en la página actual (p_home = /)
  const ariaCurrent = navHtml.match(/aria-current="page"/g) ?? [];
  assert.equal(ariaCurrent.length, 1, "solo un aria-current");
  assert.match(navHtml.match(/<a[^>]*aria-current="page"[^>]*>[^<]+<\/a>/)?.[0] ?? "", /href="\/"/, "aria-current en /");
});

test("T-003.1: slug anidado produce etiqueta del último segmento", () => {
  const d = doc();
  d.pages = [
    { id: "p_home", slug: "/", seo: { title: "Inicio", description: "", noindex: false },
      sections: [{ id: "s1", type: "hero", props: { headline: "H", cta: { label: "Ir", href: "https://x.com" } } }] },
    { id: "p_taller", slug: "/servicios/talleres", seo: { title: "Talleres", description: "", noindex: false },
      sections: [{ id: "s2", type: "hero", props: { headline: "T", cta: { label: "Ir", href: "https://x.com" } } }] },
  ];
  const html = renderPage(d, "p_taller");
  const navMatch = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, "nav.site-nav debe existir");
  const navHtml = navMatch[1];
  // El slug completo aparece en el href
  assert.match(navHtml, /href="\/servicios\/talleres"/, "href debe ser el slug completo");
  // La etiqueta es el último segmento
  assert.match(navHtml, />Talleres<\/a>/, "etiqueta es el último segmento");
});

test("T-003.1: cada página marca solo su propio enlace con aria-current", () => {
  const d = multiDoc();
  for (const page of d.pages) {
    const html = renderPage(d, page.id);
    const navMatch = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, `nav.site-nav debe existir en ${page.id}`);
    const navHtml = navMatch[1];
    const currentLinks = [...navHtml.matchAll(/<a ([^>]*aria-current="page"[^>]*)>/g)];
    assert.equal(currentLinks.length, 1, `solo un aria-current en ${page.id}`);
    assert.ok(currentLinks[0][1].includes(`href="${page.slug}"`) || navHtml.includes(`href="${page.slug}" aria-current="page"`), `aria-current apunta a ${page.slug}`);
  }
});

test("T-003.1: los hrefs del nav son slugs válidos del documento (sin BROKEN_INTERNAL_LINK)", () => {
  // El linter (@webdesign/linter) no es dependencia del renderer. Se verifica
  // directamente: cada href del nav debe ser el slug de una página del documento.
  const d = multiDoc();
  const slugs = new Set(d.pages.map((p) => p.slug));
  for (const page of d.pages) {
    const html = renderPage(d, page.id);
    const navMatch = html.match(/<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch, `nav.site-nav debe existir en ${page.id}`);
    const hrefs = [...navMatch[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      assert.ok(slugs.has(href), `href "${href}" no corresponde a ninguna página`);
    }
  }
});

test("T-003.1: validateSiteDocument sigue pasando (esquema no tocado)", () => {
  assert.equal(validateSiteDocument(doc()).ok, true, "1 página");
  assert.equal(validateSiteDocument(multiDoc()).ok, true, "3 páginas");
});

// T-025: las secciones nuevas se renderizan y su CSS usa solo tokens del tema.
test("testimonials y metrics salen en el HTML y su CSS no trae colores literales", () => {
  const d = doc();
  d.pages[0].sections.push(
    { id: "s_t", type: "testimonials", props: { items: [{ quote: "Muy bien", name: "Ana" }], ownerProvided: true } },
    { id: "s_m", type: "metrics", props: { items: [{ value: "15 años", label: "abiertos" }] } },
  );
  const html = renderPage(d, "p_home");
  assert.match(html, /class="testimonials"/);
  assert.match(html, /Muy bien/);
  assert.match(html, /class="metrics"/);
  assert.match(html, /15 años/);
  const rules = html.split("\n").filter((l) => /^\.(testimonials|metrics|pricing__plan--featured)/.test(l));
  assert.ok(rules.length >= 8, `reglas: ${rules.length}`);
  for (const r of rules) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, r);
});

// T-026: un documento con las tres secciones de prueba social llenas (los
// mínimos que exige el panel: 3 cifras, 1 testimonio, 1 plan) valida contra
// siteSchema y las tres se renderizan en el HTML publicado.
test("T-026: metrics (3), testimonials (1) y pricing (1) validan y renderizan juntos", () => {
  const d = doc();
  d.pages[0].sections.push(
    {
      id: "s_metrics", type: "metrics",
      props: { heading: "En cifras", items: [
        { value: "+120", label: "pacientes al año" },
        { value: "15 años", label: "de experiencia" },
        { value: "4,9/5", label: "valoración media" },
      ] },
    },
    {
      id: "s_testimonials", type: "testimonials",
      props: { heading: "Opiniones", ownerProvided: true, items: [
        { quote: "Un trato excelente de principio a fin.", name: "Marta López", role: "Paciente" },
      ] },
    },
    {
      id: "s_pricing", type: "pricing",
      props: { heading: "Precios", plans: [
        { name: "Consulta inicial", price: "$299", features: ["Valoración completa", "Informe escrito"], highlighted: true },
      ] },
    },
  );
  const result = validateSiteDocument(d);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.errors));

  const html = renderPage(d, "p_home");
  assert.match(html, /class="metrics"/);
  assert.match(html, /\+120/);
  assert.match(html, /pacientes al año/);
  assert.match(html, /class="testimonials"/);
  assert.match(html, /Un trato excelente de principio a fin\./);
  assert.match(html, /Marta López/);
  assert.match(html, /class="pricing"/);
  assert.match(html, /Consulta inicial/);
  assert.match(html, /\$299/);
  assert.match(html, /Valoración completa/);
});

test("el hero con foto va a ancho completo 16:9 con alto mínimo, y la galería en cuadradas de 200px", () => {
  // Pedido del dueño: «solo coloca fotos pequeñas». La causa estaba en el CSS:
  // el hero metía la foto en una columna estrecha (1.4fr/.6fr) sin proporción
  // fija, y la galería usaba 4:3 con un suelo de 220px que no se respetaba al
  // repartir en más columnas. Estas reglas son el contrato visual: si alguien
  // las cambia, la página vuelve a verse como una maqueta.
  const css = themeCss(doc().theme);

  // Hero: la foto ocupa su columna entera, 16:9 y 320px de alto mínimo (móvil).
  assert.match(css, /\.hero--image img\{[^}]*aspect-ratio:16\/9/);
  assert.match(css, /\.hero--image img\{[^}]*min-height:320px/);
  assert.match(css, /\.hero--image img\{[^}]*object-fit:cover/);
  assert.match(css, /\.hero--image img\{[^}]*width:100%/);

  // Galería: rejilla con suelo de 200px y fotos cuadradas.
  assert.match(css, /\.gallery\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(200px,100%\),1fr\)\)/);
  assert.match(css, /\.gallery img\{[^}]*aspect-ratio:1/);
  assert.match(css, /\.gallery img\{[^}]*object-fit:cover/);

  // Y el hero sigue manteniendo su variante con imagen (la clase que decide el
  // componente cuando hay foto resuelta).
  assert.match(css, /\.hero--image\{display:grid/);
});
