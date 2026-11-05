# Especificación de construcción: plataforma de sitios web con agentes de IA

**Versión 1.14 · 4 de noviembre de 2026.** El documento está partido en archivos enlazados. Este es el núcleo y el índice; el resto son secciones del mismo documento, no documentos distintos. La numeración de secciones no cambia entre archivos y las referencias cruzadas siguen siendo válidas.

| Archivo | Contiene |
| --- | --- |
| [01-nucleo.md](01-nucleo.md) | 0 Cómo usarlo · 1 Producto · 2 Decisiones cerradas · 3 Arquitectura |
| [02-sitio-y-publicacion.md](02-sitio-y-publicacion.md) | 4 Almacenamiento y publicación · 5 Dominios, borde y TLS · 6 Modelo de sitio |
| [03-datos.md](03-datos.md) | 7 Modelo de datos |
| [04-agentes.md](04-agentes.md) | 8 Agent SDK · 9 Agentes y flujo de construcción |
| [05-catalogo.md](05-catalogo.md) | 7.7 Biblioteca de estilos dinámica (sección extensa, con su propio archivo) |
| [06-seguridad.md](06-seguridad.md) | 10 Seguridad consolidada |
| [07-operacion.md](07-operacion.md) | 11 Monorepo · 12 Infraestructura · 13 Fases · 14 Parámetros · 15 Riesgos · 16 Prompt de arranque |
| [CHANGELOG.md](CHANGELOG.md) | Historial de versiones. **No contiene reglas vigentes** |

**Cómo se lee:** solo las secciones del cuerpo son reglas. El CHANGELOG explica cómo se llegó hasta aquí y puede describir reglas que ya se corrigieron; ante cualquier duda, manda el cuerpo.

## 0. Cómo usar este documento

Este conjunto de archivos es la fuente de verdad del proyecto. Si dos frases parecen chocar, es un error del documento: se reporta y se corrige aquí, no se interpreta.

Reglas de trabajo para quien construya:

1. Leer todo antes de escribir código.
2. Construir por fases (sección 13), en orden. Cada fase tiene criterios de aceptación verificables; no pasar a la siguiente sin cumplirlos.
3. Las decisiones de la sección 2 están cerradas. Si una choca con la realidad técnica, proponer una alternativa justificada antes de cambiarla.
4. Las decisiones abiertas están en la sección 14, cada una con un valor por defecto. Usar el valor por defecto, avisar y seguir; no bloquear el avance.
5. Todo cambio de decisión se registra como ADR en `docs/adr/NNNN-titulo.md` (contexto, decisión, alternativas, consecuencias, fecha) y se refleja en este documento.
6. Todo el código en TypeScript estricto, con pruebas y CI. Ningún agente recibe secretos ni acceso directo a la base de datos ni al disco.
7. Al final de cada fase entregar: código, migraciones, pruebas, un README de la fase y la lista de pendientes.
8. Convenciones: código, nombres y comentarios en inglés; textos de interfaz y contenido en español, con i18n preparado desde el inicio.
9. Ante la duda entre velocidad y aislamiento, elegir aislamiento.
10. Las reglas de seguridad marcadas como **obligatorias** se aplican por código y tienen prueba automática; nunca dependen solo de instrucciones a un modelo.

## 1. Producto

Plataforma tipo hosting donde cada usuario crea su sitio web de forma manual (editor visual) o con ayuda de un agente de diseño, lo previsualiza y lo publica con un botón. Cada sitio sale en un subdominio de un dominio de sitios de la plataforma o en un dominio propio del usuario, con instrucciones guiadas para configurar el DNS. Es un hosting compartido con una carpeta por sitio en un servidor con Coolify; no hay un contenedor ni un disco por usuario.

**Alcance:** los sitios son páginas informativas y landings para mostrar un negocio y captar clientes. No hay comercio electrónico: ni carrito, ni pasarela de pagos del sitio, ni inventario, ni pedidos, ni cuentas de clientes finales. El dueño puede enlazar a una tienda externa.

