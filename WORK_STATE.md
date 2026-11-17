# Estado del proyecto

## Objetivo
Construir la plataforma multi-sitio de agentes IA según `especificacion-construccion-v1.15.md`
(documento único por versión; `archivo/` es histórico y no se modifica).

## Forma de trabajo (decidida por el usuario, vale para todo el proyecto)
- **Construye** `claude-sonnet-5`. **Prueba** `claude-haiku-5-5`. **Revisa** el agente principal
  al terminar: typecheck, suite completa y lectura del diff antes de dar nada por hecho.
- Nombres verificados con una llamada real: `claude-sonnet-5-5` y `claude-sonnet-4-5` NO
  responden en este arnés; `claude-sonnet-5` y `claude-haiku-5-5` sí.
- Se delega con el tool `workflow` (el unico que acepta `model` por agente).
- **El agente principal NO corrige codigo.** Diagnostica y da al constructor ordenes explicitas
  (archivo, causa, cambio esperado, criterio de hecho). Ciclo: construir -> probar -> si hay
  fallos, el principal analiza y ordena -> el constructor corrige -> el probador reverifica.
  Objetivo: ahorro de tokens. Usar graphify y claude-mem para dar contexto en vez de releer.
- **Regla de los 3 intentos:** si el constructor falla 3 veces en lo mismo, se detiene y me pasa
  el error. Yo analizo la causa raiz y devuelvo una orden nueva y distinta, no un "intentalo
  otra vez". Al tercer fallo se cambia el enfoque o se para y se reporta: nunca bucle.

## Fases
- **Fase 0 — Fundamentos: cerrada.** Monorepo pnpm+turbo, Postgres 18+pgvector en Coolify,
  rol `app_platform` con RLS forzada (`rolbypassrls = f`), migraciones forward-only,
  `apps/platform` con `/healthz` y migración al arrancar, CI verde.
- **Fase 1 — Núcleo del sitio: en curso.**
- **Orden de fases reordenado (ADR 0001, 15-nov-2026).** Se construye por prioridad de producto,
  no por numeración: **1b → 2 → 4 → 3 → 2b → 2c → 5b**. Motivo verificado por HTTP: no hay ningún
  sitio publicado (`https://zottaweb.site/` devuelve el 404 JSON de `platform`, Caddy no sirve
  ninguna carpeta de `/data/hosts`) y el editor arranca en un lienzo vacío (`presetId` es texto
  libre que no lee nadie). La Fase 1b adelanta el catálogo inicial desde 5b.

## Fase 1 — hecho
| Paquete | Contenido | Pruebas |
| --- | --- | --- |
| `site-schema` | Documento canónico spec 6.1 con Zod: meta, design, theme, pages, sections, assets | 6 |
| `renderer` | HTML por página sobre `ui-components`, CSP, `rel="noopener noreferrer"`, testimonios sin confirmar nunca se publican | 6 |
| `linter` | Linter estático 6.4: seguridad, datos, contraste WCAG, peso, fuentes alojadas | 10 |
| `platform` (panel) | Panel del editor en `/app/`: Puck, guardado con rev optimista, vista previa en iframe `allow-scripts` sin `allow-same-origin`, CSP estricta | 3 |
| `quality` (panel) | Smoke del bundle real en jsdom (monta sin errores) | 1 |
| `quality` (carga) | Prueba de carga básica: 2000 peticiones a 50 de concurrencia, sin errores, p95 < 250 ms (umbral propio; la spec no fija cifras) | 2 |
| `quality` | HTML válido (html-validate) y accesibilidad crítica (axe-core sobre jsdom) de las páginas de muestra; canario verificado | 4 |
| `releases` | `/data/sites/<id>/releases/v<N>`, `public` symlink, cambio atómico, rollback | 5 |
| `storage` | Rutas seguras, nombre físico de assets | (en `security`) |
| `publish` | Flujo 4.3: validar, lint, renderizar, escribir release, `site_versions` y `audit_log`, activar sitio | 6 |
| `db` | Migración `0003`: `users`, `site_members`, `site_drafts`, `site_versions`, `assets`, `audit_log`, RLS forzada, índice de un solo sitio activo | 11 |
| `ui-components` | Componentes React puros de las 10 secciones; el renderer los usa con `renderToStaticMarkup` | 10 |
| `platform` (ciclo) | Superficie HTTP de crear, editar, publicar y revertir, con sesión y RLS; 18 pruebas de ciclo y aislamiento | 18 |
| `releases` | Rutas anidadas (`/precios` → `precios/index.html`) y assets por hardlink; dos páginas ya se publican | 8 |
| `assets` | Registro de assets: tipo por bytes (no por cabecera), límites de 14.1, cuota por sitio, licencia obligatoria para publicar, retirada por reclamación | 10 |
| `editor` | Configuración Puck de las 10 secciones; guardado del borrador con revisión optimista, rechazo de conflictos y `audit_log` | 9 |
| `puck-adapter` | Schema <-> Puck con ida y vuelta identica por pagina; guarda de `ownerProvided` para agentes | 4 |
| `preview` | Token firmado de 15 min, de un solo uso, cookie propia, CSP y `noindex` | 9 |
| `apps/platform` | Vista previa en `*.preview.localhost`, con prueba de aislamiento de origen en CI | 8 |
| `auth`, `security` | Base de Fase 0 | 7 |

