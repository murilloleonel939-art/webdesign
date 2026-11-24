# Plan de acción — que el producto construya páginas de verdad

Fecha: 2026-11-21. Origen: prueba real en producción (`zottaweb.site/app`, cuenta
alejandro@zottagroup.com) y decisión del dueño del producto.

## Diagnóstico (comprobado en producción, no supuesto)

Brief completo enviado (nombre, tipo, ciudad, servicio, contacto, prompt). El agente
terminó en 10 s con `ok` y "Tu web está lista", pero entregó:

- 4 secciones: `hero`, `text`, `text`, `contact`.
- Dos `text` idénticas con cuerpo `pendiente de confirmar`.
- 0 imágenes, sin ventajas, sin sobre nosotros, sin FAQ, sin CTA final.

Causas:

1. El paso de textos (`generate_copy`) falla y el fallo se oculta: el borrador cae al
   camino sin copy y rellena con el marcador. El run se marca `ok` igual.
2. Producción corre una versión anterior al repo (commit 15c4637 sin el log
   `design_copy_fallback`). `workers` no se redesplegó con el último commit.
3. Filosofía equivocada: el agente se niega a escribir lo que el dueño no dijo y deja
   `pendiente de confirmar`. La competencia (Airo, Lovable, Wix AI, Durable) entrega
   una página completa y el cliente edita lo que no le guste.
4. No distingue **landing** de **sitio de varias páginas**: siempre una sola página
   con el orden del preset.