**Acceso y cobro:** se construye y previsualiza sin pagar. **Publicar exige una suscripción activa del sitio**, y **publicar en un dominio propio exige además una suscripción activa**: el dominio propio no se configura durante la prueba (no hay estado `active`), y en la gracia de 4 días de una cuenta ya suscrita el dominio existente sigue en línea pero no se puede añadir uno nuevo. El cobro es **por página publicada** del sitio: la cantidad facturable es el número de páginas de la versión publicada, sin tope de cantidad. **No hay límite de páginas**: el único límite es el peso, 20 MB por página (sección 14.1).

Los dos plazos son distintos y no se encadenan:

| Situación | Plazo | Al terminar |
| --- | --- | --- |
| Cuenta nueva sin suscripción | **7 días de prueba** desde la creación de la cuenta, publique o no | **Sin gracia.** El sitio pasa a `dark` y se liberan sus hostnames. El contenido se conserva 30 días desde el fin de la prueba. Para volver a publicar hace falta suscripción activa |
| Cuenta **con plan ya suscrito** a la que falla un cobro de renovación | **4 días de gracia** desde la fecha de pago | El sitio **sigue en línea y no se suspende** durante la gracia. Al día 5 pasa a `dark`: la web no muestra nada. Los datos se conservan hasta el día 30 |
| Cuenta en `dark` sin pagar | **30 días desde el ancla** (ver abajo) | **Borrado de contenido:** releases, imágenes, vídeos, versiones, borradores, assets y datos del complemento. Se conservan los registros legales de la lista de 1.1 |

Reglas:

- La prueba de 7 días se cuenta desde `accounts.created_at`, no desde la primera publicación, y no se reinicia al borrar o crear sitios.
- **La gracia no aplica nunca a cuentas que nunca pagaron.** Una cuenta nueva que no paga al día 8 pasa a `dark` directamente y el sitio se apaga, con el mismo plazo de 30 días para borrar los datos que en cualquier otro impago.
- Durante la prueba de 7 días se publica en subdominio del pool. **El dominio propio exige suscripción `active`**: no se puede configurar durante la prueba. En la gracia de 4 días de una cuenta ya suscrita, el dominio propio ya activo sigue en línea, pero no se admiten dominios nuevos hasta regularizar el cobro.
- La gracia de 4 días mantiene el sitio en línea, incluido el dominio propio, y **no se suspende** en ningún momento: es una ventana para resolver el cobro sin cortar el negocio.
- **Al terminar la gracia, el sitio pasa a `dark`:** se retiran sus enlaces de `/data/hosts/`, se purga la caché de Cloudflare y el dominio responde igual que un sitio inexistente (404 uniforme, sin marca de la plataforma). **No hay página de «pago pendiente» ni aviso público**: la web simplemente no muestra nada.
- **Ancla de conservación (`delete_after`), calculada una sola vez al entrar en `dark`:**
  - Cuenta **que alguna vez pagó**: último pago confirmado + 30 días.
  - Cuenta **que nunca pagó**: fin de la prueba (`trial_ends_at`) + 30 días. **No existe fecha de pago, así que no se usa.**
  - Si en cualquier momento entra un pago, el ancla se recalcula al nuevo pago y la cuenta sale de `dark`.
  - El ancla nunca se recalcula sola hacia adelante sin un pago nuevo: si no se paga, el borrado llega.
- **Al cumplirse `delete_after` se borra el contenido**, no la contabilidad: `/data/sites/<siteId>` completo, `site_versions`, `site_drafts`, `draft_checkpoints`, `assets` y los datos del complemento de atención. **Se conservan** facturas, movimientos de pago, aceptaciones de términos y denuncias, durante los plazos que exija la ley aplicable y con el mínimo dato personal posible.
- El dueño puede recuperar el sitio en cualquier momento pagando; si quedó en `dark`, al regularizar se vuelve a enlazar `public` y se publica la última versión conservada.
- `suspended` queda reservado **solo** para abuso o contenido prohibido (10.1). No es el estado del impago.

**Límites de la prueba, para que 7 días gratis no sean la vía del phishing:**

| Límite | Valor por defecto |
| --- | --- |
| Cuentas de prueba por IP | **2** por 30 días |
| Cuentas de prueba por dispositivo (huella de navegador y de pago, si hay) | 2 por 30 días |
| Sitios por cuenta en prueba | 1 |
| Páginas publicadas en prueba | 5 |
| Publicaciones por día en prueba | 3 |
| Dominio propio | No disponible en prueba (exige `active`) |