## Fase 1 — pendiente

1. Integrar el ciclo de dominios y enlaces `/data/hosts/<hostname>` en Fase 2.
2. Validar Caddy en un entorno Coolify de prueba.
3. Completar paneles de operador y dueño en Fase 2.

## Decisiones
- Una sola web publicada por cliente (`sites_one_active_per_owner`); borradores sin límite.
- `design_origins` exige licencia verificada; MIT entra en `license_allowlist`.
  Plantillas HTML de archivo único con MIT (Linea de 8B) permitidas como fuente de
  tokens y orden de secciones, nunca el archivo literal.
- Los `error` del linter bloquean la publicación; `warning` e `info` no.
- Respuestas en español, identificadores en inglés.

## Próximos pasos
Primera tarea de Fase 2 (§5.2): validar convivencia Traefik/Caddy en Coolify de prueba,
antes de construir el ciclo de dominios. Procedimiento en `docs/runbooks/hosting-edge.md`.
No hay validación real del borde: en este entorno no se encontraron docker, caddy ni traefik.
La configuración Caddy y sus pruebas de texto no sustituyen esa aceptación.
Preparado `deploy/caddy/compose.test.yaml` para ejecutar `caddy validate` sin publicar puertos;
no ejecutado aquí por falta de Docker. Detectadas variables de Coolify, sin conexión administrativa
verificada al entorno de prueba. CSP de Caddy alineada con los proveedores de vídeo de §5.6.
Verificación adicional: descargado Caddy oficial 2.10.2 en /tmp; `caddy adapt` y `caddy validate`
correctos. Para validate se cambió únicamente la raíz de almacenamiento a /tmp en el JSON derivado.
Además se ejecutó Caddy con listener loopback y raíz temporal: inicio, página anidada,
asset CSS con bytes/MIME correctos, cabecera nosniff y 404 de host inexistente verificados por HTTP.
Prueba reproducible en `deploy/caddy/http.test.py`: comprobados también cambio atómico v1→v2,
rollback v2→v1 con assets correspondientes y retirada del enlace del host: mismo 404 que host inexistente.
Ejecutada correctamente con Caddy 2.10.2; proceso detenido al terminar.
Traefik oficial 3.6.1 probado con `deploy/caddy/traefik.test.py` en loopback: proveedor de
archivos recarga un router comodín prioridad 1 y conserva la respuesta del router existente.
Backends de fixture HTTP; no es una prueba conjunta con Caddy ni con el proveedor Docker de Coolify.
Sigue pendiente la convivencia real Traefik/Coolify, Cloudflare y TLS.
Punto solicitado alcanzado: crear el nuevo recurso Caddy en Coolify de prueba.
Imagen preparada en `deploy/caddy/Dockerfile` (no construida aquí; Docker no disponible).
Runbook detalla contexto, puerto interno 80, datos compartidos de solo lectura y red de prueba.
No se creó contenedor, no se desplegó ni se hizo commit/push.

## Diagnóstico operativo (15-nov-2026, Fase 1b previa)

`GET /app/diagnose`, de solo lectura y opt-in por `DIAGNOSTIC_TOKEN`. Sin esa variable la ruta
no existe. Devuelve conectividad, versión y rol de Postgres, migraciones aplicadas y ausentes,
recuentos por tabla y contenido de `/data/sites`. Nunca datos personales ni secretos.
Runbook en `docs/runbooks/diagnostico.md`.