5. Interfaz con elementos que no aportan ("Copiar resumen", "Deshacer", "Diseñar de
   nuevo", "¿Tienes logo?", preguntas en tarjetas). Ninguna competencia tiene botón
   de copiar resumen.
6. El panel no muestra la página. Auditado con capturas reales de producción
   (`.capturas/`, sesión con la cuenta del dueño): el editor abre la vista vacía, con
   la biblioteca de imágenes encima y tres columnas técnicas de Puck ("Components",
   "Page", "Ruta") en inglés. Detalle en la Fase D.

## Principio nuevo del producto

**El sistema entrega una página terminada. El cliente decide qué cambiar.**

- Escribir con un solo prompt. Cero preguntas obligatorias.
- Nunca `pendiente de confirmar` visible en la página. Texto plausible, genérico y
  editable en su lugar.
- Lo único que no se inventa: cifras concretas, premios, testimonios con nombre real,
  precios exactos. Esos se escriben genéricos o se omiten, sin marcador.
- Fotos siempre (Pexels o biblioteca local). Sin foto, no se entrega.

## Fases del plan

### Fase A — Que funcione lo que ya existe (bloqueante, 1–2 días)
**Archivos:** `apps/workers/src/design-job.ts` (aviso y estado del run),
`apps/workers/src/main.ts` (arranque y variables), `apps/llm-gateway/src/server.ts`,
`agents/design/src/agent.ts` (`generateCopy`, `finishCopy`),
`agents/design/test/copy.test.mjs` (las dos pruebas rojas).

1. Redesplegar `workers` y `llm-gateway` con el último commit.
2. Verificar variables: `workers` (`LLM_GATEWAY_URL`, `PEXELS_API_KEY`,
   `MEDIA_LIBRARY_ROOT`, `DATABASE_URL`, `PLATFORM_INTERNAL_URL`) y `llm-gateway`
   (`LLM_PROVIDER_BASE_URL`, `LLM_PROVIDER_API_KEY`, `LLM_DESIGN_MODEL`).
3. Leer en logs el motivo real de `design_copy_fallback` y corregir la causa.
4. Si el copy falla, el run termina en **error visible**, nunca `ok` con marcadores.
5. Corregir los 2 tests rojos de `agents/design` (reintento de `empty_services` no
   ocurre; test de `seoDescription` contradictorio).

**Criterio de hecho:** mismo brief de la prueba → página con hero con foto, 3+
ventajas, sobre nosotros, galería, FAQ, contacto y CTA. Cero `pendiente de confirmar`.

### Fase B — Cambiar la filosofía de contenido (3–5 días)
**Archivos:** `agents/design/src/brief.ts` (`PENDING_MARKER`),
`agents/design/src/copy.ts` (`copyPrompt`, `guardCopy`, `hasInvention`),
`agents/design/src/draft.ts` (secciones con marcador), `agents/design/src/plan.ts`
(degradar a `text`).

1. Quitar `PENDING_MARKER` de todo texto visible del sitio.
2. El prompt al modelo pide copy completo y verosímil para el tipo de negocio.
3. La guardia (`guardCopy`) solo poda cifras, premios y testimonios inventados; si
   poda, reescribe genérico en vez de dejar vacío o marcador.
4. Testimonios: se omiten (no se inventan personas). Precios: "Consultar" o se omite.
5. Si el modelo falla dos veces: plantilla de textos por tipo de negocio (sin
   marcador), nunca página vacía.

**Criterio de hecho:** 10 prompts distintos de una sola frase → 10 páginas completas,
ninguna con marcador, ninguna con cifra inventada.

### Fase C — Landing vs sitio (3–4 días)
**Archivos:** `agents/design/src/plan.ts` (decidir estructura),
`agents/design/src/draft.ts` (varias `pages`), `packages/site-schema/src/index.ts`
(ya admite varias páginas), `apps/platform/ui/panel.tsx` (navegación por páginas).

1. El agente clasifica el prompt: **landing** (una oferta, un objetivo, un CTA:
   "vendo curso", "lanzamiento", "captar clientes") o **sitio** (negocio con varias
   áreas: "restaurante", "clínica", "estudio").
2. Landing: una página larga orientada a conversión (hero + beneficios + cómo
   funciona + prueba social genérica + FAQ + CTA repetido + formulario).
3. Sitio: varias páginas (Inicio, Servicios, Nosotros, Contacto) con navegación.
4. El cliente puede cambiarlo con una frase ("hazla de varias páginas").

**Criterio de hecho:** "vendo un curso de inglés online" → landing; "clínica dental en
Bogotá" → sitio de 4 páginas con menú.

### Fase D — Interfaz para dummies (3–5 días)
**Archivos:** `apps/platform/ui/panel.tsx` (`Dashboard`, `Editor`, `App`),
`apps/platform/ui/DesignChat.tsx`, `apps/platform/ui/BuilderHome.tsx`,
`apps/platform/ui/design-chat-flow.ts`, `apps/platform/ui/brand.css`,
`apps/platform/ui/builder.css`.

Auditoría del panel actual, hecha con capturas reales en producción (escritorio
1440×900 y móvil 390×844). Evidencia en `.capturas/`.

**D.0 — Lo que está mal hoy, por pantalla**

*Pantalla de entrada:*

- Limpia pero genérica: degradado morado-turquesa, estrella decorativa y "Tu próxima
  gran web empieza aquí". Es el aspecto de plantilla hecha con IA.
- La tarjeta del sitio **no muestra la web**: enseña un cuadro con las iniciales "ZW".
- El título de la tarjeta es el prompt entero partido en cuatro líneas.
- Dos tercios de la pantalla vacíos; nada invita a crear.

*Editor:*

- **La página no se ve.** Ocupa una franja estrecha en el centro y encima tiene la
  ventana "Biblioteca de imágenes" abierta de entrada.
- Tres columnas técnicas de Puck visibles: "Components", "Page", "Ruta" y
  "Descripción para buscadores". Es un panel de desarrollador.
- Textos en inglés mezclados con castellano ("Components", "Toggle left sidebar").
- Un aviso de "datos por confirmar" tapa el chat en cuanto se entra.
- Seis botones a la vez en el chat: Copiar resumen, Ver resultado, Deshacer, Diseñar
  de nuevo, ¿Tienes logo?, Diseñar. El cliente no sabe cuál tocar.
- El chat dice "Tu web está lista" mientras la vista está vacía. Rompe la confianza.

*Móvil:*

- El aviso tapa las pestañas Chat/Vista.
- Solo se ve el chat con los mismos seis botones; la página no aparece.

**D.1 — Inicio: una sola acción**

1. Una caja de texto ("¿Qué vendes?") y un botón. Nada más. Sin pestaña "Panel de
   control", sin subtítulos.
2. La lista de sitios pasa a tarjetas con **miniatura real de la web** (captura del
   HTML renderizado), no iniciales.
3. El nombre de la tarjeta es el nombre del negocio; el prompt queda como descripción
   secundaria en una línea.
4. Estado visible y en castellano: "Borrador", "Publicado".

**D.2 — Resultado: la página es la protagonista**

1. Al terminar, la página ocupa **toda la pantalla**.
2. Barra flotante mínima arriba a la derecha: "Editar" y "Publicar". Nada más.
3. El chat se pliega solo al terminar y se abre con un botón que diga "Cambiar algo".
4. La biblioteca de imágenes **no** se abre sola.
5. Nada de avisos que tapen la vista: los "datos por confirmar" se marcan sobre el
   texto en la propia página, con un borde, no con un cartel flotante.

**D.3 — Editar haciendo clic**

1. Clic sobre un texto → se edita ahí mismo (edición en línea).
2. Clic sobre una imagen → elegir de la biblioteca o subir.
3. Ocultar Puck al cliente. Si se conserva para el operador, detrás de una opción
   "Avanzado".
4. Todo en castellano: fuera "Components", "Page", "Toggle sidebar".

**D.4 — Quitar ruido**

1. Fuera "Copiar resumen". No existe en ninguna competencia y el cliente no copia
   un resumen: mira su página.
2. Fuera "Diseñar de nuevo" y "¿Tienes logo?" como botones. Todo eso se pide
   escribiendo: "cambia los colores", "pon mi logo", "añade precios".
3. Fuera las tarjetas de preguntas del chat. Si falta un dato, se infiere.
4. "Deshacer" se queda, pero como una sola flecha discreta, no como botón de texto.

**D.5 — Criterio de hecho**

Una persona sin experiencia crea y publica su página en menos de 3 minutos sin leer
instrucciones, y al terminar ve su web a pantalla completa, no una vista vacía.

### Fase E — El agente construye como un estudio (5–7 días)

Base: la sección «Cómo construye el agente» de este documento.

1. Importar del catálogo lo que falta: `ui-reasoning.csv` y `products.csv` (194
   perfiles), `motion.csv` (17), `colors.csv` (194). Con el mismo importador y su
   filtro por `lint-visual`.
2. Que el orden de secciones salga del **patrón de landing** (`landing.csv`) según el
   objetivo del negocio, no del preset.
3. Tokens de partida propios: quitar Inter y `#3b82f6` de `initialDoc`; cada sitio
   arranca con dirección visual elegida.
4. Reglas nuevas de `lint-visual` para los tells 1, 6 y 7 (tokens de fábrica, glow sin
   pedirlo, emoji como icono).
5. `critique_draft` pasa a informe con los 9 tells y su peso, no solo los códigos.

**Archivos:** `packages/catalog-import/src/build.ts`, `packages/lint-visual/src/`,
`packages/agent-sdk/src/design-tools.ts`, `agents/design/src/plan.ts`,
`apps/platform/src/api.ts` (`initialDoc`), `packages/db/migrations/` (nueva).

**Criterio de hecho:** misma prueba de 10 prompts: ninguna página arranca con Inter ni
con azul de Tailwind; el informe de estilo dice qué tell se disparó y con qué peso; el
orden de secciones cambia según el objetivo del negocio.

### Fase F — Calidad visual a nivel competencia (continuo)

1. Comparar lado a lado con Airo/Durable con los mismos 10 prompts.
2. Más variantes de sección (hero partido, hero con foto de fondo, tarjetas, iconos).
3. Fotos coherentes con el negocio (consultas de Pexels mejores).

### Después (no antes)

Registro de usuarios, cobros, dominios propios. No tiene sentido abrir el alta hasta
que las fases A–E estén hechas.

## Cómo construye el agente — los skills de diseño como DATO

Regla del repo que no se rompe (spec 7.7): **nada entra como prompt de sistema.** Todo
entra como fila de catálogo o como regla determinista. El agente **consulta**, no
razona el diseño; y lo que no pasa `lint-visual` no se activa.

Revisado en disco: `/root/.agents/skills/`. Licencia comprobada fichero a fichero.

| Skill | Licencia | Qué aporta | Cómo entra |
| --- | --- | --- | --- |
| `ui-ux-pro-max` | **MIT** | 89 estilos, 34 patrones de landing con orden de secciones, 74 parejas tipográficas, 130 reglas UX, 194 perfiles de producto y razonamiento, 194 paletas, 17 presets de movimiento, 105 iconos, 25 tipos de gráfico | Filas de las tablas de 7.5. **Ya importado a medias** |
| `unslop-ui` | **MIT** | 9 «tells» de web hecha con IA, con el peso real de cada uno (análisis de 3,2 M de posts) | Reglas `SLOP_*` de `lint-visual` |
| `frontend-design` | **MIT** | Dirección visual deliberada: paleta, tipografía, estructura, textura | Criterio de `critique_draft` y del brief |
| `ui-styling` | **Apache 2.0** | Tokens, componentes accesibles, modo oscuro | Tokens del tema |
| `design`, `brand`, `animate`, `design-system`, `emil-design-eng`, `learn-taste` | **sin LICENSE** | Ideas de dirección de arte, marca y movimiento | **Solo ideas propias.** No se copia su texto |

### Lo que ya está importado (y lo que no)

`packages/catalog-import` lee los CSV de `ui-ux-pro-max` fijados al commit
`e59ff37`, normaliza al shape propio y filtra por `lint-visual`. Resultado actual:
140 paletas activas de 194, 8 parejas tipográficas de 74, 24 patrones de landing de 34,
89 estilos como `reference`.

**Sin aprovechar todavía:** `products.csv` (194), `ui-reasoning.csv` (194),
`motion.csv` (17), `colors.csv` (194), `icons.csv` (105), `charts.csv` (25),
`app-interface.csv` (32).

### Los 9 tells de `unslop-ui`, cruzados con lo que ya comprueba `lint-visual`

| # | Tell | Peso en los datos | Estado en el proyecto |
| --- | --- | --- | --- |
| 1 | Look por defecto de shadcn/Tailwind | 2,5 % — la causa nº1 | **Sin regla.** El renderer genera CSS propio, pero los tokens de partida son de fábrica |
| 2 | Violeta/índigo como color primario | 2,3 % | Parcial con `SLOP_MULTIPLE_ACCENTS` |
| 3 | Degradados por todas partes | 2,0 % | `SLOP_GENERIC_GRADIENT` |
| 4 | Demasiadas animaciones | 1,1 % | 4 reglas `MOTION_*` |
| 5 | Todo redondeado y en píldora | 0,8 % | `SLOP_SAME_CARD_RADIUS` |
| 6 | Glow neón sin pedirlo | 0,7 % | **Sin regla** |
| 7 | Emoji como iconos | 0,5 % | **Sin regla** (el renderer no usa iconos) |
| 8 | Fuentes genéricas (Inter, Geist, Roboto) | 0,4 % | `SLOP_FONT_MONOCULTURE` |
| 9 | Hero centrado + 3 tarjetas + CTA | 0,4 % | `SLOP_CENTERED_EVERYTHING` |

### Hallazgo comprobado: el producto cae hoy en los tells 1, 2 y 8

- `apps/platform/src/api.ts` (`initialDoc`) crea el tema con `family: "Inter"` y
  `accent: "#3b82f6"` — el azul de Tailwind. Es el tell 1 + 2 + 8 exactos, y es el
  estado del que parte **todo sitio nuevo**.
- De los 8 presets de `0009_design_catalog.sql`, **dos usan Inter** y uno lleva
  `accent: #5b3df5`, que es violeta de IA (tell 2).

Por eso la web que entrega el agente se ve genérica aunque el linter no proteste: no
hay ninguna regla que mire los tokens de partida.

### Lo que el agente debe hacer al construir (no solo aplicar un preset)

1. **Leer el patrón de landing** (`landing.csv`): orden de secciones, dónde va el CTA
   principal, estrategia de color. Hoy el orden sale del preset, no del objetivo.
2. **Elegir perfil de producto** (`ui-reasoning.csv`): 194 perfiles con patrón
   recomendado, prioridad de estilo, ánimo de color y tipografía, y anti-patrones.
3. **Fijar tokens propios**: fuera Inter por defecto y fuera el azul de Tailwind. Cada
   sitio arranca con una dirección visual elegida, no con la de fábrica.
4. **Pasar la revisión anti-slop antes de entregar**: los 9 tells con su peso. Los tres
   primeros son los que hacen que alguien diga «esto lo hizo una IA».
5. **Movimiento con receta** (`motion.csv`): duración, easing y `prefers-reduced-motion`
   por tipo de interacción, no un valor único.
6. **Avisar sin bloquear**: un hallazgo de estilo se entrega con aviso y confirmación del
   dueño (spec 6.5), nunca corta la entrega.

## Lo que NO se hace ahora

- No se toca hosting, Caddy, dominios ni pagos.
- No se añaden más reglas de lint visual.
- No se amplía el catálogo de estilos.

## Evidencias de esta revisión

- `.capturas/escritorio-1-entrada.png`: pantalla de entrada, tarjeta con iniciales.
- `.capturas/escritorio-2-editor.png`: editor con Puck, biblioteca de imágenes abierta
  y seis botones en el chat.
- `.capturas/movil-1-entrada.png`, `.capturas/movil-2-editor.png`: móvil 390×844.
- Prueba del agente: `POST /api/sites/<id>/design-runs` → `ok` en 10 s con 4 secciones
  y dos `pendiente de confirmar`.