- **`X-Robots-Tag: noindex` en todo sitio publicado durante la prueba**, retirado automáticamente con el primer pago. Un sitio de prueba no aparece en buscadores, así que no sirve como anzuelo indexado.
- Los límites se aplican en la API, no solo en la interfaz, y se registran en `audit_log`.
- Superar el límite de cuentas por IP o dispositivo no borra nada: exige verificación manual antes de publicar.

Los importes concretos se configuran fuera de este documento; el sistema solo aplica el estado de la suscripción y la cantidad de páginas.

**Roles:** Dueño (usuario de la plataforma), Visitante (cliente final de un sitio), Operador (administración de la plataforma) y Agentes (actores automáticos con permisos mínimos).

**Agentes:**

- Diseño: crea y modifica sitios con lenguaje natural o a partir de una página de referencia.
- Soporte de la plataforma: ayuda a los dueños a usar el constructor.
- SEO: audita y optimiza cada sitio, con prioridad al SEO local.
- Programación: corrige solo bugs de la propia plataforma, con aprobación humana.
- Atención al cliente por sitio (complemento opcional): atiende a los visitantes por chat web, Telegram y WhatsApp, y escala al dueño cuando no puede resolver.

El repositorio es un monorepo diseñado para añadir agentes y funciones sin tocar el núcleo.

**Lanzamiento (MVP):** Fases 0, 1, 2, 2b, 2c, 3 y 4. Las fases 5 a 10 se construyen después, en orden, cuando el MVP esté estable en producción.