Verificado: lógica del token (8 casos) y `runDiagnostics` con pool simulado (sano, migración
ausente, base caída). **No verificado contra Postgres real**: 5432 cerrado en este entorno.

## Próximo paso inmediato

1. Añadir `DIAGNOSTIC_TOKEN` a `plataforma` en Coolify y redeploy.
2. Ejecutar el runbook y confirmar que la base responde y qué migraciones hay.
3. Con el parte en la mano, construir Fase 1b: catálogo, 8 presets y `apply-preset`.

## Riesgo abierto

`packages/db/migrations/0008_domains_leads.sql` existe sin probar: no hay Postgres accesible.
Corre sola al arrancar. **No mezclarla con un redeploy hasta validarla.**

## Pendiente urgente de seguridad

`DIAGNOSTIC_OPEN=1` habilita `/app/diagnose` **sin autenticación**. Es provisional, para
depurar sin poder generar token. Retirar: borrar la variable en Coolify y redeploy.
Registrado en claude-mem #217.

## Fase 1b — entregada (e3aee20)

Catalogo inicial: `design_styles` sin RLS, 8 presets con contraste AA verificado,
tipos de seccion cruzados contra el esquema. `GET /api/design-styles`,
`POST /api/sites/:id/apply-preset` (400 en preset desconocido, rev optimista,
`audit_log`). Pantalla `StyleStart` cuando el documento esta vacio.

**Verificado en produccion (usuario confirma):** `0009_design_catalog.sql` se
aplico sin romper el arranque, la pantalla de estilos funciona y el boton
"Estilos" del editor abre el catalogo. Ya no es riesgo abierto.

**Corregido de paso:** `panel.js` y `panel.css` se servian sin `cache-control`,
asi que un despliegue no se veia sin forzar recarga. Ahora HTML `no-store`,
JS/CSS `no-cache` + ETag (76288c0).

## Fase 2 — formularios y CSS del sitio (7c21a59)

`/_f/lead` resuelve el sitio por `Host`. Formulario en `ContactSection`, sin JS,
consentimiento obligatorio. `theme-css.ts` genera la hoja desde el documento.

**Dos fallos de fondo corregidos:**
1. `0008` usaba funciones `SECURITY DEFINER` que **no** habrían funcionado:
   las tablas llevan `FORCE ROW LEVEL SECURITY` (se aplica al dueño) y
   `app_platform` es `NOBYPASSRLS`. Reemplazadas por `SET LOCAL` transaccional.
2. El renderer **no emitía CSS**: ningún sitio publicado tenía tema ni el
   formulario tenía forma.

**Riesgo vivo:** `0008` no se ha ejecutado contra Postgres real y corre al
arrancar. Si falla, `plataforma` no levanta.

## Fase 2b — imagen del sitio e integridad al publicar (8ca0385)

Cadena completa del fallo del bloque Imagen, en orden de causa:

1. `assetFiles` usaba la clave sin `siteId`, asi que el release guardaba el
   fichero en `assets/image/...` y la URL publica daba 404 (2241eab).
2. El CSP de Caddy se **interseccionaba** con el `<meta>` del renderer y no
   permitia `data:` ni `'unsafe-inline'`: bloqueaba imagenes y el `<style>` del
   tema (6b95e06).
3. `.image img` pedia `object-fit:cover` sin dimensiones, y sin `width` esa
   regla no hace nada (0c49b8e).
4. `publish()` pintaba la seccion vacia y publicaba el release sin el fichero,
   sin avisar. Ahora corta con `MISSING_ASSET` (8ca0385).

**Leccion de diagnostico:** `curl` recibia una copia buena de Cloudflare
mientras el navegador veia el 404 real. Una captura de la pestana Network
(404, `text/plain`, 19 bytes, `cf-cache-status: MISS`) fue el unico dato que
lo resolvio. No dar por verificado un fallo de navegador con `curl`.

**Nota:** los 8 presets no siembran `image`; esa seccion solo aparece si se
anade a mano. El 404 cacheado que vio el dueno caduca solo en 4 h.

## Cambiar de estilo sin perder el trabajo (fb16a25)

`applyStyleToDocument` sustituia **todas** las secciones de la portada por las
del preset: quien tenia su texto escrito lo perdia por probar otro aire.
Ahora `mode` es `inherit` por defecto y `reset` hay que pedirlo; el dialogo de
`StyleStart` explica que se pierde antes de tocar nada. La API rechaza un modo
inventado con `400 unknown_mode` y devuelve `sectionsChanged`.

