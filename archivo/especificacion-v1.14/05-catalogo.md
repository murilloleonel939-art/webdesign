### 7.7 Biblioteca de estilos dinámica

El catálogo de diseño **crece solo, con frenos automáticos y una comprobación legal previa**. El sistema descubre orígenes nuevos, encuentra páginas nuevas en los que ya tiene, captura sus propiedades medibles, genera variantes y aprende del estilo que los usuarios eligen y publican. **Ninguna tarea humana en el ciclo operativo.** La única puerta humana es el dictamen legal de activación (7.7.9.C).

#### 7.7.1 Fuentes permitidas

Solo entran fuentes con **diseño abierto y licencia libre explícita**, verificada y registrada:

| Familia de fuente | Ejemplos | Licencia | Qué se extrae |
| --- | --- | --- | --- |
| Design systems públicos | Material Design 3, IBM Carbon, Shopify Polaris, GitHub Primer, Atlassian, GOV.UK Design System, USWDS | Apache 2.0, MIT, OGL v3, dominio público | Escalas tipográficas, tokens de color, espaciado, radios, elevación, patrones de sección |
| Plantillas open source | HTML5 UP, Start Bootstrap, AstroWind, plantillas Astro/Next con licencia declarada | MIT, CCA 3.0, Apache 2.0 | Composición de secciones, orden de bloques, densidad y ritmo |
| Colecciones de color y tipografía | Open Color, Radix Colors, Tailwind Colors, Google Fonts (OFL), Lucide, Heroicons | MIT, OFL, ISC | Paletas en OKLCH, pairings tipográficos, peso y escala |
| Recursos de ilustración libres | unDraw, ilustraciones CC0 | Licencia declarada por el autor | Estilo de ilustración, nunca la ilustración |

**Prohibido como fuente, sin excepciones:** Dribbble, Behance, Awwwards y galerías de diseño (sus términos prohíben el crawling y sus imágenes tienen autores con derechos); sitios de negocios reales (no licencian derivados); y cualquier fuente cuya licencia no esté registrada en `design_origins.license`.

**Regla de oro:** el catálogo extrae **propiedades medibles** —una escala, una paleta, un ritmo, una proporción— y las combina.

> **Aviso legal, sin adornos:** que una página tenga un fichero `LICENSE` o una etiqueta de licencia **no prueba que quien la publica tenga derechos sobre ese contenido**, ni que cubra la composición extraída. La afirmación de que «un diseño concreto no es copiable» es una apreciación jurídica, no un hecho técnico, y la valida un abogado **antes** de activar el catálogo en producción. CC-BY y CC-BY-SA añaden obligaciones de atribución: mientras no estén resueltas, **esas licencias no alimentan el catálogo**. Ver 7.7.9.

**Descubrimiento de fuentes:** los orígenes no los da de alta una persona. El job `catalog-discover` (7.7.8) busca páginas nuevas en la lista semilla (nivel 1) y, si se habilita, orígenes nuevos (nivel 2). **La licencia se verifica por código** contra `license_allowlist`. Lo que no se puede verificar, se descarta.

**Lista de arranque (`design_origin_seeds`):** para no empezar vacío, se siembra **una sola vez** una lista de dominios conocidos (los de la tabla anterior: `m3.material.io`, `carbondesignsystem.com`, `polaris.shopify.com`, `primer.style`, `design-system.service.gov.uk`, `designsystem.digital.gov`, `html5up.net`, `startbootstrap.com`, `astro.build/themes`, `tailwindcss.com/plus`, `fonts.google.com`, `opencolor`, `radix-ui.com/colors`, `lucide.dev`, `heroicons.com`, `undraw.co`). Desde ahí el sistema se expande solo. La lista se versiona en código, no en base de datos: solo cambia con un despliegue.

**Licencias permitidas** (`license_allowlist`, en configuración versionada): MIT, Apache-2.0, BSD-2/3-Clause, ISC, CC0-1.0, OFL-1.1, Unlicense, OGL-3.0 y dominio público. **CC-BY y CC-BY-SA quedan fuera** hasta que el abogado determine cómo se cumple la atribución dentro de un sitio generado. Cualquier otra se descarta.

#### 7.7.2 Ciclo automático mensual

**Job diario `catalog-crawler`:**

1. Recorre los `design_origins` con `crawl_schedule` vencida (incluidos los descubiertos en 7.7.8).
2. Respeta `robots.txt`, sin paralelismo agresivo y con user-agent propio.
3. Lee **CSS computado y estructura del DOM** con Playwright (Fase 5b, `sandbox-web`, `egress-proxy`).
4. Calcula el hash de la página; si no cambió desde `last_crawl_at`, la salta.
5. Extrae los descriptores y guarda la página en `design_pages` con estado `approved`: **sin HTML y sin assets descargados**. Se conserva una **captura de pantalla** solo como evidencia de auditoría; no se usa para recomendar, no se muestra a nadie en el flujo normal y no se envía a ningún modelo.