## 2. Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Modelo de hosting | Compartido, una carpeta por sitio. Sin contenedor por usuario |
| Representación del sitio | Documento JSON estructurado (páginas, secciones, bloques) validado por `site-schema`. Nunca HTML libre generado por agentes |
| Dónde vive el documento | Borrador y versiones en **PostgreSQL (`jsonb`)**. En disco solo los releases generados y las imágenes |
| Publicación | Borrador y publicado separados, versiones inmutables, rollback. Los agentes nunca publican; solo el dueño pulsa Publicar |
| Sitios públicos | HTML estático generado por el `renderer` y servido por Caddy, siempre detrás del proxy de Cloudflare |
| Aislamiento de orígenes | Tres familias de dominios distintas: aplicación, sitios (pool) y vista previa. Ningún contenido de usuario se sirve en el dominio de la aplicación |
| Contenedores | Monolito modular y pocos contenedores; se separa solo por riesgo o carga distinta |
| Disco | Bind mount local en `/data`, capa `storage` abstracta, backups externos. Sin S3 al inicio |
| Claves de modelos | Solo en el servicio `llm-gateway`. Ningún otro servicio, agente, sandbox ni instancia de canal las tiene |
| Agentes | Propios, con configuración propia. Se reutilizan librerías de infraestructura (grammY, OpenClaw para WhatsApp, Playwright), no agentes de terceros |
| Cobro | Suscripción por sitio, **cantidad = páginas publicadas, sin tope de páginas**. Estados `trial` (7 días desde la creación de la cuenta, sin gracia al terminar), `active`, `grace` (4 días en línea, solo para cuentas con plan suscrito cuyo cobro falla), `dark` (sin pago: la web no muestra nada y el ancla `delete_after` define los 30 días de conservación), `expired`, `canceled`. Dominio propio solo con suscripción `active` |
| Límite de páginas | No existe. El único límite de tamaño es 20 MB por página; un sitio puede tener cualquier número de páginas |
| Formas de pago | Un proveedor de cobros (tarjeta y medios locales del país objetivo) con webhooks idempotentes y recibo por correo. Los importes viven en configuración versionada, nunca en el código |
| Créditos de IA | Ledger de créditos por usuario para ejecuciones de agentes. Se consume por ejecución, nunca de forma ilimitada. Es independiente del cobro por página |
| Contenido prohibido | Odio, acoso, pornografía, pedofilia, violencia explícita, contenido ilegal, drogas, armas, fraude y phishing. Revisión automática al publicar, re-escaneo periódico y revisión humana. Bloqueo de publicación y suspensión inmediata |
| Vídeos | Propios (subidos): máximo 2 por página y **8 MB cada uno**, cuentan para el límite de 20 MB. Incrustados de YouTube, Vimeo o proveedor de la lista permitida: **sin límite de cantidad**, no consumen nuestro disco ni cuentan para el límite de página |
| Salida hacia clientes finales | Única función `sendReply`, solo como respuesta a un mensaje entrante (puerta de solo respuesta). Sin difusión ni mensajes proactivos |
| WhatsApp de los clientes | Mediante OpenClaw (WhatsApp Web), una instancia por cliente, solo como complemento, con riesgo de bloqueo aceptado y aceptación del cliente registrada. Todo sitio incluye además un botón de chat directo de WhatsApp (enlace), sin integración. La API oficial de Meta queda como mejora futura y es obligatoria para cualquier mensaje proactivo futuro |
| Agente de programación | Sandbox propio sin secretos ni acceso a producción. Devuelve un parche; un worker abre el Pull Request; un humano aprueba |
| Scraper de referencia | Sandbox web propio con salida a internet solo por un proxy de salida; extrae estructura y estilo, nunca copia textos ni imágenes ajenas |
| Aprendizaje del agente de atención | Lecciones propuestas y aprobadas por el dueño. No se reentrena el modelo |
| Stack | TypeScript, Next.js, PostgreSQL con pgvector, Redis con BullMQ, editor Puck, pnpm y Turborepo, Drizzle |
| Modelos por agente | Diseño: Claude Haiku 5.5 (Sonnet 5.5 en modo Completo y pasos críticos si la evaluación lo justifica). Programación: Claude Sonnet 5.5. Soporte y atención: Haiku 5.5 o GPT-6 Luna según evaluación (sección 8.3) |
| Referencias de diseño | taste-skill y ui-ux-pro-max-skill (ambos MIT) se usan como método y datos de estudio, no como dependencias en ejecución |
| Biblioteca de estilos | Catálogo de **descriptores y tokens**, nunca HTML ajeno. Solo fuentes con **licencia libre verificada**. **Crece sola:** crawl mensual de orígenes aprobados y **3–5 variantes automáticas** por página capturada. **Aprende del estilo que los usuarios eligen y publican.** El operador solo aprueba en lote. Toda entrada es responsive |
| Intervención humana en el catálogo | **Cero, en todo el ciclo.** El sistema descubre orígenes nuevos, encuentra páginas nuevas en los que ya tiene, captura, valida y activa solo. La licencia de cada fuente se verifica por código |
| Linter de calidad visual | Reglas deterministas propias **adaptadas de *impeccable*** (Apache 2.0, con atribución), ejecutadas sobre el HTML del release. No es dependencia en ejecución: no se instala su CLI ni se envía telemetría |

## 3. Arquitectura

### 3.1 Servicios

| Servicio | Contiene | Redes | Fase |
| --- | --- | --- | --- |
| `platform` | Next.js: dashboard, editor, API pública, auth, sitios, suscripciones y pagos, dominios, vista previa, gateway de canales y endpoints de sitio `/_f/` y `/_c/` | `core`, `edge` | 0 |
| `workers` | Procesos BullMQ: publicación, imágenes, DNS, notificaciones, mantenimiento y ejecución de agentes, cada uno en su cola | `core` | 0 |
| `caddy` | Servidor estático de los sitios publicados. Solo HTTP interno, detrás de Traefik; sin TLS ni ACME propios | `core`, `edge` | 1 |
| `postgres` | PostgreSQL con pgvector | `core` | 0 |
| `redis` | Colas, caché, rate limiting y pub/sub | `core` | 0 |
| `llm-gateway` | Capa `llm`: único servicio con las claves de los proveedores. Emite y valida tokens temporales con presupuesto | `core`, `sandbox_web`, `sandbox_code`, `channels` | 4 |
| `internal-api` | Misma imagen que `platform`, otro punto de entrada. Expone **solo** las rutas permitidas para sandboxes e instancias de canal | `core`, `sandbox_web`, `sandbox_code`, `channels` | 5 |
| `egress-proxy` | Proxy de salida (tipo Smokescreen) que bloquea rangos privados, locales y de metadatos, también tras redirecciones y DNS rebinding | `sandbox_web`, `sandbox_code`, `outbound` | 5 |
| `sandbox-web` | Playwright: scraper de referencia, revisión visual, linter renderizado, Lighthouse | `sandbox_web` | 5 |
| `sandbox-code` | Agente de programación, efímero, con copia del repositorio | `sandbox_code` | 10 |
| `openclaw-<siteId>` | Una instancia por sitio con el complemento de WhatsApp, creada y destruida por el aprovisionador | `channels` | 9 |