## Fase 2 cerrada — bandeja, cuotas, operador y backup (fase 2 completa)

Los cuatro criterios de aceptacion que faltaban (spec:1277):

1. **Formulario llega al panel.** La tabla `leads` tenia politica RLS desde
   `0008` y ninguna consulta la usaba: los mensajes se guardaban y nadie podia
   leerlos. Ahora `apps/platform/src/inbox.ts` los lista, cuenta los no leidos y
   cambia el estado; la vista es una capa sobre el editor, no una pantalla
   aparte, para no perder lo que el dueno tenia sin guardar.
2. **Cuota excedida se rechaza.** Solo se medía el peso total (200 MB). Faltaban
   las 40 imagenes y 6 videos de 14.1: se podian subir cientos de imagenes
   pequenas. Ahora se cuentan por tipo con `count(*) FILTER` y el mensaje del
   panel dice que paso, en lugar de "no se pudo subir".
3. **Dos paneles.** El de operador (`0012_operator_view.sql`) abre solo lectura
   sobre `sites`, `site_versions`, `domains` y `users`. No toca `leads`: son
   datos personales de terceros y el operador no tiene por que verlos.
4. **Backup se restaura.** `docs/runbooks/backup-restauracion.md`. El criterio no
   es tener copias, es haber restaurado una: comprueba `relrowsecurity` y
   `rolbypassrls` despues de restaurar, porque un dump sin politicas funciona
   igual y expone todo.

**Tres trampas que costaron encontrar en `0012`:** el JOIN con `users` salia
vacio por `users_self` (hacia falta politica propia); llamar a la funcion desde
la politica de `users` mientras lee `users` es recursion infinita (SECURITY
DEFINER); y una SECURITY DEFINER sin `REVOKE ... FROM PUBLIC` queda invocable
por cualquiera. Las tres tienen prueba.

### Deuda asumida al cerrar la Fase 2

Se cierra con estas piezas sin construir, conscientemente y por orden de producto:

- **Redis y BullMQ.** No hay cola: los trabajos pesados van en linea. Entra en 2b/5b.
- **Integracion con la API de Cloudflare.** El pool de dominios se llena a mano.
- **Asignador del pool de dominios.** `ensureHostname` asigna, pero no reaprovecha ni libera.
- **Caddy ejecutando la config de `hosting-edge.md` tras Traefik.** Hoy Caddy sirve `/data/hosts`.
- **Vista del plan contratado** para el dueno: depende de 2b (planes y `ai_credit_ledger`).

## Fase 4 — agente de diseno (en curso)

**Siguiente: terminar la Fase 4.** Entregado hasta ahora:

- **`packages/lint-visual`** (spec 6.5): las 15 reglas, deterministas y sin coste de modelo,
  con 28 pruebas (una positiva y una negativa por regla, mas las de release sobre el HTML
  real del renderer). `jsdom` no calcula maquetacion: las reglas razonan sobre las
  declaraciones CSS que emite el renderer, nunca sobre pixeles medidos.
- **Integracion en `publish`.** Corre sobre el HTML ya renderizado, antes del swap atomico.
  Un `error` de 6.5 **no bloquea**: devuelve `blocked: false`, el panel ensena el aviso y
  ofrece «Publicar igual», y la confirmacion queda en `audit_log` con sus codigos.
- **`NOTICE`** con la atribucion a *impeccable* (Apache 2.0), como pide 6.5.
- **Migraciones 0014 y 0015**: `agent_runs`, `agent_tool_calls`, `agent_tokens`,
  `usage_events`, `draft_checkpoints` con RLS forzado, y el rol `app_llm_gateway` con el
  minimo privilegio de la linea 591 (INSERT en consumo, lectura de presupuesto).

**Tres defectos reales que encontro el linter al mirar el HTML del renderer**, corregidos
en la fuente y no silenciando la regla:

1. `.cta a` nunca casaba con `<a class="cta">`: todos los botones del sitio salian como
   enlace subrayado. El selector llevaba ahi desde la Fase 1 y ninguna prueba lo miraba.
2. `text`, `features` y `pricing` pintaban `<h3>` sin `<h2>`: tras el `h1` del hero la
   jerarquia saltaba. Ahora los tres admiten titular opcional, tambien en el editor.
3. `SLOP_TOUCH_TARGET_SMALL` aplicaba 44 px a cualquier enlace; pasar a 24 px el texto
   (WCAG 2.5.8) y reservar 44 para controles evita el aviso inutil.