**Job mensual `catalog-generate-variants` (día 1):**

1. Toma todas las páginas capturadas desde el ciclo anterior.
2. **Genera automáticamente 3–5 variantes** por página (7.7.4).
3. Valida cada variante de forma determinista: reglas responsive completas, sin `error` de 6.5 en la vista previa y similitud ≤ 0,75 con la página base.
4. **Las que pasan se escriben directamente en `design_catalog_entries` con estado `active`.** No hay cola de aprobación ni intervención humana en ningún punto.
5. Las que fallan se registran como `discarded` con su motivo (`responsive_incomplete`, `slop_error`, `similarity_too_high`). No se reintentan solas; la siguiente captura de la página las vuelve a generar.
6. Calcula el orden de recomendación con `chosen_count`, `published_count` y el vector de preferencia (7.7.3).

**Job día 2:** se recalcula el vector de preferencia del mes y se actualiza `next_crawl_at` por origen. Nada más que aprobar.

#### 7.7.3 Aprendizaje del estilo preferido

El sistema aprende **qué tipo de diseño eligen y publican los usuarios** y usa ese criterio para decidir **qué buscar** y **en qué orden proponerlo**. No guarda páginas del usuario: guarda la elección.

**Registro:**

- `design_variant_feedback` (owner_id, entry_id, variant, action `chosen|published|discarded`, site_id, created_at)
- Se anota en tres momentos: cuando el agente propone una entrada y el dueño la acepta, cuando ese sitio se publica (peso doble) y cuando la descarta (peso negativo).
- **Solo cuentan los sitios con suscripción `active` al registrar el evento.** La prueba no alimenta al vector: si no, crear cuentas gratis bastaría para torcer el catálogo.
- **Peso máximo por cuenta:** un mismo `owner_id` no puede aportar más del 2 % del peso total de un ciclo. Cien cuentas falsas no mueven la aguja.
- Se descartan los eventos de cuentas suspendidas por abuso y los de cuentas con menos de 24 horas de antigüedad.

**Cálculo:**

- Por usuario se mantiene un `preference_vector` en `design_style_preferences`: contraste, calidez de la paleta (hue en OKLCH), densidad, escala tipográfica, radio y elevación.
- Se recalcula **una vez al mes** con las acciones del periodo, ponderando `published` ×2, `chosen` ×1, `discarded` ×−1, con decaimiento temporal y con el tope por cuenta del párrafo anterior.
- El vector se guarda en OKLCH para poder compararlo numéricamente con los tokens del catálogo.

**Uso:**

- `recommend_design_system` ordena las entradas `active` por **similitud coseno con el vector del usuario** (por encima de 0,75 se destaca).
- El vector agregado de todos los usuarios pondera el orden de las propuestas del mes siguiente: si un tipo de diseño casi nunca se elige, baja en la lista aunque siga disponible.
- El criterio **nunca elimina** una variante del catálogo: solo cambia el orden en que se ofrece.

#### 7.7.4 Generación automática de variantes

Partiendo de los tokens de una página capturada, se generan estas variantes con reglas deterministas (sin modelo):

| Variante | Qué cambia |
| --- | --- |
| `base` | Los tokens tal como se extrajeron |
| `bolder` | +30 % de saturación, un paso más en la escala tipográfica, sombras más marcadas, espaciado −10 %, radios más redondeados |
| `quieter` | −40 % de saturación, un paso menos en la escala, radios más contenidos, espaciado +15 %, sombras más suaves |
| `minimal` | Paleta monocromática derivada del acento, solo 2–3 pesos tipográficos, sin sombras, espaciado métrico |
| `warmth` | Paleta hacia tonos cálidos (hue OKLCH +45–60°), espaciado no métrico, radios y sombras suaves |
| `tech` | Paleta fría y gris, presencia de monoespaciada, alineación estricta, espaciado métrico de 8 px, sin radios |

Cada variante se escribe en `design_catalog_entries` con sus `responsive_rules` completas en 360, 390, 768, 1024, 1280 y 1536 px. **Una variante sin reglas responsive no se genera.**

#### 7.7.5 Registro de solo lectura

No hay panel de aprobación: **nadie aprueba nada.** `/admin/design-catalog/log` es un histórico mensual, de consulta y no de decisión:

- Páginas capturadas por origen y variantes activadas de cada una.
- Variantes descartadas por validación, con el motivo exacto.
- Variantes más elegidas y más publicadas por los usuarios.
- Orígenes con más crecimiento y orígenes sin cambios.

Sirve para diagnosticar, no para bloquear. Si una variante activada resulta defectuosa, el operador puede marcarla `deprecated` a posteriori, y eso es una corrección, no una puerta del flujo.

#### 7.7.6 Tablas

- `design_origins` (id, url, kind, license, license_url, author, crawl_schedule, last_crawl_at, next_crawl_at, status)
- `design_pages` (id, origin_id, url, path, hash, extracted_tokens jsonb, screenshot_path, captured_at, status `pending|approved|deprecated`)
- `design_catalog_entries` (id, page_id, variant `base|bolder|quieter|minimal|warmth|tech`, tokens jsonb, responsive_rules jsonb, usage_count, chosen_count, published_count, status `pending|active|deprecated`, approved_by, approved_at)
- `design_style_preferences` (owner_id, preference_vector jsonb, computed_at)
- `design_variant_feedback` (id, owner_id, entry_id, variant, action `chosen|published|discarded`, site_id, created_at)

#### 7.7.7 Originalidad

- El agente registra qué entrada usó al generar un sitio. El sistema compara los `tokens` del sitio con los de la página que originó esa entrada.
- Superar el umbral (0,85 en paleta, 0,9 en escala) emite `DESIGN_TOO_CLOSE_TO_SOURCE`, **aviso y no bloqueo**, con la opción de variar.
- La comparación es **numérica sobre tokens**: barata, y no exige conservar material ajeno.
- Una entrada que acumule avisos de similitud pasa a `deprecated` de forma automática; no hay revisión humana.

#### 7.7.8 Descubrimiento de páginas y orígenes (por niveles)

Dos búsquedas, las dos automáticas y mensuales, pero **no se encienden a la vez**.

- **Nivel 1, en el lanzamiento de la Fase 5b:** descubrimiento de **páginas nuevas dentro de la lista semilla** (7.7.8 A). Es el único que se activa al principio.
- **Nivel 2, apagado por defecto:** descubrimiento de **orígenes nuevos** (7.7.8 B). Se enciende solo si el operador lo habilita de forma explícita, y exige el dictamen legal de 7.7.9. Es un rastreo abierto: no se lanza sin esa decisión.

**A. Páginas nuevas dentro de los orígenes que ya se tienen.**

1. Para cada `design_origin` activo, se visitan sus **páginas índice**: la galería de plantillas (`html5up.net`), el listado de temas (`startbootstrap.com`), el índice de componentes o el changelog del design system.
2. Se extraen los enlaces internos del mismo dominio que cumplen `design_origins.link_pattern`, una expresión regular de rutas válidas por origen.
3. Se filtran los ya capturados, por URL y por hash de contenido.
4. Los nuevos entran como `design_pages` y se procesan en el mismo ciclo.

Si `html5up.net` publica tres plantillas nuevas, el sistema las encuentra solo. No hace falta que nadie avise.

**B. Orígenes nuevos (nivel 2, apagado por defecto).**

1. **Expansión desde los conocidos:** los enlaces salientes de los orígenes actuales que apunten a otros sitios de diseño (`kind = design-system|template`) y pasen el filtro de dominio.
2. **Búsqueda por categoría:** consulta de índices públicos de proyectos con licencia que exponen tokens o plantillas.
3. **Verificación automática de licencia**, obligatoria antes de aceptar un candidato:
   - `LICENSE`, `LICENSE.md` o `COPYING` en la raíz del dominio o del repositorio.
   - Metadatos del documento: `<meta name="license">`, `rel="license"`, enlaces a `choosealicense.com`, `creativecommons.org`, `opensource.org`, `spdx.org`.
   - Campo `license` del `package.json` o del `composer.json` si el origen es un repositorio.
   - Coincidencia con `license_allowlist`. Sin coincidencia clara **se descarta** con el motivo `license_unverified`.
4. **Comprobación de `robots.txt` y de volumen:** la ruta debe estar permitida y se limita a **20 páginas por origen y ciclo** para no raspar un sitio entero.
5. **Alta automática:** el origen aceptado se escribe en `design_origins` con `status active`, `license` verificada, `license_url`, `license_evidence` (la URL exacta donde se comprobó) y `crawl_schedule` mensual. Se captura en el ciclo siguiente.

**Filtros de seguridad, siempre activos (nivel 1 y nivel 2):**