Servicios del lanzamiento: `platform`, `workers`, `caddy`, `postgres`, `redis` y `llm-gateway`. El número de servicios no crece con los usuarios, salvo las instancias de OpenClaw del complemento.

Por qué `internal-api` es un servicio aparte: en Docker no se puede limitar qué puertos de un contenedor ve cada red. Si `platform` estuviera en la red del sandbox, el sandbox alcanzaría toda su API. `internal-api` solo registra las rutas de la lista permitida y usa un rol de base de datos propio.

### 3.2 Redes

| Red | Tipo | Miembros |
| --- | --- | --- |
| `edge` | Externa (red de Coolify/Traefik) | `platform`, `caddy` |
| `core` | Interna | `platform`, `workers`, `caddy`, `postgres`, `redis`, `llm-gateway`, `internal-api` |
| `sandbox_web` | `internal: true` | `sandbox-web`, `egress-proxy`, `internal-api`, `llm-gateway` |
| `sandbox_code` | `internal: true` | `sandbox-code`, `egress-proxy`, `internal-api`, `llm-gateway` |
| `channels` | `internal: true` | instancias de OpenClaw, `egress-proxy` (si se necesita), `internal-api`, `llm-gateway` |
| `outbound` | Con salida a internet | `egress-proxy` |

Reglas obligatorias:

- Los sandboxes y las instancias de canal **no tienen ruta** hacia `postgres`, `redis`, `platform`, `workers` ni el volumen de sitios. Su única salida a internet es `egress-proxy`.
- `egress-proxy` aplica listas por red: `sandbox_web` puede ir a internet público (no a rangos privados); `sandbox_code` solo al registro de paquetes y a la API de GitHub de solo lectura si hiciera falta; las instancias de OpenClaw solo a los dominios de WhatsApp necesarios.
- Usuarios de base de datos separados por servicio con permisos mínimos (sección 7.1). `caddy`, sandboxes e instancias de canal no acceden a la base de datos.
- Montajes de disco: ver sección 4.1.
- Los agentes acceden a los datos únicamente mediante herramientas que llaman a la API con un token acotado a usuario, sitio, permisos y tiempo.

### 3.3 Colas

Colas BullMQ con concurrencia y prioridad propias, para que una carga no retrase a otra:

| Cola | Concurrencia inicial | Notas |
| --- | --- | --- |
| `publish` | 2 | Un candado por sitio: nunca dos publicaciones del mismo sitio a la vez |
| `images` | 4 | Procesado con `sharp` |
| `dns` | 2 | Verificación de dominios propios con backoff |
| `notifications` | 4 | Correo, Telegram, Web Push, WhatsApp del aviso al dueño |
| `billing` | 2 | Cobro, renovación, webhooks del proveedor, reintentos y suspensión por impago |
| `moderation` | 2 | Revisión automática de contenido al publicar y re-escaneo periódico |
| `agent-design` | 4 | Ejecuciones largas |
| `agent-batch` | 2 | SEO y tareas sin usuario esperando |
| `agent-support` | 4 | Interactiva, prioridad alta |
| `attention` | 10 | Interactiva, prioridad máxima, objetivo de primera respuesta < 5 s |
| `channels-in` | 10 | Normalización de mensajes entrantes |
| `sandbox-web-jobs` | 2 | Una pestaña aislada por trabajo |
| `sandbox-code-jobs` | 1 | Un contenedor efímero por incidente |
| `maintenance` | 1 | Limpieza de releases, reconciliación disco–base de datos, retención de datos |

Las respuestas interactivas (soporte y atención) se envían al navegador por SSE desde `platform`, que se suscribe a un canal de Redis por conversación.