- **`packages/llm`** (spec 8.3): catalogo cerrado de modelos con coste por token, presupuesto
  con sus cinco limites, `BudgetTracker` y un cliente que aplica reintentos con backoff y
  cortacircuitos. El coste se calcula con la tabla, nunca con lo que diga el proveedor. 10 pruebas.
- **`apps/llm-gateway`**: el unico proceso con claves de proveedor. Valida token, scopes y
  presupuesto persistido antes de gastar; una ejecucion cerrada no admite mas gasto. 4 pruebas.
- **`packages/agent-sdk`** (spec 8.1, 8.2, 9.1): contrato de herramienta con validacion Zod
  obligatoria, `RunContext` que lleva un token y no un pool, marcado de contenido no confiable
  y bucle de agente con checkpoint antes de mutar. **No existe herramienta de publicar**: el
  agente no puede publicar porque no hay con que. 17 pruebas.

**Siguiente: el agente de diseno (`agents/design`) sobre este SDK.**

### Plan aprobado: skills de diseno como DATO de produccion

El objetivo no es que el agente lleve prompts de diseno en el contexto —el modo rapido
tiene una ronda y se comeria el presupuesto— sino que la plataforma **sepa** disenar y lo
**compruebe** sin gastar tokens. Cuatro fuentes externas, todas MIT (permitidas por
`license_allowlist` de 7.7.1):

| Fuente | Que aporta | Como entra |
| --- | --- | --- |
| `nextlevelbuilder/ui-ux-pro-max-skill` | 89 estilos (51 activos), 192 productos, 192 paletas, 74 parejas tipograficas, 120 reglas UX, 17 presets de movimiento, licencias de fuentes | Filas de las tablas de 7.5, normalizadas a nuestro shape |
| `vercel-labs/agent-skills` (`web-design-guidelines`) | 100+ reglas de revision de UI | Reglas deterministas nuevas de `lint-visual` |
| `alchaincyf/huashu-design` | Direccion visual: 3 logicas x 2 candidatos, ledger de "ya entregado", `design_lint.py`, protocolo de marca | Ideas para `critique_draft` y para el brief; **no** su runtime (Python, se anade aparte) |
| `emilkowalski/skills` | Vocabulario y recetas de animacion, `prefers-reduced-motion`, auditoria de animacion | Reglas de movimiento para `lint-visual` y el catalogo |

**Regla de adaptacion, no de copia:** todo entra como fila de catalogo o como regla
determinista. Nada entra como prompt de sistema. Un estilo importado que no pase
`lint-visual` entra como `supplemental`, nunca `active`: eso es "basado en lo nuestro".

Pasos:

1. Migracion `0016` con las tablas de 7.5 que faltan (`design_product_types`,
   `design_palettes`, `design_font_pairings`, `design_ux_rules`, `design_antipatterns`),
   con `source`, `license`, `verified_at`, `status`.
2. Importador: lee sus CSV, **normaliza a nuestro token shape** (`ground/ink/accent`,
   `margin/sectionGap`, `family/scale`, `radius`) y filtra por `lint-visual` antes de escribir.
3. Minar las reglas deterministas de Vercel, huashu y Kowalski hacia `lint-visual`, con
   atribucion en `NOTICE`.
4. Herramientas `recommend_design_system` y `run_lint` en el SDK: el agente **consulta**,
   no razona el diseno.
5. Despues, el agente de diseno.

Plan detallado, con los cuatro cortes y las restricciones descubiertas: `docs/plan-fase4-catalogo.md`.

### Hecho: cortes 1 a 3

- **0016** aplicada al esquema: 6 tablas de catalogo + `license_url`, `origin_ref`,
  `imported_at` y `kind` en `design_styles`. `migrate.test.mjs` ya no lleva la lista de
  migraciones escrita a mano (estaba obsoleta desde 0008 y no lo veia nadie porque el test se
  salta sin `DB_TEST_URL`).
- **`kind` (`preset` | `reference`)**: el catalogo importado NO puede entrar como preset. Los
  89 estilos del origen dan prosa en vez de hex; rellenarlos seria inventar un tema. Entran
  como `reference` y `listStyles` filtra `kind = 'preset'`, asi que el dueno sigue viendo solo
  los 8 presets de 0009.