- Solo dominios públicos: nunca IPs privadas ni rangos internos (`egress-proxy`).
- Sin sesiones, sin cookies y sin JavaScript de terceros.
- Tope de 20 páginas por origen y ciclo, y de 20 orígenes nuevos por ciclo.
- Si la licencia cambia o desaparece en una revisión posterior, el origen pasa a `paused` y sus variantes a `deprecated`.

**Resultado:** el catálogo no depende de que alguien mire páginas. Con el nivel 1 ya encuentra plantillas nuevas donde ya mira; el nivel 2, cuando se habilite, incorpora orígenes nuevos con licencia verificada.

**Aprendizaje aplicado al descubrimiento:** si un origen produce variantes que los usuarios nunca eligen durante tres ciclos seguidos, su `crawl_schedule` pasa a trimestral o se pausa. El catálogo aprende **dónde** hay diseños que sirven, no solo cuáles ofrecer.

**Tablas añadidas:** `design_discovery_log` (id, run_at, kind `page|origin`, url, decision `accepted|rejected`, reason, license_evidence). La lista de arranque `design_origin_seeds` vive en código, versionada.

#### 7.7.9 Descriptores cerrados, frenos automáticos y dictamen legal

**A. Los descriptores son datos, no texto.**

Un catálogo que alimenta a un agente es una vía de contaminación de prompt si deja entrar texto libre. Por eso:

- Cada descriptor es un **número** o un **valor de una enumeración cerrada**, validado por esquema Zod antes de escribir. No hay ningún campo de texto libre que llegue al prompt del agente de diseño.
- Enumeraciones cerradas: familia, variante, patrón de sección (de la lista de 6.1), tono, densidad (`compacta|normal|amplia`), radio (`cuadrado|suave|redondeado|pildora`), elevación (`plana|sutil|marcada`).
- Números con rango y unidad: escala tipográfica (ratio 1,0–2,0), pasos (4–12), paleta en OKLCH (`L` 0–1, `C` 0–0,4, `h` 0–360), espaciado en px, breakpoints de la lista fija.
- **Cero texto ajeno.** Ni el `<title>` de la página, ni nombres de clase, ni comentarios, ni atributos `alt`. Si un extractor devuelve una cadena donde espera un número o una enumeración, **se descarta la página entera** con el motivo `descriptor_schema_invalid`.
- El agente recibe la entrada ya validada y serializada, nunca el resultado crudo del crawl.

**B. Frenos, porque nadie revisa.**

| Freno | Cómo funciona |
| --- | --- |
| Catálogo versionado | Cada ciclo escribe una versión inmutable del catálogo. Revertir al ciclo anterior es una operación de un paso |
| Activación gradual | Una entrada nueva se recomienda primero a un **5 % de usuarios** durante 7 días; solo pasa a recomendación general si su tasa de descarte es normal |
| Cortacircuitos | Si en un ciclo la tasa de `discarded` sube del 40 %, o `DESIGN_TOO_CLOSE_TO_SOURCE` se dispara por encima del doble de la media, el ciclo **se pausa solo** y el catálogo se queda en la versión anterior |
| Tope por ciclo | Máximo 100 entradas nuevas activas por ciclo; lo que sobra espera al siguiente |
| Interruptor de apagado | `catalog_enabled=false` detiene captura, generación y recomendación. El agente de diseño cae al preset por defecto y el sitio se sigue pudiendo construir a mano |
| Reversión de emergencia | Un comando desactiva todas las entradas de un ciclo concreto y restaura el catálogo anterior |

Ninguno de estos frenos pide intervención humana para funcionar: actúan solos. El operador solo los consulta si quiere.

**C. Dictamen legal previo, requisito de activación.**

Antes de activar el catálogo en producción, un abogado tiene que responder por escrito a estas preguntas, y las respuestas se guardan en `docs/legal/catalogo.md`:

1. ¿Extraer escala, paleta, espaciado y patrones de composición de una fuente con licencia MIT o Apache-2.0 produce una obra derivada?
2. ¿Qué obliga a hacer la atribución de CC-BY y CC-BY-SA dentro de un sitio generado para un cliente? Mientras no haya respuesta, esas licencias quedan fuera (7.7.1).
3. ¿Cómo se acredita que quien publica el `LICENSE` tiene derechos para licenciarlo?
4. ¿Qué texto de atribución, si alguno, debe mostrarse en el sitio del cliente o en el panel?

**Mientras esas respuestas no existan, la Fase 5b no se activa en producción.** El catálogo puede construirse y probarse en staging, pero no recomendar a clientes reales.

**D. Alcance del lanzamiento.**

La Fase 5b se puede **quitar sin tocar el MVP**: si el catálogo no está, el agente de diseño funciona con los presets por defecto de 9.1 y el resto del producto no cambia. Es una fase añadida, no una dependencia del núcleo.