- **`@webdesign/catalog-import`**: importador determinista con el origen fijado por commit
  (`e59ff3...`) y licencia MIT. Sin dependencia de red en tiempo de ejecucion. Sobre los datos
  reales: **140 de 192 paletas activas**, 80 supplementary por contraste, 8 parejas
  tipograficas de 74 (las webfonts se traducen a pilas del sistema), 24 patrones de landing de
  34. `--dry-run` es el defecto y escribe el SQL con `bin/import.mjs --sql`.
- **4 reglas nuevas** en `lint-visual` (`a11y.ts`): foco visible, animacion de layout,
  `prefers-reduced-motion` y rango de duracion. El sitio real del renderer da **0 hallazgos**:
  el navegador pinta el anillo de foco por defecto, asi que no se fabrica un defecto donde no
  lo hay.
- Suite: **169 pasan, 0 fallan**; typecheck limpio. Atribuciones en `NOTICE`.

- **Corte 4 hecho**: `agent-sdk/src/design-tools.ts` con `recommend_design_system`,
  `run_lint`, `run_visual_lint` y `critique_draft`. Las cuatro `mutates: false`, sin scope de
  escritura ni publicacion; los datos entran como argumento (sin red ni base). `critique` es
  determinista de verdad: se encontro que con un codigo repetido el mensaje dependia del orden
  del DOM y se corrigio. `recommend` devuelve `noConfidentMatch` en vez de inventar.
  Suite: **183 pasan, 0 fallan**.
- **Corte 5 hecho**: `agents/design` implementa la cadena de 9.1 (brief → inventario →
  recomendación → plan → checkpoint → construcción → validación) en modo rápido, una ronda.
  Nueve herramientas de edición, todas `mutates: true` salvo `get_site`; ninguna publica y no
  existe herramienta de publicar. Cada mutación valida el `SiteDocument` completo antes de
  confirmar (`store.applyMutation`): si no valida, el store no cambia y la herramienta devuelve
  `MUTATION_REJECTED` como dato en vez de lanzar, para que el modelo pueda reintentar.
  Inventario y plan son datos, no prosa: separan lo afirmado por el dueño de lo que falta y
  explican por qué cada sección se escribe, se degrada a `text` o se omite. Se descubrió que
  `draftSite` podía discrepar del plan y se unificó: el borrador consume `plannedTypes`.
  Un `error` de 6.4 no aplica nada; uno de 6.5 **nunca bloquea** (9.1: el agente no se bloquea
  por estilo): se entrega con aviso, distinto si lo pidió el dueño. La revisión corrigió una
  versión que lanzaba sin `ownerRequested`. Suite del paquete: **24 pasan, 0 fallan**.
- Revisión de CI al cerrar el corte 5: había un **ciclo de build** (publish → lint-visual →
  quality → platform → publish); la prueba de carga pasó a `apps/platform/test/load.test.mjs`.
  El renderer normaliza atributos de React 19 (`maxLength`, `required=""`) con
  `htmlAttributeCase`; `panel.test.mjs` añade `TextEncoder`/`TextDecoder`/`MessageChannel`.
- **Corte 6 hecho** (ver sección al final). **Fase 4 cerrada en código.**

Medido y descartado: la regla de dimensiones de imagen no se justifica, el renderer ya reserva
hueco con `aspect-ratio` en `.gallery img` y `.image img`.

**Dos avisos que no se pueden saltar:** 7.7.9.C exige dictamen legal escrito antes de que el
catalogo recomiende a clientes reales (se construye en staging); y 7.7.9.D recuerda que el
catalogo se puede quitar sin tocar el MVP — sin el, el agente usa los 8 presets y nada cambia.

## El editor en blanco y por que el build no lo vio (corregido)

Al desplegar `9851c57`, el editor salio en blanco. Causa: en `panel.tsx` el
`useEffect` del contador de mensajes usaba `showInbox` y `setNewLeads` **antes**
de declararlos. El array de dependencias se evalua al renderizar, asi que
lanzaba `ReferenceError` y React dejaba la pantalla vacia.

Lo importante no es el error, es que nada lo paro:

- `apps/platform/tsconfig.json` incluye solo `src`. **La UI nunca pasaba por
  TypeScript**: `build-ui.mjs` usa esbuild, que transpila sin comprobar tipos.
- `@types/react` estaba en el store de pnpm pero no enlazado, asi que un
  `tsconfig` para `ui/` daba 14 errores falsos y habria tapado el real.

Corregido: `apps/platform/tsconfig.ui.json`, `@types/react` y
`@types/react-dom` como devDependencies, y `build-ui.mjs` ejecuta `tsc` antes
de esbuild y aborta si falla. Probado reintroduciendo el error: el build corta
con `TS2304 Cannot find name 'newLeads'`.

Dos errores reales que aparecieron al activar la comprobacion: `path:
undefined` en el selector de assets (con `exactOptionalPropertyTypes`) y
`headerActions` devolviendo `null` en vez de un elemento. Y `hostedFonts` era
obligatorio en `buildEditorConfig` sin que nadie lo leyera: ahora es opcional.

## CORTE 6 (Fase 4): cola del lint visual en `workers` — hecho
- Migracion `0017_release_lint_findings.sql`: tabla por hallazgo, RLS forzada,
  politica de dueno (forma de 0003) + marca `app.release_lint` para el worker,
  grants a `app_platform` guardados con `IF EXISTS`.
- `apps/workers`: `processLintJob` puro (sin Redis ni pg), `pgLintDeps` con
  borrar+reinsertar en una transaccion, cola `lint-release` con `jobId`
  `lint:<siteId>:<version>` (dedupe) y backoff exponencial, `main.ts` que sale
  con codigo 1 sin `REDIS_URL`/`DATABASE_URL`. `Dockerfile` propio.
- Productor en `apps/platform/src/server.ts`: solo tras `publish` con exito y
  solo si hay `REDIS_URL`; el fallo se registra con `console.warn` y no toca la
  publicacion (6.5 nunca bloquea).
- Revision del principal, dos defectos corregidos por el constructor:
  1. Publicar podia colgarse con Redis caido o mudo (`await` del encolado). Ahora no se
     espera (`void import(...)`) y `enqueueReleaseLint` corta a 2000 ms
     (`enableOfflineQueue:false`, `maxRetriesPerRequest:1`).
  2. `ioredis` es peer **opcional** de bullmq 6 y no estaba instalado: el worker nunca habria
     conectado. Añadido `ioredis@5.11.1`; la prueba ya no acepta "falta el driver" como valido.
- Verificado: workers 14/14; `turbo typecheck test --force` **67/67**; UI tsc 0.
- **Desplegado** (`3fc0b5c`, 16-nov-2026): solo plataforma; `deploy/caddy` no cambió, asi que
  Caddy no se redespliega. `/healthz` da 200 y las migraciones **0014, 0015, 0016 y 0017 se
  aplicaron** al arrancar (confirmado por el log del despliegue).
- `workers` creado en Coolify (Redis 8, usuario `default`); log: `escuchando la cola lint-release`.
- **502 al publicar (17-nov)**: plataforma moria al encolar. El cliente ioredis conectaba sin
  oyente de `error`; con `WRONGPASS` eso es excepcion no capturada. Arreglo: cliente propio con
  `lazyConnect` y oyente antes de `connect()`, y el encolado va en `setImmediate` DESPUES de
  responder. Workers 16/16, turbo `--force` 67/67. Pendiente: verificar filas en
  `release_lint_findings` tras publicar.
  Seguridad a vigilar: la marca `app.release_lint` da SELECT a todos los
  `site_versions`; mismo modelo de confianza que `app.user_id` (solo la pone el servidor).

### ui-skills (MIT) — incorporado

- Fuente: `ibelick/ui-skills`, skills `baseline-ui` y `fixing-accessibility`. Se reescribieron
  las ideas: sin dependencia, sin runtime, sin copiar codigo. Atribucion MIT en `NOTICE`.
- 6 reglas deterministas nuevas en `lint-visual`: `A11Y_CONTROL_NO_ACCESSIBLE_NAME` (error),
  `A11Y_FIELD_UNLABELED` (error), `A11Y_LINK_VAGUE_TEXT` (warning), `A11Y_LIST_NOT_SEMANTIC`
  (warning), `SLOP_Z_INDEX_ARBITRARY` (warning), `SLOP_MULTIPLE_ACCENTS` (info). 13 pruebas,
  48/48 en el paquete.
- `0018_design_ux_rules_ui_skills.sql`: 8 reglas en `design_ux_rules` y 3 antipatrones, con
  `source`/`license`/`license_url`/`verified_at`. Los `lint_code` enlazan codigos que existen.
- **Descartado a proposito** (stack que no tenemos): Tailwind, `motion/react`, `cn`,
  `will-change`, `backdrop-filter`, `h-dvh`, `safe-area-inset`, y todo lo de dialogos, menus,
  pestañas y tablas, que el renderer no genera. No se anaden reglas que devolverian `[]` siempre.

### 23505 al publicar un segundo sitio (502) — arreglado

- Causa: el UPDATE de `publish()` chocaba con el indice parcial `sites_one_active_per_owner`
  (0003:33, 0008:163) cuando el dueno ya tenia otro sitio `active`; el throw subia por
  `handleApi` y mataba el proceso Node. La regla (spec 1.15, lineas 90/597/1481) es correcta y
  no se toco: faltaba tratar el caso como resultado, no como excepcion.
- `packages/publish/src/index.ts`: `PublishResult` gana `AnotherSiteActiveBlock`
  (`ok:false, blocked:true, reason:"another_site_active", activeSiteId, activeSiteName`) y el
  guard `isAnotherSiteActive()` (linea 57). El chequeo (`SELECT ... WHERE owner_id=$1 AND
  status='active' AND id<>$2`, linea 173) va ANTES de `publishRelease()` (linea 189): esa
  funcion ya escribe en disco y mueve el symlink `public`, y bloquear despues dejaria ficheros
  de una release que no existe en la base. `pg_advisory_xact_lock(4711, hashtext(userId))`
  (linea 171, igual en `unpublish`) cierra la carrera entre dos publicaciones simultaneas.
- `unpublish()` (packages/publish/src/index.ts:230): solo `sites.status -> 'draft'` +
  `audit_log` (`site.unpublish`); no borra release, `site_versions` ni assets. Idempotente en
  `draft` (sin auditoria nueva). Sitio ajeno/inexistente: mismo `not_found`.
- `apps/platform/src/server.ts`: 409 `another_site_active` (linea 669, antes del de
  `visual_confirm`/`blocked`); ruta nueva `POST /api/sites/:id/unpublish` (733-760, quita
  tambien el enlace de `/data/hosts` porque Caddy no mira la base); junto a `start()`
  `process.on("unhandledRejection"|"uncaughtException", ...)` (830-839) que solo registra, nunca
  mata el proceso. Defensa en profundidad: el arreglo de verdad es el 409.
- `apps/platform/ui/panel.tsx`: aviso inline `activeElsewhere` (155, rama 217) con el patron de
  `visual_confirm`, sin `confirm()`; el boton llama `unpublishAndRetry()` (246) y reintenta.
- Pruebas: `packages/publish/test/another-active.test.mjs` (doble en memoria del pool, sin
  Postgres) y `apps/platform/test/another-active.test.mjs` (con DB, gateada por `DB_TEST_URL`:
  409 con nombre, `/healthz` vivo despues, unpublish idempotente, publicar tras despublicar).
- Verificado: tsc plataforma 0, tsc UI 0, turbo `typecheck test --force` **67/67**, 0 fallos.

### Skill de seguridad (Cloudflare, MIT)

- Instalada en `.dsh/skills/security-audit/` (el harness descubre skills de proyecto en
  `.dsh/skills/<nombre>/SKILL.md` y `.agents/skills/...`; se eligio la primera). 22 archivos,
  368K. `LICENSE` MIT conservada.
- `PROJECT-SCOPE.md` es **nuestro**, no del upstream: fija las cinco clases que aplican
  (DATA-ISOLATION, WEB-PROTOCOL-AND-AUTH, CLIENT-SIDE, RESOURCE-EXHAUSTION, SUPPLY-CHAIN),
  excluye MEMORY-SAFETY y DESKTOP-MOBILE-AND-LOCAL-IPC, y prohibe auditar produccion.
- `AGENTS.md` la referencia con esa misma prohibicion. Es la unica forma de que se sepa que
  existe sin buscarla.
- Sus validadores (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) pasan 65/65 aqui.
- **Uso previsto**: auditar el codigo del repositorio. NO es un escaner que corra dentro de la
  app al publicar; eso son reglas deterministas de `lint-visual`/`linter`, aparte.
- Comprobado a mano en esta sesion: `escapeHtml` escapa `& < > " '` (renderer:36-43) y
  `isSafeUrl` rechaza `javascript:`, `data:` y `//evil.com`, pero **acepta** una URL con
  comillas (`https://ok.com/"onerror="alert(1)`), que solo queda a salvo por el escape del
  atributo; y rechaza rutas relativas como `/ruta`.
