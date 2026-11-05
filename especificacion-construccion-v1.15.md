# Especificación de construcción: plataforma de sitios web con agentes de IA

Documento de traspaso para el equipo o agente constructor · Versión 1.15 · 4 de noviembre de 2026

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
8. Convenciones: código, nombres y comentarios en inglés. La interfaz de administración y de diseño existe en **español e inglés** desde la Fase 0 (ver sección 2, idioma). El contenido de los sitios lo escribe el dueño en el idioma que elija.
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
| Sitios por cuenta | **Un sitio publicado por cuenta.** El cliente puede crear varios diseños (borradores), pero solo uno puede estar `active` a la vez. Publicar otro exige despublicar el anterior de forma explícita. Los borradores no cobran; el cobro es por el sitio publicado |
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
| Idioma de la plataforma | **Dos locales de primera clase: `es` y `en`.** El dueño elige el idioma de su panel, de los avisos y del agente de diseño en su cuenta; se puede cambiar en cualquier momento. Ambos locales se mantienen al mismo nivel: un texto nuevo no se publica si falta en cualquiera de los dos |
| Idioma del contenido del sitio | Independiente del idioma de la interfaz. El dueño escribe su sitio en el idioma que quiera; el agente de diseño responde en el idioma de la interfaz del dueño |
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

Servicios del lanzamiento (Fase 0 a 4): `platform`, `internal-api`, `workers`, `caddy`, `postgres`, `redis` y `llm-gateway`. Los sandboxes (`egress-proxy`, `sandbox-web`, `sandbox-code`) se despliegan desde la Fase 5. El número de servicios no crece con los usuarios, salvo las instancias de OpenClaw del complemento y los `sandbox-code-jobs` efímeros.

**Cada servicio de la tabla es un contenedor de Coolify y tiene su propio Dockerfile.** No existe un Dockerfile único. La tabla de la sección 11 indica el *base directory* y el Dockerfile de cada uno.

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

## 4. Almacenamiento y publicación

### 4.1 Dónde vive cada dato

**PostgreSQL:** borrador (`site_drafts`), versiones inmutables (`site_versions`), checkpoints y todo el estado. Así el control de concurrencia, RLS y los backups son coherentes entre sí.

**Disco:**

```
/data/incoming/<uploadId>          # subidas sin procesar (escribe platform, lee workers)
/data/sites/<siteId>/
├── uploads/<assetId>.<ext>        # imágenes optimizadas (fuente de verdad de imágenes)
├── releases/v<N>/                 # HTML generado e inmutable de cada versión publicada
│   ├── index.html, <slug>/index.html
│   ├── sitemap.xml, robots.txt
│   └── assets/                    # hardlinks a uploads usados + CSS, JS mínimo y fuentes
└── public -> releases/v<N>        # enlace simbólico a la versión activa
/data/hosts/<hostname> -> /data/sites/<siteId>/public
```

- Cada release es autocontenido: incluye sus imágenes (hardlinks desde `uploads/`, mismo sistema de archivos), sus fuentes y su CSS. Un rollback recupera exactamente lo que se publicó.
- `/data/hosts/` tiene un enlace por hostname activo. Caddy resuelve host a carpeta sin consultar la base de datos. Suspender un sitio es borrar sus enlaces y purgar la caché (sección 5.6).

**Montajes por servicio (mínimo privilegio):**

| Servicio | `/data/incoming` | `/data/sites` | `/data/hosts` |
| --- | --- | --- | --- |
| `platform` | lectura y escritura | solo lectura (vista previa de imágenes) | sin montar |
| `workers` | lectura y escritura | lectura y escritura | lectura y escritura |
| `caddy` | sin montar | solo lectura | solo lectura |
| resto | sin montar | sin montar | sin montar |

Los datos propios de Caddy se montan en `/caddy-data`, **nunca bajo `/data`**, para que ninguna ruta servida pueda alcanzarlos.

### 4.2 Reglas de almacenamiento

- Todo acceso a disco pasa por el paquete `storage` (`read`, `write`, `list`, `delete`, `hardlink`, `atomicSwap`), de modo que se pueda cambiar a S3 o a varios servidores sin tocar el resto.
- **Obligatorio:** el `siteId` es un UUID del sistema y los nombres de archivo de assets son `assetId` generados. Nunca se usan nombres escritos por el usuario como ruta. Toda ruta resuelta (con `realpath`) debe quedar dentro de `/data/sites/<siteId>/`; pruebas específicas de path traversal, enlaces simbólicos maliciosos y nombres Unicode.
- Subidas: tipo comprobado por contenido (no por extensión), solo formatos de imagen permitidos, sin SVG del usuario (o SVG saneado y servido como imagen), límite de tamaño y de píxeles (protección contra bombas de descompresión), metadatos EXIF eliminados.
- Cuotas de disco por sitio, calculadas al subir. **No hay límite de número de páginas**; los límites son de peso (20 MB por página y el total de assets de 14.1), de imágenes y de vídeos subidos.
- Conservar los últimos 20 releases por sitio (configurable) y limpiar los demás con `maintenance`. Las versiones en Postgres se conservan según la misma política.
- Disco de datos separado del sistema si es posible, con alerta al 80 % de uso.

### 4.3 Flujo de publicación

1. Toda edición, manual o de un agente, escribe solo en el borrador, con control optimista por `draft_rev` (una escritura con revisión vieja falla y el cliente recarga o fusiona).
2. La vista previa renderiza el borrador con el mismo `renderer` que la publicación, en el **dominio de vista previa** (sección 5.5).
3. Al pulsar **Publicar**, la API comprueba tres cosas y encola un trabajo en `publish` con la revisión del borrador: que la suscripción del sitio esté `active`, en `grace` (4 días, cuenta con plan suscrito) o en `trial` (7 días desde la creación de la cuenta) si es publicación en subdominio del pool; que el sitio no esté suspendido; y que cumpla las cuotas de 14.1. Si la publicación va a un dominio propio, la suscripción debe estar estrictamente `active`. Una cuenta cuyo `trial` terminó sin pago no publica y su sitio ya está apagado.
4. El worker toma el candado del sitio y:
   1. valida el JSON contra el esquema (y migra si es de una versión anterior);
   2. ejecuta el linter estático (sección 6.4), el linter visual (sección 6.5) y la revisión automática de contenido (sección 10.1); solo detienen la publicación los hallazgos `error` de esquema de 6.4 y los de contenido de 10.1; los `error` de 6.5 y todos los `warning` se muestran al dueño, que decide si publica igual, y la decisión queda en `audit_log`;
   3. inserta `site_versions` (N) con el documento y su hash;
   4. genera el HTML en `releases/v<N>.tmp/`, crea los hardlinks de assets y renombra a `releases/v<N>/`;
   5. crea un enlace temporal y lo renombra sobre `public` (cambio atómico);
   6. actualiza `sites.published_version` en una transacción; si falla, revierte el enlace;
   7. purga la caché de Cloudflare de los hostnames del sitio;
   8. registra en `usage_events` la cantidad de páginas de la versión publicada (unidad de cobro);
   9. si el complemento de atención está activo, encola la reindexación del conocimiento del sitio.
5. **Rollback:** repuntar `public` a un release anterior existente, actualizar la versión activa y purgar la caché.
6. **Reconciliación:** al arrancar y cada hora, `maintenance` compara `published_version` con el destino de `public` y los enlaces de `/data/hosts` con los dominios activos; corrige y alerta las diferencias.
7. El panel muestra «Tienes cambios sin publicar» cuando el hash del borrador difiere del de la versión activa.

### 4.4 Ediciones de agentes y del dueño a la vez

- Mientras un agente de diseño trabaja sobre un sitio, el editor queda en solo lectura con un aviso y un botón «Detener agente». La vista previa muestra el progreso.
- Antes de empezar, el agente crea un checkpoint automático. Al terminar, el dueño ve las diferencias y puede aceptar o «Deshacer todo» (revertir al checkpoint).
- Un agente solo puede tener una ejecución activa por sitio.

## 5. Dominios, borde y TLS

### 5.1 Familias de dominios

| Familia | Ejemplo | Sirve | Quién responde |
| --- | --- | --- | --- |
| Aplicación | `app.plataforma.com`, `api.plataforma.com` | Panel, editor, API, auth | `platform` |
| Sitios (pool) | `<sub>.sitios-a.com`, `<sub>.sitios-b.com` | Sitios publicados | `caddy` |
| Vista previa | `<token>.vistaprevia.com` | Borradores renderizados | `platform` (solo la ruta de vista previa) |
| Dominios propios | `www.cafe-siete.com` | Sitios publicados | `caddy` |

Ninguna cookie de sesión de la aplicación es válida en las familias de sitios o de vista previa. Ningún recurso de un sitio se carga desde un host común de la plataforma.

### 5.2 Borde de red

**Esta decisión se prueba el primer día de la Fase 2, antes de construir nada más sobre ella; es la primera tarea de la fase, no una validación al margen.** Todo el tráfico entra por el **proxy de Cloudflare**.

**Diseño elegido (no depende de tocar el borde global de Coolify):**

- **Traefik de Coolify sigue siendo el único proceso en 80/443 y conserva su configuración por defecto.** No se desactiva su proveedor Docker ni se le quita ningún router existente; el resto de aplicaciones desplegadas en el mismo servidor con Coolify siguen funcionando exactamente igual.
- Se añaden **routers y un middleware adicionales** mediante proveedor de archivo dinámico de Traefik (un directorio montado con `.yml`, sin tocar la base de datos de Coolify): un router para los hostnames de la aplicación y de vista previa hacia `platform`, y un router comodín de **prioridad mínima** (`priority: 1`) hacia `caddy:80` que solo captura lo que ningún otro router de Coolify reclama.
- Esto convive con cualquier otra app de Coolify porque Traefik resuelve primero los routers de mayor prioridad (los que Coolify genera para otras apps) y el comodín solo actúa como última opción. Si dos apps definieran el mismo hostname habría conflicto, pero eso ya sería un conflicto sin esta plataforma; los hostnames de sitios (pool y dominios propios) son exclusivos de esta plataforma y no chocan con nada.
- TLS: Traefik usa el `resolver` de ACME de Coolify para la aplicación (como cualquier otra app) y un **certificado de origen de Cloudflare** (Origin CA, comodín por dominio del pool y de vista previa) cargado como `tls.certificates` adicional del proveedor de archivo, solo para los hostnames de sitios. No reemplaza el `tls.certResolver` que usan otras apps.
- **Authenticated Origin Pulls** (mTLS de Cloudflare hacia el origen) se activa **solo en los routers de sitios añadidos**, no de forma global, para no exigir certificado de cliente a quienes entran por otras apps de Coolify sin pasar por Cloudflare.
- Firewall del servidor: en lugar de bloquear 80/443 globalmente (lo que rompería apps de Coolify sin Cloudflare delante), se filtra por hostname dentro de Traefik: los routers de sitios exigen `ClientIP` de los rangos publicados por Cloudflare mediante un middleware `ipAllowList`; el resto de routers de Coolify no se tocan.
- La IP real del visitante se toma de `CF-Connecting-IP` **solo** en las rutas de sitios, donde el `ipAllowList` ya garantiza que la petición viene de Cloudflare.
- Cloudflare en modo SSL **Full (strict)** para los dominios del pool y de vista previa.

**Procedimiento de validación (día 1, Fase 2):** desplegar el proveedor de archivo dinámico en un entorno de prueba de Coolify junto con una app de ejemplo sin Cloudflare; confirmar que la app de ejemplo sigue accesible igual que antes y que un hostname de prueba del pool resuelve por `caddy`. Si Coolify no admite un proveedor de archivo dinámico en la versión instalada, la alternativa (b) de abajo es el valor por defecto inmediato, sin bloquear la fase.

**Alternativa (b), si (a) no es viable:** Caddy como único borde en 80/443, con el proveedor Docker de Traefik limitado a una red distinta o desactivado solo para los puertos públicos, y `reverse_proxy` hacia `platform` para la aplicación. Esto sí puede afectar a otras apps de Coolify que dependan de Traefik en esos puertos; solo se adopta si el servidor es dedicado a esta plataforma o si se confirma que ninguna otra app lo necesita. Se documenta con un ADR en cualquiera de los dos casos.

### 5.3 Subdominios del pool

**Cómo funciona una petición, de principio a fin:**

1. El navegador pide `cliente1.sitios-a.com`. La zona `sitios-a.com` está en Cloudflare con **un único registro comodín `*.sitios-a.com` proxied**. Ese comodín cubre todos los subdominios de primer nivel: no se crea un registro por sitio.
2. Cloudflare termina el TLS del visitante (Universal SSL ya incluye el comodín) y reenvía la petición al origen con `Host: cliente1.sitios-a.com`, usando el certificado de origen comodín instalado en Traefik.
3. Traefik aplica el router comodín de sitios y pasa a `caddy:80`.
4. **Caddy no resuelve DNS, no pide certificados y no consulta la base de datos.** Lee el `Host`, valida que es un nombre DNS correcto y sirve `/data/hosts/cliente1.sitios-a.com`, que es un enlace al sitio.

**Consecuencias:**

- **Una sola llamada a la API de DNS de Cloudflare por dominio del pool**, al darlo de alta. Crear, publicar o borrar un sitio **no toca la API de DNS**.
- Las únicas llamadas por sitio son la **purga de caché** al publicar y al apagar, y el alta de hostnames personalizados de 5.4.
- Si se quisiera un registro por sitio habría que crear y borrar registros en cada alta y baja, con reintentos y sincronización con `/data/hosts/`. No es el diseño elegido: el comodín es más simple y falla menos.

- Tabla `site_domain_pool` (`zone_id`, `domain`, `capacity`, `used`, `status`). Cada dominio aloja como máximo `capacity` sitios (por defecto 180, política propia para limitar el daño si un dominio se marca por abuso). Al 80 % de uso se alerta al operador para añadir otro dominio (paso manual con checklist en `docs/runbooks/`).
- Subdominios reservados no asignables: `app`, `api`, `www`, `admin`, `mail`, `status`, `support`, `login`, nombres de marcas conocidas y una lista mantenida de términos sensibles (banco, pago, verificación, etc.).
- Un subdominio liberado no se reasigna hasta pasados 90 días.

### 5.4 Dominios propios

**El dominio del cliente se queda donde esté registrado.** No se le pide crear una cuenta de Cloudflare, ni cambiar de registrador, ni mover sus nameservers. Da igual que el dominio esté en GoDaddy, Namecheap, Donweb, Hostinger, Cloudflare o cualquier otro: la plataforma funciona de la misma forma en todos.

#### 5.4.1 Qué se le pide al cliente

Un solo registro en su proveedor: **un `CNAME` hacia `origin.sitios-saas.com`** (nuestro *fallback origin*). Nada más.

- El `CNAME` no apunta a la IP del servidor. **Nunca se publica ni se entrega la IP del origen.** El tráfico entra siempre por el proxy de Cloudflare, que aporta WAF, rate limiting y ocultación del origen.
- El certificado del dominio personalizado lo emite y renueva Cloudflare **en nuestra cuenta**, no en la del cliente. El cliente no gestiona certificados ni tiene que activar nada en Cloudflare.
- Cloudflare for SaaS solo necesita que el hostname resuelva hacia el fallback origin. No requiere transferir el dominio ni cambiar los nameservers del cliente.

#### 5.4.2 Qué hace la plataforma

1. El dueño escribe el dominio en el panel. `workers` crea el hostname personalizado en Cloudflare por API (token solo en `workers`, con permiso únicamente sobre hostnames personalizados de esa zona).
2. **Verificación de propiedad obligatoria:** el dueño crea un registro TXT `_plataforma-verify.<hostname>` con el token por sitio que muestra el panel. Sin TXT válido el dominio no se activa, aunque el `CNAME` ya apunte a la plataforma. Esto impide reclamar dominios ajenos y el secuestro de `CNAME` colgados.
3. El job `dns` comprueba TXT y `CNAME` con reintentos y backoff (cada 48 h, hasta 7 días).
4. Al activarse, el worker crea el enlace en `/data/hosts/<hostname>`. **Caddy no habla con Cloudflare**: solo recibe el `Host` y sirve la carpeta enlazada.
5. Estados: `pending`, `verifying`, `active`, `error`, `removed`.
6. HTTPS forzado en Cloudflare y redirección raíz/`www` según la preferencia del dueño.
7. Al quitar un dominio o borrar un sitio: se borra el hostname en Cloudflare y el enlace local. Reconectar el mismo hostname a otro sitio exige un TXT nuevo.

#### 5.4.3 El dominio raíz (`cliente.com` sin `www`)

Aquí está la única dificultad real del flujo, y **no depende de Cloudflare sino del proveedor del cliente**: la raíz de una zona no admite `CNAME` por norma DNS. Caminos, en orden de preferencia:

| Camino | Cuándo aplica | Qué hace el cliente |
| --- | --- | --- |
| 1. `ALIAS` / `ANAME` / CNAME flattening | El proveedor lo soporta (Cloudflare, DNSimple, Route 53 alias, algunos más) | Crea el registro especial en la raíz hacia `origin.sitios-saas.com` |
| 2. Apex Proxying de Cloudflare for SaaS | El proveedor no soporta lo anterior y se contrata esta función (de pago) | Crea un registro `A` normal hacia los prefijos de IP que le damos, que sí admite la raíz |
| 3. Solo `www` con redirección | Ninguna de las dos está disponible | Apunta `www` con `CNAME` y configura en su proveedor la redirección de la raíz hacia `www` |

- El camino 2 lo paga y lo configura la plataforma; el cliente solo copia un registro `A`. Confirma el plan contratado antes de prometerlo.
- **Valor por defecto:** el panel detecta el proveedor del dominio (por sus nameservers), aplica el camino 1 si lo soporta, el 3 si no, y muestra el 2 solo si está contratado.
- Verificar los tres caminos en la Fase 3 con dominios reales en GoDaddy, Namecheap y Cloudflare. Es el punto con más abandonos del flujo de dominio propio.

#### 5.4.4 Si más adelante se descarta Cloudflare for SaaS

Alternativa, solo si se decide abandonarla: el cliente apunta un registro `A` a la IP del servidor y el borde usa TLS bajo demanda con un endpoint `ask` que solo autoriza hostnames `active` en `domains`. Implica publicar la IP del origen, renunciar a WAF y rate limiting de Cloudflare en esos dominios y añadir emisión de certificados por hostname. No es el valor por defecto y requiere ADR.

**Punto a validar en la Fase 3:** cómo valida Cloudflare el certificado de origen para hostnames personalizados en modo estricto. Valor por defecto: Full (strict) si el certificado de origen del fallback origin es aceptado; si no, Full con Authenticated Origin Pulls (el tramo Cloudflare–origen queda cifrado y autenticado por mTLS). Se documenta con un ADR.

### 5.5 Vista previa

**La vista previa aislada se construye en dos variantes desde la Fase 1, no una sola dependiente de la Fase 2:**

- **Local y desarrollo (Fase 1, sin Cloudflare):** `<previewToken>.preview.localhost:3000` (o el puerto local de `platform`). `localhost` y sus subdominios resuelven a `127.0.0.1` sin configuración de DNS en cualquier sistema operativo moderno, así que el aislamiento de origen (cookie de preview distinta del dominio de la app, CSP, `X-Robots-Tag`) puede probarse igual que en producción desde el primer día, sin esperar a Cloudflare ni a dominios reales. `platform` enruta por el subdominio igual que en producción.
- **Producción (Fase 2, con Cloudflare):** `<previewToken>.vistaprevia.com`, mismo mecanismo, con Cloudflare delante.
- En ambos casos: `previewToken` es aleatorio y de un solo uso para iniciar la sesión de vista previa. El panel genera un enlace firmado y de corta duración (15 minutos, valor por defecto, ver 14.1). Al abrirlo, `platform` lo canjea por una cookie `HttpOnly`, `Secure` (en local, `Secure` se relaja solo si se sirve por HTTP puro de desarrollo), `SameSite=Strict`, limitada a ese subdominio y a ese sitio, y redirige quitando el token de la URL.
- Cabeceras: `X-Robots-Tag: noindex`, CSP igual que la del sitio publicado, sin acceso a la API de la aplicación.
- El editor muestra la vista previa en un `iframe` con `sandbox="allow-scripts"` (sin `allow-same-origin` respecto a la aplicación).
- **Aceptación de la Fase 1:** la prueba de aislamiento de origen de la vista previa corre en CI contra `*.preview.localhost`, sin ninguna dependencia de Cloudflare, DNS real o la Fase 2.

### 5.6 Caddy y rutas del propio sitio

Boceto de `Caddyfile` (a validar en la Fase 2):

```
{
  auto_https off
  admin off
  storage file_system /caddy-data
  servers {
    trusted_proxies static private_ranges
  }
}

:80 {
  # Obligatorio: el host se usa como ruta; solo se aceptan nombres DNS válidos.
  @badhost not header_regexp Host ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$
  respond @badhost 404

  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy "default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
    -Server
  }

  handle /_f/* {
    reverse_proxy platform:3000
  }
  handle /_c/* {
    reverse_proxy platform:3000
  }
  handle {
    root * /data/hosts/{host}
    file_server
    encode zstd gzip
  }
  handle_errors {
    respond "Sitio no disponible" 404
  }
}
```

- Los formularios (`/_f/lead`) y el widget de chat (`/_c/`) usan **la misma dirección del sitio**; Caddy los reenvía a `platform` conservando `Host`. `platform` resuelve el sitio a partir del hostname en la tabla `domains` (nunca de un parámetro del cliente). No hay peticiones a un dominio común ni CORS, y no se revela la plataforma.
- **Respuesta idéntica** para hosts inexistentes, suspendidos o borrados.
- **Apagado y suspensión:** borrar los enlaces de `/data/hosts/` del sitio y **purgar la caché de Cloudflare** de todos sus hostnames en el mismo trabajo. Es el mismo mecanismo para el paso a `dark` por impago y para `suspended` por abuso o contenido prohibido. Prueba de aceptación: un sitio apagado deja de verse en menos de un minuto y responde igual que un host inexistente.
- Reglas de caché de Cloudflare: HTML con caché corta y purga en cada publicación; `assets/` con nombres con hash y caché larga; `/_f/*` y `/_c/*` sin caché.
- Mapas: enlace o imagen estática (los mapas incrustados no están permitidos en la v1).
- **Vídeos incrustados:** el único `iframe` de terceros permitido es el de un proveedor de vídeo de la lista permitida (YouTube con dominio `youtube-nocookie.com`, Vimeo). `frame-src` de la CSP solo admite esos dos orígenes. El reproductor se carga con `loading="lazy"`, sin reproducción automática y con una imagen de portada propia. Nunca se incrusta un `iframe` con URL arbitraria del usuario: el documento solo guarda `provider` e `id` del vídeo y el `renderer` construye la URL a partir de esos campos validados.

## 6. Modelo de sitio (`site-schema`)

Es la pieza central del sistema y se define primero, en `packages/site-schema`, con validación Zod. Es el **formato canónico**: el editor Puck, los agentes y el `renderer` trabajan sobre él.

### 6.1 Estructura

```json
{
  "schemaVersion": 1,
  "meta": { "name": "Café Siete Puertas", "lang": "es", "favicon": "asset_01" },
  "design": {
    "brief": "Cafetería de barrio con tostión propia",
    "idea": "Las siete puertas de la calle se convierten en la navegación",
    "presetId": "editorial-calido",
    "dials": { "variance": 6, "motion": 3, "density": 4 }
  },
  "theme": {
    "colors": { "ground": "#F4EFE6", "ink": "#1B1B1B", "accent": "#B3422B" },
    "typography": { "family": "Source Serif 4", "scale": "large-display" },
    "spacing": { "margin": 24, "sectionGap": 160 },
    "radius": "square"
  },
  "pages": [
    {
      "id": "p_home",
      "slug": "/",
      "seo": { "title": "", "description": "", "ogImage": null, "noindex": false },
      "themeOverrides": {},
      "sections": [
        { "id": "s_hero", "type": "hero", "variant": "image-dominant",
          "props": { "headline": "", "subline": "", "cta": { "label": "", "href": "" }, "image": "asset_02" } }
      ]
    }
  ],
  "assets": [ { "id": "asset_02", "alt": "", "credit": null } ],
  "integrations": { "chatWidget": { "enabled": false }, "whatsapp": { "phone": null, "message": "" } }
}
```

Los assets del documento solo llevan `id`, `alt` y `credit`; la ruta física la resuelve el `renderer` desde la tabla `assets`. El documento nunca contiene rutas.

### 6.2 Reglas

- Todos los ids son estables (nanoid con prefijo). Los agentes editan por id, no por posición.
- `schemaVersion` obligatorio y migraciones encadenadas `migrate(vN → vN+1)`, con pruebas por migración. Al cargar un documento antiguo se migra antes de usarlo.
- Tipos de sección y bloque cerrados: un tipo desconocido falla la validación. Cada tipo declara sus `variants` y sus `props` con límites de longitud.
- **Obligatorio:** sin HTML ni JavaScript crudo. El texto enriquecido usa un subconjunto restringido de markdown (negrita, cursiva, enlaces, listas) y el `renderer` escapa todo lo demás.
- **Enlaces:** solo esquemas `https:`, `http:`, `mailto:`, `tel:` y `https://wa.me/`, y anclas internas. Se rechazan `javascript:`, `data:` y similares. Enlaces externos con `rel="noopener noreferrer"`.
- `slug` validado (minúsculas, guiones, sin `..` ni `/` repetidas, único por sitio).
- `themeOverrides` por página hereda del `theme` global y solo contiene diferencias.
- Colores validados como hexadecimales; tipografías solo de la lista alojada por la plataforma.
- `design` guarda brief, idea y preset para dar contexto a los agentes de diseño y SEO.
- Tipos de bloque multimedia: `video` con `props.source = own|embed`. `own` es un vídeo subido (máximo 2 por página, **8 MB**, con portada, cuenta para el límite de 20 MB). `embed` guarda solo `provider` (`youtube|vimeo`) e `id` validado por expresión regular, más un título y un texto alternativo; no tiene límite de cantidad y no consume disco ni cuenta para el límite de página. Nunca se guarda una URL completa ni HTML de inserción. Tipos de sección: `hero`, `text`, `gallery`, `video`, `feature-list`, `menu-list` (informativo), `pricing` (informativo, con aviso opcional de «precios de referencia»), `faq`, `contact` (información de contacto), `location` (dirección con enlace de mapa), `hours`, `lead-form` (campos configurables, texto de consentimiento y tipo `contact|quote|appointment`), `whatsapp-button`, `cta`, `testimonial`, `footer`. No existen tipos de compra ni de pago.
- `testimonial` lleva `ownerProvided: true`, que **solo** puede fijar el dueño desde la interfaz; las herramientas de agentes no pueden escribir ese campo. El `renderer` no publica testimonios sin él.
- Cada tipo de sección tiene un componente en `ui-components` con variantes de composición.

### 6.3 Editor y renderer

- Los componentes de `ui-components` son componentes React puros. El editor Puck los usa para editar y el `renderer` los convierte a HTML estático con `renderToStaticMarkup`, sin hidratación.
- Un adaptador probado convierte entre el formato de datos de Puck y `site-schema` en ambos sentidos. Prueba de ida y vuelta: `schema → puck → schema` es idéntico para todas las plantillas.
- El JavaScript de los sitios publicados se limita a scripts propios mínimos (menú móvil, envío del formulario, widget de chat), servidos desde `assets/` del propio sitio y compatibles con la CSP. Todo funciona sin JavaScript salvo el chat.

### 6.4 Linter: reglas y severidades

El linter es la guarda de calidad entre el borrador y la publicación. Se compone de dos implementaciones con el mismo contrato (`LintFinding`), para que ningún hallazgo dependa de un navegador salvo los que lo necesitan de verdad.

```ts
type Severity = 'error' | 'warning' | 'info';

interface LintFinding {
  code: string;          // identificador estable, p. ej. MISSING_ALT
  severity: Severity;
  pageId?: string;
  sectionId?: string;
  field?: string;
  message: string;       // clave de traducción; el texto se resuelve en el locale del dueño
  fixHint?: string;
  autofixable: boolean;
}
```

**Linter estático** (`packages/site-schema` + `renderer`, sin navegador; corre en la Fase 1 y en cada guardado del editor):

| Código | Severidad | Regla |
| --- | --- | --- |
| `SCHEMA_INVALID` | error | El documento no valida contra `site-schema` |
| `UNKNOWN_SECTION_TYPE` | error | Tipo de sección o variante inexistente |
| `UNSAFE_URL` | error | Enlace con esquema fuera de la lista permitida |
| `RAW_HTML` | error | Intento de HTML/JS en texto enriquecido |
| `DUPLICATE_SLUG` | error | Dos páginas con el mismo slug, o slug inválido |
| `MISSING_TITLE` | error | Página sin `seo.title` o título vacío |
| `EMPTY_PAGE` | error | Página sin secciones |
| `MISSING_ALT` | warning | Imagen sin texto alternativo |
| `MISSING_META_DESCRIPTION` | warning | Sin `seo.description` |
| `TESTIMONIAL_UNVERIFIED` | error | Testimonio sin `ownerProvided` |
| `FABRICATED_DATA` | error | Campos marcados como no confirmados por el dueño (ver 9.1) |
| `BROKEN_INTERNAL_LINK` | warning | Enlace a una página interna inexistente |
| `CTA_MISSING` | warning | Página sin ninguna llamada a la acción |
| `LONG_TEXT` | info | Bloque de texto por encima del límite recomendado |
| `THEME_CONTRAST` | warning | Par de colores con contraste calculado < 4.5:1 (se calcula sin navegador) |
| `FONT_NOT_HOSTED` | error | Tipografía fuera de la lista alojada |
| `IMAGE_TOO_LARGE` | warning | Imagen por encima del peso recomendado |
| `PAGE_TOO_HEAVY` | error | Página con más de 20 MB de peso propio (HTML, imágenes, vídeos subidos y fuentes). Los vídeos incrustados no cuentan |
| `VIDEO_LIMIT` | error | Más de 2 vídeos **subidos** en una página o un vídeo subido de más de **8 MB**. Los incrustados no tienen límite |
| `VIDEO_PROVIDER_UNKNOWN` | error | Vídeo incrustado de un proveedor fuera de la lista permitida |
| `VIDEO_ID_INVALID` | error | Identificador de vídeo incrustado fuera de formato |
| `CONTENT_FLAGGED` | error | El contenido del sitio activó la revisión de 10.1 y está en revisión humana |
| `TOO_MANY_IMAGES` | info | Más imágenes de las sugeridas en una sección |
| `IMAGE_LICENSE_MISSING` | error | Asset sin licencia registrada (ver tabla de 9.1) |

**Linter renderizado** (`sandbox-web` con Playwright, Fase 5; informativo y no bloqueante para publicar en la Fase 1–4):

| Código | Severidad | Regla |
| --- | --- | --- |
| `OVERFLOW_HORIZONTAL` | error | Desbordamiento horizontal en 360, 768, 1280 px |
| `TEXT_CLIPPED` | warning | Texto recortado o superpuesto |
| `HEADLINE_ORPHAN` | warning | Titular con una sola palabra en la última línea |
| `TOUCH_TARGET_SMALL` | warning | Objetivo táctil < 44×44 px |
| `CONTRAST_RENDERED` | warning | Contraste efectivo tras el renderizado |
| `LCP_SLOW` | warning | LCP > 2.5 s en red simulada 4G |

Reglas de aplicación:

- Los `error` del linter estático **bloquean la publicación**. Los `warning` no bloquean nunca; el panel los muestra antes de publicar y en el panel del sitio.
- El bloqueo de 6.4 es **técnico, no de gusto**: solo cae lo que no se puede renderizar (documento inválido, referencia rota, cuota excedida). **Ninguna regla de estilo, de 6.4 o de 6.5, impide publicar lo que el dueño pide**; esas se avisan y se confirman.
- Los `warning` `autofixable` (por ejemplo `MISSING_ALT` con alt generado desde el nombre del negocio) ofrecen un botón «Corregir» que aplica el cambio al borrador.
- En las Fases 1–4, la publicación manual **no requiere ninguna imagen** ni un número mínimo de secciones más allá de `EMPTY_PAGE`. La regla de mínimo de imágenes es una recomendación del agente de diseño (`info`), nunca un bloqueo, para no impedir publicar sitios tipográficos o de una sola sección.
- Añadir una regla exige código estable, severidad, prueba de caso positivo y negativo, y entrada en esta tabla.

### 6.5 Linter de calidad visual (sobre el HTML del release)

Las reglas de 6.4 actúan sobre el **documento JSON**. Este segundo linter actúa sobre el **HTML generado**, justo después del paso 4 del flujo de publicación (4.3) y antes del swap atómico, porque hay defectos que solo se ven en el resultado: tipografías repetidas, degradados genéricos, tarjetas anidadas, jerarquía saltada.

**Origen y licencia:** el conjunto de reglas se adapta de [*impeccable*](https://github.com/pbakaus/impeccable) (Apache 2.0), que aporta 62 reglas deterministas sin LLM. La adaptación es una **copia con atribución en `NOTICE`**, no una dependencia: **no se instala su CLI, no se ejecuta su runtime y no se envía telemetría**. Sus reglas se reimplementan en `packages/lint-visual` para que no dependan de un proyecto externo.

**Motivo:** los agentes y los editores visuales convergen en los mismos tics. Detectarlos por código, con severidad y en CI, es más barato y más fiable que pedírselo a un modelo en el prompt.

| Código | Severidad | Regla |
| --- | --- | --- |
| `SLOP_FONT_MONOCULTURE` | warning | Más del 60 % del texto en una única tipografía genérica del sistema si la entrada del catálogo definía pairing |
| `SLOP_GENERIC_GRADIENT` | warning | Degradado con dos paradas en el rango violeta-azul por defecto sin relación con la paleta de la entrada |
| `SLOP_NESTED_CARDS` | warning | Tarjeta dentro de tarjeta dentro de tarjeta |
| `SLOP_ICON_TILE_ABOVE_EVERY_HEADING` | info | El mismo patrón decorativo sobre más de 3 titulares |
| `SLOP_LOW_CONTRAST_TEXT_ON_COLOR` | error | Texto con contraste < 4.5:1 sobre fondo de color |
| `SLOP_HEADING_SKIP` | error | Jerarquía de encabezados que salta niveles (h1 → h3) |
| `SLOP_PADDING_CRAMPED` | warning | Espaciado interior por debajo del ritmo definido en la entrada |
| `SLOP_CENTERED_EVERYTHING` | info | Todo el contenido centrado sin variación de alineación |
| `SLOP_SAME_CARD_RADIUS` | info | Un único radio en todos los contenedores, incluidos los que no lo piden |
| `SLOP_SHADOW_ON_EVERYTHING` | warning | Sombra aplicada a más del 80 % de los bloques |
| `SLOP_NO_VISUAL_HIERARCHY` | error | Ninguna diferencia de tamaño entre h1, h2 y cuerpo |
| `SLOP_UNRESPONSIVE_GRID` | error | Rejilla de más de 2 columnas que no colapsa por debajo de 768 px |
| `SLOP_FIXED_WIDTH_OVERFLOW` | error | Ancho fijo que provoca desbordamiento en 360 px |
| `SLOP_TOUCH_TARGET_SMALL` | warning | Objetivo táctil < 44×44 px |
| `SLOP_PLACEHOLDER_TEXT` | warning | Texto de relleno tipo «Lorem ipsum» o «pendiente de confirmar» en la versión que se publica |

Reglas de aplicación:

- **Ninguna regla de 6.5 bloquea una publicación pedida por el dueño.** Un `error` de 6.5 exige que el dueño **confirme** antes de publicar, no impide publicar: el panel muestra el hallazgo, el dueño pulsa «Publicar igual» y la publicación continúa. El bloqueo duro es exclusivo de 6.4 (documento inválido) y de la política de contenido (10.1).
- Los `warning` e `info` se muestran en el panel del sitio y **no interrumpen** en ningún caso.
- **El linter nunca actúa como puerta del agente.** Si el dueño pide publicar, se publica: la decisión es suya, la advertencia queda registrada en `audit_log` con quién confirmó y qué códigos había.
- `SLOP_PLACEHOLDER_TEXT` avisa pero no bloquea: un sitio puede publicarse con textos provisionales si el dueño lo decide, y el panel le recuerda que los complete.
- Las reglas de rendimiento y accesibilidad que requieren navegador siguen en el **linter renderizado** de 6.4 (Fase 5) y no se duplican aquí.
- El linter visual es determinista y sin coste de modelo. Se ejecuta en `workers` y en CI, con pruebas de caso positivo y negativo por regla.
- Cada regla nueva lleva su código, severidad, prueba y entrada en esta tabla, igual que en 6.4.

## 7. Modelo de datos (PostgreSQL)

Migraciones versionadas con Drizzle. Toda tabla con datos de un sitio incluye `site_id` y `owner_id`.

### 7.1 Aislamiento por fila (RLS)

- RLS activada y forzada (`FORCE ROW LEVEL SECURITY`) en todas las tablas con datos de usuario o sitio.
- Cada petición abre una transacción y ejecuta `SET LOCAL app.user_id = …` (y `app.site_id` cuando aplica); las políticas comparan con `current_setting('app.user_id')`. Una prueba falla si alguna consulta se ejecuta fuera de ese contexto.
- Roles de base de datos:

| Rol | Uso | RLS |
| --- | --- | --- |
| `app_platform` | `platform` | Sujeto a RLS |
| `app_internal_api` | `internal-api` | Sujeto a RLS; solo tablas que exponen las herramientas |
| `app_workers` | `workers` | Sujeto a RLS; los trabajos fijan el contexto del sitio que procesan |
| `app_maintenance` | Trabajos de mantenimiento y reconciliación | `BYPASSRLS`, solo en la cola `maintenance`, auditado |
| `app_llm_gateway` | `llm-gateway` | Solo `INSERT` en `usage_events` y lectura de presupuestos |
| `app_migrator` | Migraciones en despliegue | Propietario del esquema; nunca usado en ejecución |

### 7.2 Núcleo

- `users` (id, email, email_verified_at, name, role `owner|operator`, mfa_enabled, created_at)
- `sites` (id uuid, owner_id, name, status `draft|active|dark|suspended|deleted`, published_page_count, subdomain único, domain_pool_id, published_version, created_at, dark_since, delete_after, deleted_at) — sin cupo de páginas; **índice único parcial `sites_one_active_per_owner` sobre `(owner_id) WHERE status = 'active'`**, para que una cuenta no tenga dos sitios publicados aunque falle la aplicación; `published_page_count` es la unidad de cobro. `dark_since` es cuando el sitio dejó de servirse y `delete_after` es la fecha de borrado total (`payment_due_date + 30 días`), calculada al entrar en `dark`
- `account_terms` (user_id, account_created_at, trial_ends_at) — el fin de la prueba se fija al crear la cuenta y no se recalcula. La gracia no vive aquí: depende del ciclo de cobro de cada suscripción
- `site_members` (site_id, user_id, role `owner|editor|viewer`) — permisos por sitio
- `site_drafts` (site_id, rev, doc jsonb, doc_hash, updated_by_type `user|agent`, updated_by, updated_at)
- `site_versions` (id, site_id, version, schema_version, doc jsonb, doc_hash, created_by, note, created_at) — inmutable
- `draft_checkpoints` (id, site_id, rev, doc jsonb, created_by_type, label, created_at)
- `subscriptions` (id, site_id, status `trial|active|grace|dark|expired|canceled`, quantity_pages, provider, provider_ref, current_period_start, current_period_end, grace_until, cancel_at_period_end) — `grace_until` solo se rellena cuando falla el cobro de una suscripción ya activa; nunca se rellena en una cuenta que jamás pagó
- `payment_events` (id, subscription_id, provider_event_id único, type, payload jsonb, received_at) — idempotencia de webhooks del proveedor de cobros
- `invoices` (id, subscription_id, provider_invoice_id único, amount, currency, pages_billed, status, issued_at, paid_at)
- `ai_credit_ledger` (id, owner_id, site_id, delta, reason, run_id, created_at) — saldo de créditos de IA
- `content_reviews` (id, site_id, version, source `auto|report|periodic`, categories jsonb, score, status `pending|clear|blocked|human_review`, reviewer_id, notes, created_at, resolved_at)
- `domains` (id, site_id, hostname único, kind `subdomain|custom`, status `pending|verifying|active|error|removed`, verify_token, cf_hostname_id, verified_at, last_check_at, error)
- `site_domain_pool` (id, zone_id, domain, capacity, used, status `active|full|flagged|retired`)
- `released_hostnames` (hostname, released_at) — periodo de espera antes de reasignar
- `assets` (id, site_id, path, kind `image|video|poster`, bytes, mime, width, height, duration_s, source `own|generated|open-collection`, license, author, source_url, credit_text, `takedown_status` `active|withdrawn_by_claim`, created_at)
- `legal_acceptances` (id, user_id, site_id, document `terms|privacy|whatsapp_risk|whatsapp_notice`, text_version, accepted_at, ip)
- `abuse_reports` (id, site_id, hostname, reporter_contact, reason, status, created_at, resolved_by, resolved_at)
- `audit_log` (id, actor_type `user|operator|agent|system`, actor_id, site_id, action, target, meta jsonb, at) — solo inserción

### 7.3 Agentes y uso

- `agent_runs` (id, agent_id, user_id, site_id, status, model, prompt_tokens_max, tokens_in, tokens_out, trace_id, started_at, ended_at, stop_reason)
- `agent_tool_calls` (id, run_id, tool, input_hash, ok, error_code, ms)
- `agent_tokens` (jti, run_id, scopes, site_id, expires_at, revoked_at) — tokens acotados emitidos a agentes, sandboxes e instancias
- `usage_events` (id, user_id, site_id, kind, qty, at)
- `tickets` (id, user_id, subject, status, source_run_id, sentry_issue_id, assigned_to)
- `docs_chunks` (id, source, content, embedding vector(N), embedding_model) para el RAG de soporte

La dimensión `N` y el modelo de embeddings se fijan en la Fase 7 y se guardan por fila; cambiar de modelo implica reindexar, no migrar el esquema.

### 7.4 Atención al cliente y contactos

- `agent_settings` (site_id, enabled, persona, tone, rules jsonb, hours, escalation_timeout_min, channels_enabled)
- `owner_notification_prefs` (user_id, site_id, channels jsonb `panel|email|telegram|webpush|whatsapp`, quiet_hours, digest)
- `push_subscriptions` (id, user_id, endpoint, keys_encrypted, created_at)
- `channels` (id, site_id, kind `web|telegram|whatsapp`, credentials_encrypted, webhook_secret, status, instance_id)
- `openclaw_instances` (id, site_id, container_id, status `provisioning|linked|unlinked|stopped`, linked_phone_hash, created_at, last_seen_at)
- `contacts` (id, site_id, name, phone, channel, identifiers jsonb por canal, source, first_seen_at, last_interaction_at, status, tags, notes, created_at)
- `consents` (id, contact_id, purpose `attention|followup|marketing`, channel, granted_at, revoked_at, evidence_text_version, evidence_message_id)
- `leads` (id, site_id, contact_id, type `contact|quote|appointment`, message, consent_id, created_at, status)
- `conversations` (id, site_id, contact_id, channel, state `agent|waiting_owner|human|closed`, last_inbound_at, last_message_at)
- `messages` (id, conversation_id, role `customer|agent|owner`, provider_message_id, content, attachments, tools_used, created_at), con índice único (`channel`, `provider_message_id`)
- `escalations` (id, conversation_id, reason, summary, suggested_reply, status, notified_at, resolved_at)
- `knowledge_items` (id, site_id, kind, content, embedding vector(N), embedding_model, source, status)
- `lessons` (id, site_id, trigger_message_id, proposed_text, status `proposed|approved|rejected`, approved_by, approved_at)
- `outbound_log` (id, site_id, conversation_id, channel, sent_at, allowed_by_rule) — registro de cada envío de la puerta de solo respuesta

### 7.5 Catálogo de diseño

`design_product_types`, `design_styles`, `design_palettes`, `design_font_pairings`, `design_landing_patterns`, `design_ux_rules` y `design_antipatterns`. Cada fila lleva `source`, `license`, `verified_at` y `status` (`active|supplemental|deprecated`). Sin RLS (datos globales), escritura solo por el rol de migración o por el panel de operador.

La biblioteca de estilos de 7.7 añade las tablas de catálogo y trazabilidad de fuentes.

### 7.6 Retención

Retención configurable por tipo de dato: mensajes y conversaciones, contactos inactivos, leads, `audit_log`, `agent_runs`. Un trabajo de `maintenance` aplica la retención y el borrado por contacto. Los sitios borrados se conservan 30 días (estado `deleted`) y luego se eliminan disco, versiones y datos asociados.

## 8. Agent SDK y orquestación

### 8.1 Contrato común

```ts
interface AgentDefinition {
  id: string;
  description: string;
  model: string;
  systemPrompt: string;
  skills: SkillRef[];
  tools: ToolDef[];
  budget: { maxTokens: number; maxToolCalls: number; maxCostUsd: number; timeoutMs: number };
}

interface ToolDef<I, O> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  scopes: string[];
  mutates: boolean;
  handler(ctx: RunContext, input: I): Promise<O>;
}

interface RunContext {
  runId: string;
  userId: string;
  siteId?: string;
  token: string;
  locale: string;
}
```

### 8.2 Reglas obligatorias

- Los handlers llaman a APIs internas con tokens acotados; nunca acceden directamente a PostgreSQL, Redis, disco ni secretos.
- Toda entrada de herramientas se valida con Zod. Todo contenido de usuarios, visitantes, documentos o páginas externas es datos no confiables y nunca se interpreta como instrucciones.
- Las herramientas mutantes son idempotentes, escriben solo en borradores o tablas explícitamente autorizadas y registran auditoría.
- Cada ejecución tiene presupuesto de tokens, llamadas, costo, tiempo y tamaño de contexto. Al superarlo se detiene con estado explicable.
- El coordinador clasifica la intención y deriva al agente correcto; no puede conceder permisos.
- Los skills se cargan progresivamente. Las instrucciones externas se encapsulan como datos.
- `llm-gateway` valida modelo permitido, presupuesto, tamaño de prompt, usuario, sitio y scopes. Revoca tokens al terminar una ejecución.
- Se registra prompt truncado o hash, tokens, latencia, coste, modelo, resultado y motivo de parada. Nunca se guardan secretos en trazas.
- El agente nunca publica. Solo el dueño puede iniciar publicación desde una sesión autenticada.

### 8.3 Capa LLM

La capa admite varios proveedores por agente y una interfaz común. Mantiene claves solo en `llm-gateway`, aplica reintentos limitados, timeouts, circuit breaker, control de costes y trazas. El modelo se selecciona mediante configuración versionada y evaluación registrada, no por texto generado por el modelo.

Para modelos con límite de contexto se conserva el prompt por debajo de un umbral configurable, se resume el sitio, se recorta el historial y se cargan skills bajo demanda. No se envían parámetros no soportados por el modelo. Las respuestas rechazadas, incompletas o con herramientas inválidas son resultados controlados y nunca dejan trabajos bloqueados.

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

## 9. Agentes

### 9.1 Diseño

El agente de diseño recoge un brief, inventario del negocio, argumento por sección, dirección visual, idea diferenciadora y copy deck. Opera únicamente sobre `site-schema`, presenta diferencias y crea un checkpoint antes de mutar.

Herramientas: `get_site`, `plan_site`, `recommend_design_system`, `apply_preset`, `set_theme`, `add_section`, `update_section`, `move_section`, `remove_section`, `generate_copy`, `attach_asset`, `run_lint`, `request_visual_review`, `create_checkpoint`, `revert_to_checkpoint` y `analyze_reference`.

El modo rápido usa una ronda y presupuesto limitado. El modo completo y la revisión visual pueden usar un modelo superior si la evaluación lo justifica. El agente no inventa clientes, cifras, testimonios, precios, citas ni certificaciones. Todo contenido pendiente queda marcado para confirmación del dueño.

**Flujo paso a paso (modo completo):**

1. **Brief:** el agente pregunta tipo de negocio, nombre, ciudad, servicios principales, público, tono deseado, idioma, llamada a la acción principal y datos de contacto. Cada respuesta se guarda en `design.brief`.
2. **Inventario:** lista lo que el dueño ya tiene (logo, fotos, carta, horarios, dirección). Lo que falte se marca como pendiente, nunca se inventa.
3. **Recomendación:** consulta el catálogo (`design_product_types`, `design_styles`, `design_palettes`) y propone 2 o 3 presets con motivo para cada uno.
4. **Plan:** `plan_site` devuelve páginas, secciones y orden. El dueño aprueba o ajusta antes de construir.
5. **Checkpoint:** `create_checkpoint` antes de cualquier mutación.
6. **Construcción:** `apply_preset`, `set_theme`, `add_section`, `update_section` y `generate_copy`, solo sobre el esquema.
7. **Imágenes:** `attach_asset` solo con assets que cumplan la política de la tabla siguiente.
8. **Validación:** `run_lint` (6.4) y `run_visual_lint` (6.5). Un `error` de 6.4 vuelve al paso 6. **Un `error` de 6.5 no vuelve al paso 6 cuando fue el dueño quien pidió el cambio:** se aplica, se registra el aviso y se le informa. El agente nunca se bloquea a sí mismo ni bloquea al dueño por una regla de estilo.

**Herramienta `critique_draft`** (adaptada del comando `critique` de *impeccable*, con atribución): puntúa el borrador contra heurísticas de usabilidad y devuelve **como máximo los 3 problemas prioritarios**, con qué tocar y por qué. No devuelve una lista larga: obliga al agente a priorizar. Es determinista sobre tokens y estructura; el modelo solo redacta la explicación. Se ejecuta antes de la revisión visual con captura (`request_visual_review`, Fase 5).

**Vocabulario de dirección:** las 24 direcciones de *impeccable* (`bolder`, `quieter`, `distill`, `colorize`, `typeset`, `layout` y el resto) se adoptan como **nombres de variante del catálogo**, para que el dueño pida «más sobrio» o «más llamativo» y el agente sepa exactamente qué grupo de tokens mover.

**Biblioteca de estilos:** el agente elige la entrada con `recommend_design_system`, que **ordena las variantes por similitud con el vector de preferencia aprendido del usuario** (7.7.3). Solo puede aplicar entradas `active`. Si ninguna encaja, lo dice y aplica el preset más cercano, sin inventar una familia nueva.
9. **Entrega:** resumen de cambios, lista de datos pendientes de confirmar y diferencias contra el checkpoint. El dueño acepta o usa «Deshacer todo».

**Modo rápido (Fase 4):** una sola ronda con los campos mínimos (tipo de negocio, nombre, ciudad, un servicio y un contacto). Omite el paso 4 y usa el preset más adecuado. Los datos que faltan se dejan como marcadores visibles `pendiente de confirmar`, y el presupuesto de la ejecución está en 14.1.

**Política de imágenes y licencias (obligatoria):**

| Origen | Permitido | Requisito |
| --- | --- | --- |
| `own` (subida del dueño) | Sí | El dueño declara en la subida que tiene derechos sobre la imagen; se registra en `assets.license = owner-declared` |
| `generated` (IA de la plataforma) | Sí | Sin personas reconocibles ni marcas de terceros; se registra el modelo en `assets.license = platform-generated` |
| `open-collection` (CC0 o CC BY verificada) | Sí | Licencia y autor en `assets.license` y `assets.author`; crédito visible en `credit_text` cuando la licencia lo exija |
| Imágenes de Internet, redes sociales, carta o sitios de competidores | No | Prohibido. El scraper de referencia (Fase 5) extrae estructura y estilo, nunca imágenes ni textos |
| Logos o marcas | Solo si el dueño los sube y declara derechos | Igual que `own` |

Reglas adicionales:

- Un asset sin licencia registrada no puede publicarse: el linter lo marca como `IMAGE_LICENSE_MISSING` (error).
- El agente no busca imágenes en Internet ni las descarga por sí mismo.
- Las fotos de personas identificables de terceros requieren autorización escrita del dueño, guardada como asset con `license = consent-document`.
- Las imágenes se procesan con `sharp` (formato, tamaño y EXIF) según la sección 4.2 antes de entrar al sitio.
- Los vídeos se transcodifican en `workers` a H.264 720p o WebM, se eliminan sus metadatos y se genera una imagen de portada. Se cargan con `preload="none"` y sin reproducción automática.
- Las mismas reglas de origen y licencia de la tabla anterior aplican a los vídeos subidos.
- **Vídeos incrustados:** el dueño declara que tiene derecho a incrustar ese vídeo (propio o de un canal que lo permite). El agente no elige vídeos por sí mismo: el dueño pega el enlace o lo busca y lo confirma. La plataforma no descarga, transcodifica ni rehostea el vídeo de terceros; solo incrusta el reproductor del proveedor.
- El peso de una página se calcula sumando el HTML generado y todos sus assets **propios** referenciados (imágenes, vídeos subidos, portadas, fuentes y CSS). Los vídeos incrustados de plataformas externas no suman porque se sirven desde su origen. Si supera 20 MB, la publicación se bloquea con `PAGE_TOO_HEAVY` y el mensaje indica qué elemento ocupa más espacio.

### 9.2 Flujo de construcción del sitio (experiencia del dueño)

Tres caminos, todos válidos, todos dentro del mismo editor y con el mismo resultado: un borrador en `site-schema` que se previsualiza y se publica con las reglas de 4.3.

#### 9.2.1 Camino A · Elegir del catálogo

1. Entra al panel y ve el **catálogo de estilos activos** (7.7): familia, variante, vista previa y una muestra de tokens (paleta, tipografía, densidad).
2. Filtra por tipo de negocio, por familia o por lo que otros usuarios como él suelen elegir (ordenado por el vector de preferencia de 7.7.3).
3. Elige una entrada. El agente aplica sus tokens y propone una estructura de secciones acorde a su tipo de negocio.
4. Puede pedir variantes de esa misma entrada con las direcciones del vocabulario (`bolder`, `quieter`, `distill`, `typeset`…) sin salir de la vista previa.

**No hace falta escribir nada.** Es el camino más rápido y el que menos fricción tiene.

#### 9.2.2 Camino B · Describir con lenguaje natural

1. El dueño escribe lo que quiere: «una landing para una clínica dental en Valencia, con horarios, servicios y un formulario de cita; tonos claros y sensación de confianza».
2. El agente interpreta, elige la entrada del catálogo más cercana (por similitud con el vector de preferencia del usuario y el tipo de negocio) y construye el borrador con `plan_site` → `fill_page` → `attach_asset`.
3. El plan se le muestra **antes de construir** y él lo aprueba o lo ajusta (9.1, paso 4).
4. Puede corregir en cualquier momento hablando: «sube el titular», «quita la galería», «hazlo más sobrio».

El agente nunca inventa datos del negocio: si faltan horarios, teléfono o dirección, pregunta o deja el campo marcado y visible en el panel, no un texto inventado.

#### 9.2.3 Camino C · Partir de una referencia

El dueño señala una página que le gusta. Dos formas de darla:

- **Un enlace** a una página pública.
- **Una captura de pantalla** subida al panel.

**Qué hace el sistema con ella, en ambos casos:**

1. Se registra como **origen temporal** con `kind = reference`, ligado al dueño y no visible para nadie más. Caduca a los 30 días.
2. Se extraen **las mismas propiedades medibles del catálogo** (7.7.4): escala tipográfica, paleta en OKLCH, espaciado, radios, elevación, densidad y patrones de sección.
3. El agente **no copia la página**. Combina esos descriptores con una entrada del catálogo, de modo que el resultado sea del dueño y no un clon.
4. El dueño ajusta a partir de ahí por cualquiera de las dos vías de 9.2.4.

**Con un enlace:** pasa por el mismo pipeline que el crawler del catálogo, con las mismas garantías: `sandbox-web`, `egress-proxy`, sin IPs privadas, respetando `robots.txt` y leyendo solo CSS computado y DOM. No se descarga ni se conserva ninguna imagen de la página.

**Con una captura:** la imagen **no se usa para entrenar nada ni se envía a un modelo con la página entera**. Se procesa para extraer la paleta y las proporciones de la composición, y se descarta al terminar el borrador. Si la captura contiene personas identificables, se le advierte al dueño de que es responsable de tener derecho a usarla.

**Límites de la referencia, siempre aplicados:**

- Solo se extraen propiedades visuales. **Cero texto, cero imágenes y cero logotipos ajenos** pasan al sitio.
- Si la referencia es una galería o un sitio sin licencia que permita derivados, el sistema lo advierte y **aplica solo el ajuste de estilo**, no la composición literal.
- Si la referencia y el catálogo no encajan en ninguna combinación razonable, el agente lo dice y propone la entrada más cercana en lugar de forzar el parecido.

#### 9.2.4 Cambiar lo que no le gustó

Dos vías, siempre disponibles a la vez, y el dueño elige:

**Vía 1 · Hablar con el agente.** Pide un cambio con sus palabras o con una dirección del vocabulario: «más sobrio», «más llamativo», «quita lo que sobra», «arregla la tipografía», «reordena». El agente aplica el cambio sobre el borrador con las herramientas de 9.1 y vuelve a validar.

**Vía 2 · Editar a mano.** El editor visual (Puck) sobre el mismo `site-schema`, con las mismas restricciones: solo escribe en el borrador, control optimista por `draft_rev`, y todo cambio queda en `audit_log`.

En ambas vías:

- El cambio va **al borrador**, nunca directo a producción. Publicar sigue siendo un acto explícito.
- Se crea un **checkpoint** antes de cada aplicación del agente, así que se puede volver atrás.
- Los avisos del linter visual (6.5) se muestran y **no bloquean**: el dueño decide si publica igual.

#### 9.2.5 Lo que el dueño ve en cada paso

| Momento | Qué ve |
| --- | --- |
| Entrada | Catálogo con vistas previas y una caja para describir lo que quiere |
| Elección | Vista previa del borrador con el diseño aplicado, en escritorio y en móvil |
| Ajuste | Panel para hablar con el agente y editor para tocar a mano, en la misma pantalla |
| Publicación | Avisos del linter, la cuenta de páginas que se facturarán y el botón de publicar |
| Después | Estado del sitio, dominios, analítica básica y la opción de volver a cualquier versión |

### 9.3 Soporte

Responde preguntas del constructor con RAG filtrado por producto, usuario y sitio. Herramientas: `search_docs`, `get_user_plan`, `get_site_status`, `get_domain_status`, `create_ticket` y `escalate_to_human`. No puede modificar sitios ni datos salvo crear tickets.

### 9.4 SEO

El publicador genera determinísticamente sitemap, robots, canonical, Open Graph y metadatos base. El agente propone títulos, descripciones, alt text, jerarquía, JSON-LD de negocio local y enlaces rotos. Sus cambios van al borrador y requieren aprobación del dueño.

### 9.5 Programación

Solo corrige bugs de la plataforma. Un worker crea un entorno efímero con una copia del repositorio y entrega al sandbox un token temporal de alcance mínimo. El sandbox devuelve un parche y resultados de pruebas; el worker crea el Pull Request mediante una GitHub App limitada. No puede hacer merge, desplegar, leer secretos ni acceder a producción. Un humano aprueba y el despliegue pasa primero por staging.

### 9.6 Atención al cliente por sitio

Canales iniciales: chat web y Telegram; WhatsApp mediante OpenClaw queda condicionado a la prueba de concepto y al complemento opcional. Todos los adaptadores normalizan mensajes a `InboundMessage` y verifican firmas o autenticidad del proveedor.

Procesamiento: verificar e idempotentizar el mensaje, guardar y encolar, cargar conocimiento filtrado por `site_id`, decidir respuesta/herramienta/escalado, pasar por `sendReply` y registrar resultado.

El primer contacto de cada conversación pasa por un paso de consentimiento, **valor por defecto cerrado**:

1. Antes de guardar datos personales o crear el contacto, el agente envía un mensaje de bienvenida: que es un asistente virtual del negocio, un enlace a privacidad y términos, y la pregunta de aceptación («Para continuar, responde SÍ o acepta aquí»).
2. Sin aceptación, el agente responde solo con información general pública del sitio y no guarda nombre, teléfono ni mensajes personales.
3. Con aceptación, se crea `consents` (`purpose = attention`, `evidence_text_version` y `evidence_message_id`) y se crea o actualiza el `contacts`.
4. El consentimiento de seguimiento o mercadeo es un paso aparte y opcional, nunca se pide junto con el de atención.
5. Si el abogado relaja este paso, cambia el valor en la configuración de la plataforma y se registra como ADR; el código no cambia.

**Herramientas del agente de atención** (todas validadas con Zod y acotadas al `site_id` de la conversación):

| Herramienta | Qué hace | Restricción |
| --- | --- | --- |
| `search_knowledge` | Busca en `knowledge_items` del sitio (RAG) | Solo ese sitio; devuelve fuente y fragmento |
| `get_site_info` | Lee datos públicos del sitio publicado (horarios, dirección, servicios) | Solo lectura, de la versión publicada |
| `upsert_contact` | Crea o actualiza `contacts` | Requiere `consents` de atención vigente |
| `create_lead` | Crea `leads` (`contact`, `quote` o `appointment`) | Requiere `consent_id`; no crea leads sin aceptación |
| `escalate_to_human` | Crea `escalations` y pausa la conversación para el dueño | Siempre disponible |
| `notify_owner` | Envía el aviso al dueño por WhatsApp (9.6) con uno de los motivos permitidos | Máximo un aviso cada 15 minutos por dueño; resto agrupado |
| `send_reply` (`sendReply`) | Envía la respuesta al canal | Única vía de salida; ver reglas abajo |

**Trato humano y personalidad.** Configurables en `agent_settings`:

- **Persona por defecto:** cordial, breve y clara, en el idioma de la interfaz del dueño (`es` o `en`), tratando de «usted» en español y de forma neutra en inglés, sin emojis y sin nombre propio del agente. El dueño puede cambiar tono (`formal`, `cercano`) y nombre visible, pero no las reglas de honestidad de la sección 9.5.
- **Mensajes cortos:** un máximo de 3 frases por mensaje. Si la respuesta es larga, se divide en dos mensajes con una pausa natural de 2 segundos (el envío sigue siendo una sola respuesta lógica para la puerta de solo respuesta).
- **Horario:** fuera de `hours` el agente lo indica y registra la consulta para respuesta humana posterior.
- **Memoria:** el agente conserva el nombre y las preferencias que el contacto declara, durante la retención de `contacts` (14.1). No guarda datos sensibles ni inferidos. Al revisar una conversación recupera el resumen de las últimas 20 interacciones o 90 días, lo que ocurra antes.

**Pausa por mensaje manual del dueño.** Si el dueño escribe a un contacto desde el canal real (panel, app de WhatsApp de OpenClaw o chat de Telegram del negocio), el agente deja de responder esa conversación:

- La conversación pasa a `human` y el agente queda pausado durante 2 horas sin actividad, renovables por cada mensaje del dueño.
- Detección: en el panel, por `role = owner`; en OpenClaw, por mensajes salientes que la plataforma no originó (eco `fromMe`); en Telegram, por mensajes del operador en el chat vinculado al bot.
- El dueño puede pulsar «Devolver al agente» en cualquier momento. Sin esa acción, el agente vuelve automáticamente al terminar la pausa.

**Escalado y tiempos** (valores en 14.1):

- Se escala ante petición de humano, baja confianza, queja grave, asunto legal o sensible, pagos, descuentos, datos no disponibles o bucles.
- Al escalar, el agente avisa al cliente que el negocio responderá y no promete plazos que no conoce.
- El dueño recibe el aviso al momento. Si no responde en 15 minutos, se envía un recordatorio por el segundo canal disponible.
- Si pasan 60 minutos sin respuesta, el agente informa al cliente que el equipo responderá y mantiene la conversación en `waiting_owner`. Tras 24 horas sin atención, la conversación queda marcada como pendiente en el panel y no se devuelve al agente sin aprobación.

`sendReply(conversationId, content)` deduce el destinatario de la conversación. Solo permite responder dentro de la ventana configurada tras un mensaje entrante, si no existe baja, y dentro de límites por conversación, contacto, sitio y día (14.1). No existen envíos arbitrarios, campañas, grupos ni mensajes programados.

Las lecciones se proponen, editan y aprueban por el dueño antes de entrar al conocimiento. WhatsApp mediante OpenClaw implica riesgo de bloqueo: se registra la aceptación del cliente, se recomienda número dedicado y se desactivan herramientas de ejecución, difusión y envío arbitrario en OpenClaw.

### 9.7 Avisos al dueño por WhatsApp

Decisión: se mantiene OpenClaw también para avisos. El número de la plataforma envía avisos, pero solo bajo estas reglas:

- **Solo al número del dueño verificado** por el mismo número, mediante un código enviado desde el panel. Sin verificación no hay avisos.
- **Cuándo se envía:** solo cuando el agente de atención llama a la herramienta `notify_owner` con uno de estos motivos: `needs_more_info` (el visitante pide más información que el agente no puede dar con fiabilidad), `requests_contact` (el visitante pide que lo contacten) o `escalation` (escalado según 9.5). El sistema no envía avisos por WhatsApp en otros casos.
- **Recordatorio:** si el dueño no responde en 15 minutos a un aviso, se reenvía el recordatorio por el canal de respaldo (9.5, escalado).
- **Alertas operativas** (sitio suspendido, dominio en error, número de avisos desconectado): panel, correo y Web Push, no WhatsApp.
- **Contenido mínimo:** nombre parcial del contacto, motivo y un enlace al panel. Ningún dato personal completo viaja por WhatsApp.
- **Agrupación:** un máximo de un aviso cada 15 minutos por dueño; los demás se agrupan en un resumen.
- **Canales de respaldo:** panel, correo, Telegram y Web Push. Si WhatsApp falla, el aviso sigue por esos canales. Ningún aviso depende solo de WhatsApp.
- **Sin mensajes proactivos a clientes finales:** el número de la plataforma nunca escribe a los visitantes; solo avisa al dueño.
- **Riesgo y monitoreo:** el número de avisos es un punto único de fallo y de bloqueo. Se monitorean entregas, se alerta si el número se desconecta y el procedimiento de reconexión por QR está en `docs/runbooks/`. La decisión de usar OpenClaw queda registrada como ADR con el riesgo aceptado.

## 10. Seguridad consolidada

### 10.1 Política de contenido prohibido

Categorías prohibidas, sin excepciones: **odio y discriminación**, **acoso**, **pornografía y contenido sexual explícito**, **pedofilia y explotación infantil (CSAM)**, **violencia gráfica**, **actividades ilegales**, **drogas**, **armas**, **juego con apuestas no autorizado**, **fraude y phishing**, **malware** y **suplantación de marcas o instituciones**.

Momentos de control:

1. **Al publicar:** el job `publish` envía el documento a la revisión automática antes de generar el release. Se analizan textos e imágenes con el clasificador del proveedor de moderación y con una lista propia de términos y marcas. Si la categoría es `blocked`, la publicación se rechaza con un mensaje claro y se registra en `content_reviews`.
2. **Detección de CSAM:** obligatoria y de máxima prioridad. Un positivo bloquea la cuenta de inmediato, preserva la evidencia, no se muestra al dueño y se aplica el protocolo legal de `docs/runbooks/content-csam.md` con reporte a la autoridad competente y al proveedor. Nunca se procesa ni se muestra ese contenido en el panel.
3. **Revisión periódica:** un trabajo de `moderation` re-escanea los sitios publicados (por defecto semanal, y siempre que cambien las reglas).
4. **Denuncias:** `abuse_reports` crea una revisión con prioridad y estado `human_review`.
5. **Acción automática:** un `blocked` confirmado suspende el sitio, retira los enlaces de `/data/hosts/`, purga la caché de Cloudflare y bloquea la cuenta si el contenido es CSAM o fraude repetido.
6. **Revisión humana:** el operador ve categoría, fragmento señalado y decisión anterior. Toda decisión queda en `audit_log`.
7. **Falsos positivos:** el dueño puede apelar; el sitio queda `human_review` y no se suspende hasta que un operador decida.
8. **Límite honesto:** ningún clasificador es perfecto. Por eso existen además la denuncia, la suspensión rápida y la revisión humana; la política no promete detección total automática.

**Imágenes y vídeos de terceros (responsabilidad del dueño):**

- **Sin pasos extra al subir.** El dueño sube la imagen como en cualquier aplicación: sin formularios, casillas ni confirmaciones por archivo.
- **Entrenamiento y mejora global:** los términos aceptados al contratar incluyen que el material del cliente se usa para su propio diseño y, agregado y anonimizado, para mejorar las plantillas globales. Sin esa aceptación, su material no entra al modelo global. No hay casillas por acción.
- **Reseñas:** el canal de valoraciones acepta reseñas que el cliente envía; se moderan automáticamente contra groserías y acoso antes de publicar. Se publican solo las aprobadas, en rotación de 20 en 20. La aceptación de publicar la reseña va en los términos del contrato, sin casilla adicional.
- **Responsabilidad una sola vez, en los términos.** Al crear la cuenta se acepta la cláusula de que el dueño tiene derecho a usar el material que sube. Se guarda como cualquier aceptación de términos (`consents`, con versión del texto y fecha). No se repite por archivo.
- **La plataforma no verifica la titularidad.** No hay comparación de autoría ni búsqueda inversa. El titular de una imagen reclama por el canal de abajo, no el cliente.
- **Canal de denuncia del titular.** Formulario público de reclamación de derechos de autor y de uso de imagen. Al recibirla, el asset se marca `withdrawn_by_claim`, sale del sitio y de todas las releases en el siguiente publicado y se notifica al dueño. El titular no tiene que demostrar nada para que se retire mientras la reclamación esté en revisión.
- **Vocabulario y amenazas:** clasificador de texto sobre el contenido del sitio, en las mismas categorías de esta sección (acoso, odio, amenazas). Se ejecuta al publicar y en el re-escaneo periódico, con el flujo de aviso, revisión humana y suspensión de las reglas 1 a 8.

**Operación de la moderación (lo que faltaba):**

- **Se escanea al subir y al publicar.** Todo asset subido (imagen o vídeo) pasa por el mismo clasificador en el momento de la subida, antes de entrar al sitio, y se vuelve a escanear al publicar y en el re-escaneo periódico. Un asset bloqueado no llega nunca al `release`.
- **Proveedor por definir, decisión abierta de la Fase 2c.** No se nombra uno en este documento porque no está elegido. Requisitos mínimos del candidato: clasificación de las diez categorías prohibidas, detección de CSAM por coincidencia de hash, API con webhook, retención cero de nuestro contenido, y contrato de tratamiento de datos. Se elige tras una prueba con casos reales, igual que el proveedor de cobros.
- **Detección de CSAM por hash:** el requisito es coincidencia contra una base de hashes de material conocido. Hay que **verificar con Cloudflare** si su producto de detección por hash está disponible sin coste para estos sitios antes de contar con él; hasta entonces se trata como no disponible y la detección descansa en el proveedor elegido.
- **Reporte por jurisdicción** (destinos a confirmar por asesoría legal antes de operar en cada país): el protocolo `docs/runbooks/content-csam.md` fija la autoridad competente y el canal para cada jurisdicción con clientes:
  - **Colombia:** Policía Nacional (Centro Cibernético Policial) y Fiscalía General de la Nación. **Pendiente de confirmación legal.**
  - **Estados Unidos:** NCMEC, vía el reporte obligatorio de proveedor de servicios.
  - **Unión Europea:** el punto de contacto nacional del país del cliente y el mecanismo de reporte que corresponda.
  - Si la jurisdicción del cliente no está en la lista, se reporta a la autoridad local competente y a NCMEC.
- **Ningún reporte se automatiza a ciegas:** la evidencia se preserva, se registra en `audit_log` y el envío a la autoridad lo confirma un operador, salvo el caso de CSAM, donde el protocolo exige reporte dentro de la hora.
- **Vídeos propios:** además del escaneo del asset completo, se analizan fotogramas muestreados (primer fotograma, el central y cada 10 segundos) porque el clasificador de imagen no ve el vídeo como tal. Un vídeo que falla no se publica y el motivo se muestra al dueño sin detalle gráfico.

- **Multi-tenancy:** RLS forzada, `site_id` y `owner_id`, pruebas de acceso cruzado por API, consultas y trabajos.
- **Autenticación:** correo verificado, sesiones rotatorias, cookies seguras, protección CSRF, rate limiting, MFA opcional para dueños y obligatorio para operadores.
- **Autorización:** permisos por sitio y scope mínimo; el servidor decide, nunca el modelo.
- **Contenido:** sin HTML ni JavaScript de usuario; markdown limitado y escapado; URLs con allowlist de esquemas; CSP estricta.
- **Disco:** UUID y asset IDs, `realpath`, rechazo de traversal, symlinks no autorizados, límites de tamaño y píxeles, MIME por contenido.
- **Red:** Traefik/Cloudflare como borde, firewall de IPs Cloudflare, Authenticated Origin Pulls, redes internas separadas y egress proxy.
- **SSRF:** bloqueo de IPs privadas, loopback, link-local y metadatos antes de resolver y durante redirecciones; sin cookies ni sesiones en scraper.
- **Agentes:** sin acceso directo a DB, disco o secretos; tokens temporales, presupuestos, auditoría y revocación.
- **Webhooks:** firma, timestamp, idempotencia por proveedor, límites de tamaño y rechazo de reintentos fuera de ventana.
- **Canales:** cifrado en reposo, secretos separados, puerta de solo respuesta, baja inmediata y rate limiting.
- **Publicación:** validación de esquema, linter bloqueante, releases inmutables, swap atómico, rollback y purga de caché.
- **Abuso:** denuncia, análisis básico de phishing, suspensión rápida, retirada de hostnames y preservación de auditoría.
- **Privacidad:** minimización, retención configurable, exportación y borrado por contacto, política de privacidad y revisión jurídica.
- **Cadena de suministro:** lockfile, versiones fijadas, revisión de licencias, Renovate/Dependabot, análisis SCA y CI reproducible.
- **Observabilidad:** logs estructurados sin secretos, métricas, alertas, Sentry y trazas con datos sensibles redactados.

## 11. Estructura del monorepo

```text
platform/
├── apps/
│   ├── platform/
│   ├── workers/
│   ├── internal-api/
│   ├── llm-gateway/
│   ├── sandbox-web/
│   └── sandbox-code/
├── agents/
│   ├── design/
│   ├── support/
│   ├── seo/
│   ├── code/
│   └── site-customer/
├── packages/
│   ├── site-schema/
│   ├── renderer/
│   ├── ui-components/
│   ├── agent-sdk/
│   ├── channels/
│   ├── storage/
│   ├── llm/
│   ├── db/
│   ├── auth/
│   └── security/
├── infra/
│   ├── compose/
│   ├── traefik/
│   ├── caddy/
│   ├── egress-proxy/
│   └── backup/
├── docs/
│   ├── adr/
│   ├── runbooks/
│   └── phases/
└── pnpm-workspace.yaml
```

pnpm y Turborepo gestionan paquetes, builds, tipos, lint y pruebas. Cada aplicación tiene Dockerfile propio y no comparte secretos por defecto.

**Mapa servicio → contenedor de Coolify.** Todos salen del mismo repositorio y la rama `main`; el *base directory* es siempre la raíz (`/`), porque el build de pnpm necesita el monorepo completo; lo que cambia es la ruta del Dockerfile. Los *watch paths* hacen que cada contenedor se reconstruya solo cuando cambian sus archivos o los paquetes de `packages/` que usa.

| Servicio (3.1) | Tipo en Coolify | Base directory | Dockerfile | Watch paths (además de `packages/*` que use) |
| --- | --- | --- | --- | --- |
| `platform` | Application | `/` (raíz del monorepo) | `apps/platform/Dockerfile` | `apps/platform/**` |
| `internal-api` | Application | `/` (raíz del monorepo) | `apps/internal-api/Dockerfile` | `apps/internal-api/**` |
| `workers` | Application | `/` (raíz del monorepo) | `apps/workers/Dockerfile` | `apps/workers/**`, `agents/**` |
| `llm-gateway` | Application | `/` (raíz del monorepo) | `apps/llm-gateway/Dockerfile` | `apps/llm-gateway/**` |
| `caddy` | Application | `/` (raíz del monorepo) | `infra/caddy/Dockerfile` | `infra/caddy/**` |
| `egress-proxy` | Application | `/` (raíz del monorepo) | `infra/egress-proxy/Dockerfile` | `infra/egress-proxy/**` |
| `sandbox-web` | Application | `/` (raíz del monorepo) | `apps/sandbox-web/Dockerfile` | `apps/sandbox-web/**` |
| `sandbox-code` | Application | `/` (raíz del monorepo) | `apps/sandbox-code/Dockerfile` | `apps/sandbox-code/**` |
| `postgres` | Database (imagen oficial con pgvector) | — | — | — |
| `redis` | Database (imagen oficial) | — | — | — |

- **`platform` y `internal-api`** comparten código de `packages/` pero tienen Dockerfile y contenedor propios: así la red de un sandbox nunca alcanza la API completa (3.1).
- **`sandbox-code-jobs`** no aparece en Coolify como servicio: lo crea `workers` por incidente con la imagen de `sandbox-code`.
- **Ramas:** `main` es producción y `staging` es el entorno previo. Cada contenedor de Coolify tiene su entorno y su rama de despliegue.

## 12. Infraestructura y despliegue

Staging y producción están separados. Coolify despliega desde GitHub con healthchecks, migraciones explícitas y rollback. Ningún despliegue ejecuta migraciones destructivas automáticamente.

**Flujo de promoción (cerrado):**

1. Un cambio entra por Pull Request a `staging`. CI corre tipos, lint, pruebas y migraciones en base efímera.
2. Coolify despliega `staging` automáticamente tras pasar CI. Las migraciones se aplican primero y el despliegue sigue solo si el *healthcheck* responde.
3. Un humano aprueba la promoción a `main` con un Pull Request de `staging` a `main`. Ese merge es el único camino a producción.
4. Coolify despliega `main` solo cuando el merge llega, con el mismo orden: migraciones, *healthcheck* y rollback automático si falla.
5. Rollback: volver a desplegar la imagen de la versión anterior; las migraciones son hacia adelante, así que una migración destructiva exige plan aparte (no se ejecuta automáticamente).

Un contenedor no se despliega a mano desde Coolify fuera de este flujo, salvo rollback de emergencia registrado en `audit_log`.

Requisitos del compose: redes descritas en §3.2; volúmenes separados para Postgres, Caddy y sitios; límites de CPU/RAM; `restart: unless-stopped`; healthchecks; Redis con autenticación, AOF y `maxmemory-policy noeviction`; Postgres sin puerto público; Caddy sin acceso a `/caddy-data` desde la ruta de sitios; secretos mediante variables protegidas de Coolify.

`platform` recibe `DATABASE_URL` con su rol, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, rutas de solo lectura y configuración de dominios. `workers` recibe su rol, acceso de escritura a sitios y tokens DNS limitados. `llm-gateway` recibe únicamente claves de modelos. `sandbox` e instancias OpenClaw no reciben claves reales.

Backups: Postgres con restauración probada y `/data/sites` con restic o rclone cifrado a destino externo. Se prueba restauración al menos en cada cambio de infraestructura y trimestralmente. Alertas al 80 % de disco, fallos de backup, divergencia de releases, certificados y colas atascadas.

## 13. Fases de construcción

Cada fase entrega código, migraciones, pruebas, README, evidencias de aceptación, riesgos y pendientes.

### Fase 0 · Fundamentos

Monorepo, CI, TypeScript estricto, compose local, `site-schema`, `storage`, `db`, auth base, paquetes de seguridad e **i18n con `es` y `en`** (catálogos de mensajes, selector de idioma por cuenta y verificación en CI de que ambos catálogos tienen las mismas claves).

**Aceptación:** CI pasa; stack local levanta con un comando; pruebas de validación, RLS básica y traversal pasan; CI falla si una clave existe en un idioma y no en el otro.

### Fase 1 · Núcleo del sitio

Schema completo, migraciones, renderer, componentes, adaptador Puck, editor, preview aislada, releases, rollback, linter estático y almacenamiento.

**Aceptación:** crear, editar, previsualizar, publicar y revertir; HTML válido, CSP, accesibilidad crítica y prueba de carga básica; tipo desconocido rechazado.

### Fase 2 · Multiusuario y hosting

Usuarios, miembros, RLS, cuotas, Redis/BullMQ, Caddy detrás de Traefik, Cloudflare, pool de dominios, formularios `/_f/lead`, antispam y avisos al panel. **Dos paneles mínimos:** operador (clientes y estado de sitios) y dueño (su sitio publicado, sus borradores y su plan contratado).

**Aceptación:** dos usuarios no pueden verse; una cuenta puede tener varios borradores pero solo un sitio `active` (el índice lo impide); dos sitios de cuentas distintas se sirven correctamente; host no registrado devuelve respuesta uniforme; cuota excedida se rechaza; backup se restaura; formulario llega al panel.

### Fase 2b · Suscripciones, pagos y créditos

Proveedor de cobros, cobro por página sin tope de páginas, webhooks idempotentes, `invoices`, recibo por correo, **prueba de 7 días desde la creación de la cuenta sin gracia posterior**, **gracia de 4 días en línea sin suspensión para cuentas con plan suscrito cuando falla la renovación**, **paso a `dark` y borrado total al cumplirse `delete_after`**, `ai_credit_ledger` y reglas de publicación: subdominio del pool en `trial` o `active`; dominio propio solo con `active`.

**Aceptación:** una cuenta recién creada publica en subdominio durante 7 días; **el día 8 pasa a `dark` y se liberan sus hostnames sin pasar por gracia**, haya publicado o no; esa cuenta nunca tiene `grace_until`; una cuenta con plan activo cuyo cobro falla entra en `grace` con 4 días y el sitio sigue en línea, incluido el dominio propio, sin suspensión; al día 5 pasa a `dark` y el dominio responde igual que un host inexistente, sin página de aviso; al cumplirse `delete_after` se borran releases, assets, versiones y borradores; los plazos se cuentan desde la creación de la cuenta y no se reinician al publicar ni al borrar un sitio; un sitio con 40 páginas publica sin aviso de límite mientras cada página quepa en 20 MB; los webhooks repetidos no duplican estado ni facturas; el importe facturado corresponde al número de páginas publicadas.

### Fase 2c · Política de contenido

Revisión automática al publicar, re-escaneo periódico, denuncias, cola de revisión humana, protocolo CSAM, suspensión y purga de caché.

**Aceptación:** un sitio con contenido prohibido se bloquea al publicar y no genera release; una denuncia cambia el estado a `human_review`; una suspensión por contenido desaparece de la red en menos de un minuto; toda decisión queda auditada.

### Fase 3 · Dominios propios

Cloudflare for SaaS, verificación TXT, instrucciones DNS, estados, job de verificación, TLS, redirecciones y limpieza segura.

**Aceptación:** hostname propio verificado obtiene HTTPS y sirve el sitio; hostname no verificado no se activa; dominio liberado no puede reasignarse sin nueva verificación.

### Fase 4 · Agente de diseño rápido

SDK, gateway LLM, presupuestos, auditoría, catálogo inicial, herramientas, checkpoints, linter de esquema (6.4) y linter visual sobre el HTML del release (6.5).

**Aceptación:** conjunto de briefs genera borradores válidos; no publica; no inventa datos prohibidos; mutaciones quedan auditadas; el presupuesto se respeta; **cuando el dueño pide un cambio y el linter visual emite un `error` de 6.5, el cambio se aplica igualmente y solo se le avisa**.

### Fase 5 · Sandbox web y revisión visual

Proxy de salida, Playwright, scraper, SSRF, capturas y revisión visual.

**Aceptación:** se bloquean IPs privadas, metadatos y redirecciones peligrosas; sandbox no llega a DB, Redis, disco ni API general; referencia produce estructura propia sin copiar contenido.

### Fase 5b · Biblioteca de estilos dinámica (7.7)

Jobs `catalog-discover`, `catalog-crawler` y `catalog-generate-variants`, tablas de 7.7.6 y 7.7.8, descubrimiento automático de páginas y orígenes con verificación de licencia por código, generación de 3–5 variantes automáticas, validación determinista, activación automática, aprendizaje y verificación de originalidad. **Sin pantalla de aprobación y sin alta manual de orígenes.**

**Aceptación:** el crawl respeta `robots.txt` y no descarga assets; **un ciclo mensual completo se ejecuta sin ninguna intervención humana**: descubre páginas nuevas en los orígenes conocidos, incorpora orígenes nuevos con licencia verificada y deja las variantes válidas `active`; un origen cuya licencia no coincide con `license_allowlist` se descarta con `license_unverified`; un origen que cambie de licencia pasa a `paused`; las variantes sin reglas responsive no se generan; una variante a más de 0,75 de similitud con su base se descarta con motivo; no existe ninguna ruta ni trabajo que requiera aprobación para activar una entrada; `recommend_design_system` ordena por similitud con el vector del usuario; ningún fichero del catálogo contiene HTML ni texto de la fuente.

### Fase 6 · SEO

Auditoría, SEO local, JSON-LD, sugerencias y aplicación al borrador.

**Aceptación:** informe verificable en sitios de prueba, sin romper schema ni CSP.

### Fase 7 · Soporte

RAG documental, chat, tickets, escalado y evaluación de respuestas.

**Aceptación:** preguntas conocidas se responden con fuente; desconocidas escalan con contexto; no hay filtración entre sitios.

### Fase 8 · Atención web y Telegram

Gateway unificado, widget propio, grammY, conocimiento, escalado, panel, cuotas y rate limiting.

**Aceptación:** responde datos reales, no inventa, registra consentimiento, escala correctamente, el dueño toma control y lo devuelve.

### Fase 9 · WhatsApp y lecciones

Prueba de concepto de OpenClaw, aprovisionamiento aislado, QR, controles, aceptación de riesgo, puerta de solo respuesta, aprendizaje curado y borrado.

**Aceptación:** no existe ruta de envío arbitrario; mensaje entrante se procesa idempotentemente; lección aprobada mejora un caso sin degradar evaluación; desconectar instancia revoca sus tokens.

### Fase 10 · Agente de programación

Sandbox de código separado, parches, GitHub App, PR, CI y staging.

**Aceptación:** un bug reproducible genera PR con pruebas; el agente no puede hacer merge, desplegar ni leer secretos.

### Fase 11 · Operación y escala

Métricas, capacidad, rollout, migraciones, incidentes, exportación, retención y opción futura de S3/MinIO o varios servidores.

**Aceptación:** procedimientos de incidente y restauración documentados y probados; no se escala infraestructura sin métricas de uso y coste.

## 14. Parámetros operativos y decisiones abiertas

### 14.1 Parámetros operativos (valores por defecto, revisables con datos reales)

| Parámetro | Valor por defecto |
| --- | --- |
| Periodo de prueba | **7 días desde la creación de la cuenta**, publique o no. Solo subdominio del pool, sin dominio propio |
| Al terminar la prueba sin pago | **Sin gracia.** Paso a `dark`, liberación de hostnames y conservación del contenido 30 días desde el fin de la prueba |
| Días de gracia (solo con plan ya suscrito) | **4 días** cuando falla el cobro de renovación. El sitio sigue en línea, incluido el dominio propio, **sin suspender** |
| Al terminar la gracia sin pago | El sitio pasa a `dark` y **deja de mostrar cualquier contenido**: misma respuesta que un host inexistente, sin página de aviso |
| Conservación de datos tras impago | **30 días desde el ancla**: último pago confirmado, o fin de la prueba si la cuenta nunca pagó |
| Borrado total | Al cumplirse los 30 días: `/data/sites/<siteId>`, `site_versions`, `site_drafts`, `draft_checkpoints`, `assets` y datos del complemento de atención |
| Recuperación tras pagar en `dark` | Se vuelve a enlazar `public` con la última versión conservada y se purga la caché |
| Cobro por página | Cada página de la versión publicada cuenta como una unidad facturable; el recuento se congela al generar el release |
| Páginas por sitio | **Sin límite**. Solo aplica el límite de 20 MB por página |
| Precio por página | Configurable fuera del código (tabla de precios versionada); no se codifican importes |
| Reintentos de cobro | 3 reintentos dentro de los 4 días de gracia (día 1, 2 y 4). Si el último falla, el sitio pasa a `dark` |
| Publicación en dominio propio | Solo con suscripción `active` |
| Re-escaneo de contenido | Semanal por defecto; inmediato al cambiar las reglas |
| Cola de revisión humana | Respuesta objetivo 24 horas; CSAM en 1 hora |
| Tiempo en `suspended` antes de `deleted` (solo por abuso o contenido prohibido, no por impago) | 60 días con datos conservados; después 30 días más (`deleted`) y luego borrado |
| Secciones por página | 15 |
| Imágenes y vídeos por sitio | 40 imágenes y 6 vídeos |
| Peso máximo por página (HTML, imágenes, vídeos y texto) | 20 MB |
| Vídeos **subidos** por página | 2, cada uno de hasta **8 MB**, en H.264 720p o WebM; con imagen de portada incluida en el límite de página |
| Vídeos **incrustados** por página | Sin límite de cantidad (YouTube `youtube-nocookie.com`, Vimeo). No consumen disco ni cuentan para el límite de 20 MB |
| Peso total de assets por sitio | 200 MB |
| Peso máximo por imagen | 5 MB (tras procesado con `sharp`); se recomienda WebP o AVIF |
| Píxeles máximos por imagen | 25 megapíxeles |
| Retención de contactos sin interacción | 24 meses |
| Retención de conversaciones y mensajes | 12 meses |
| Retención de leads | 24 meses |
| Retención de `agent_runs` y `agent_tool_calls` | 90 días (metadatos y hashes); 12 meses para `usage_events` |
| Retención de `audit_log` | 3 años (revisar con asesor legal) |
| Escalado: recordatorio al dueño | A los 15 minutos sin respuesta |
| Escalado: aviso al cliente de espera | A los 60 minutos |
| Escalado: conversación pendiente | Tras 24 horas sin atención humana |
| Pausa del agente tras mensaje manual del dueño | 2 horas, renovables |
| Ventana de respuesta de `sendReply` | 24 horas desde el último mensaje entrante |
| Límite de respuestas por conversación | 30 por hora |
| Límite de respuestas por sitio | 200 por día |
| Mensajes de atención por contacto | 20 por día |
| Aviso al dueño por WhatsApp | 1 cada 15 minutos (resto agrupado) |
| Envíos de formulario por IP y sitio | 5 por hora |
| Presupuesto por ejecución de diseño rápido | 1 ronda y tope de tokens definido en la fase 4 |
| Créditos de IA por usuario y mes | 50 créditos, 1 crédito por ejecución de diseño rápido (registrado en `ai_credit_ledger`); se recargan al renovar la suscripción |
| Caducidad del enlace de vista previa | 15 minutos |
| Caducidad del TXT de propiedad de dominio | 7 días; verificación reintentada cada 48 horas |
| Espera antes de reasignar un hostname liberado | 90 días |
| Dominios de sitios por dominio del pool | 180 |
| Releases conservados por sitio | 20 |
| Backups de base de datos y sitios | Diarios, retención 30 días, restauración probada trimestralmente |

### 14.2 Decisiones abiertas

| Tema | Valor por defecto |
| --- | --- |
| Proveedor de cobros | **Valor por defecto:** ninguno en producción hasta la Fase 2b. Criterio: medios de pago del país objetivo, recurrencia con cantidad variable por página y recibo por correo |
| Proveedor de correo | **Valor por defecto:** el primero que cumpla SPF, DKIM, DMARC, API y retención configurable |
| Soporte y atención LLM | **Valor por defecto:** Haiku 5.5 hasta que la comparación con GPT-6 Luna demuestre lo contrario |
| Telegram | grammY propio en `platform`/`workers`; OpenClaw solo para WhatsApp |
| Cloudflare | Proxy, Origin CA/Full strict, Authenticated Origin Pulls y Cloudflare for SaaS |
| Pool DNS | Registro comodín proxied por dominio, con límite operativo y separación por abuso |
| Bandeja | **Valor por defecto:** panel propio. Chatwoot solo tras una PoC aislada |
| Embeddings | **Valor por defecto:** modelo fijado en la Fase 7, con la dimensión en una migración de índice |
| Retención | Mínima necesaria; 30 días para sitios borrados y políticas configurables por dato. **La contabilidad y las evidencias legales se conservan aparte del borrado de contenido**, por el plazo que exija la ley |
| Proveedor de moderación | **Valor por defecto:** ninguno en producción hasta la Fase 2c. Mientras tanto, todo asset se marca `human_review` antes de publicar. Requisitos en 10.1 |
| Detección de CSAM por hash | **Valor por defecto:** se asume no disponible sin coste hasta verificarlo. Si no hay proveedor con hash, la publicación de imágenes queda bloqueada en `human_review` |
| Jurisdicciones de reporte de CSAM | **Valor por defecto:** operar solo en las jurisdicciones con canal confirmado. Si el cliente está en otra, se reporta a NCMEC y se bloquea la cuenta hasta confirmar (10.1) |
| Dictamen legal del catálogo | **Valor por defecto:** la Fase 5b no se activa en producción. Sin dictamen, el catálogo queda en staging (7.7.9.C) |
| Analítica | **Valor por defecto:** logs agregados sin cookies |
| Textos legales | **Valor por defecto:** formularios, canales y consentimiento desactivados hasta revisión profesional |
| OpenClaw | Transporte únicamente; nuestro agente, conocimiento y `sendReply` permanecen bajo control de la plataforma |

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Aislamiento multiusuario defectuoso | RLS forzada, scopes, pruebas negativas y revisión de cada endpoint |
| Exposición de certificados o archivos | `/caddy-data` separado, validación de host, Caddy sin DB ni secretos |
| SSRF o sandbox comprometido | Sandboxes separados, egress proxy, listas de red y pruebas de rebinding |
| Secuestro de dominio | TXT obligatorio, Cloudflare for SaaS, espera de reasignación y limpieza |
| Publicación de contenido prohibido | Revisión automática al publicar, re-escaneo semanal, denuncias, suspensión en menos de un minuto y protocolo CSAM |
| Cuenta de prueba que no paga | Fin de la prueba a los 7 días y paso a `dark` sin gracia; recordatorios al dueño en los días 3, 5 y 7 |
| Impago en cuenta con plan suscrito | 4 días de gracia con el sitio en línea y sin suspender, reintentos día 1/2/4, paso a `dark`, liberación de hostnames y borrado total al cumplirse `delete_after` (30 días desde el último pago o desde el fin de la prueba) |
| Borrado accidental de un sitio en `dark` | `delete_after` se calcula una sola vez, hay aviso al dueño en los días 7, 20 y 27 y la operación de borrado es un trabajo dedicado con auditoría previa |
| Sitio con muchas páginas que dispara el coste | No hay tope de páginas; el coste se controla por el peso de 20 MB por página y por el cobro por página publicada |
| Facturación incorrecta por cambio de páginas | El recuento se congela al generar el release y se audita en `usage_events` |
| Coste LLM descontrolado | Presupuesto por ejecución, límites de uso por usuario, rate limiting y registro de uso |
| Publicación parcial | Release autocontenido, swap atómico, transacción, reconciliación y rollback |
| Caché de sitio suspendido | Purga obligatoria y prueba de suspensión |
| Prompt injection | Datos no confiables, herramientas con schemas y servidor como autoridad |
| Phishing/spam | Publicación condicionada, denuncia, escaneo básico y suspensión rápida |
| Bloqueo de WhatsApp | Número dedicado, solo respuestas entrantes, límites, aceptación y canales alternos |
| Pérdida de datos | Backups externos, pruebas de restauración y reconciliación |
| Catálogo alimentado con material sin licencia | Solo fuentes de 7.7.1, licencia verificada por código contra `license_allowlist`, `license_evidence` guardada y origen `paused` si la licencia desaparece |
| Sitio generado clonando una fuente | Variantes con reglas deterministas que se separan de la base (similitud ≤ 0,75), tokens en lugar de HTML y verificación de originalidad (7.7.7) |
| Entrada defectuosa activada sin revisión humana | Validación determinista antes de activar, registro con motivo, marcado `deprecated` a posteriori y `DESIGN_TOO_CLOSE_TO_SOURCE` como red final |
| Reglas externas atadas a un tercero | Portadas y propias en `packages/lint-visual`, con atribución y sin CLI ni telemetría de terceros |
| Dependencias vulnerables | Lockfile, SCA, actualizaciones y revisión de licencias |
| Exceso de alcance | MVP hasta Fase 4; cada fase posterior requiere métricas y aceptación |

## 16. Prompt de arranque para el constructor

```text
Eres el constructor principal de este proyecto. Lee completa la especificación v1.2 antes de escribir código.

1. Resume en 10 líneas qué vas a construir.
2. Enumera las decisiones abiertas de la sección 14 y el valor por defecto que usarás.
3. Señala contradicciones, riesgos y dependencias que deban resolverse en la fase actual.
4. Empieza por la Fase 0 y avanza en orden. No declares una fase terminada sin evidencias frente a sus criterios de aceptación.
5. Usa TypeScript estricto, pruebas significativas y CI desde el primer cambio.
6. Ningún agente recibe acceso directo a DB, disco o secretos. Usa herramientas, scopes y tokens temporales.
7. Mantén el aislamiento de dominios, redes, usuarios y sitios como requisito bloqueante.
8. Antes de publicar cualquier sitio valida schema, seguridad, linter, peso de página, estado de la suscripción y revisión de contenido prohibido.
9. Al terminar cada fase entrega archivos modificados, migraciones, comandos de prueba, resultados, riesgos y pendientes.
10. Si algo no es viable, detén esa decisión concreta, explica la evidencia y propone un ADR; no la ocultes ni la sustituyas silenciosamente.
```

## 17. Historial de cambios

Esta sección **no contiene reglas vigentes**: explica cómo se llegó a la versión actual. Si una entrada describe algo que el cuerpo ya corrigió, manda el cuerpo. Las versiones completas anteriores siguen en `archivo/`.

### v1.15

- Se consolida todo en **un solo documento** para revisión uniforme; la partición en archivos enlazados se descarta.
- **Cuentas de prueba por IP: 2 por 30 días** (antes 3).
- Sección 11: mapa servicio → contenedor de Coolify (base directory, Dockerfile y watch paths); cada servicio tiene su Dockerfile.
- Sección 3.1: lista de lanzamiento corregida (incluye `internal-api`; sandboxes desde Fase 5).
- Sección 14.2: valor por defecto en cada decisión abierta.
- Un sitio publicado por cuenta: varios borradores, un solo `active` (índice parcial `sites_one_active_per_owner`).
- Dos paneles: operador y dueño, en la Fase 2.
- Plataforma bilingüe: interfaz en `es` y `en` como locales de primera clase desde la Fase 0; el idioma del contenido del sitio es independiente.
- Sección 12: flujo de promoción `staging` → `main` cerrado (único camino a producción).
- `docs/runbooks/content-csam.md` redactado como plantilla; no válido hasta revisión legal. Falta `docs/legal/csam-jurisdicciones.md`.
- El resto del contenido es idéntico a v1.14.

### v1.14

- Revisión externa aplicada: 6 puntos.
- **Catálogo (7.7):** descriptores cerrados por esquema, sin texto libre al prompt; aviso legal y dictamen previo a la activación; frenos automáticos (versionado, activación gradual, cortacircuitos, tope por ciclo, apagado y reversión); aprendizaje solo con suscripción `active` y tope por cuenta; descubrimiento en dos niveles, con el nivel 2 (orígenes nuevos) apagado por defecto; CC-BY y CC-BY-SA fuera hasta resolver la atribución.
- **Borrado:** `delete_after` = último pago + 30 días, o fin de prueba + 30 días si nunca pagó. Facturas y evidencias legales se conservan aparte; los backups retienen 30 días más.
- **Prueba:** límites por IP, dispositivo, sitios y páginas; `X-Robots-Tag: noindex` hasta el primer pago.
- **Moderación:** escaneo al subir y al publicar; proveedor pendiente de elección; CSAM por hash verificado con Cloudflare; reporte por jurisdicción con confirmación legal.
- **Vídeos propios:** 2 por página, 8 MB cada uno, coherente con el límite de 20 MB.
- **Documento:** partido en archivos enlazados; el historial sale del cuerpo y pasa a este archivo.

### v1.13

**Cambios de la v1.13:** se añade la **sección 9.2 · Flujo de construcción del sitio**, que describe los tres caminos del dueño —**elegir del catálogo**, **describir con lenguaje natural** o **partir de una referencia** (enlace o captura de pantalla)— y cómo se aplican los cambios después. Se documenta la referencia como origen temporal con las mismas garantías de 7.7, la doble vía de ajuste (agente o edición manual) y el límite de la referencia: se extraen propiedades, no se copia la página. Se actualizan 9.1 y 17. Las subsecciones de 9 se renumeran: Soporte 9.3, SEO 9.4, Programación 9.5, Atención 9.6 y Avisos por WhatsApp 9.7.

- Nueva sección **9.2 · Flujo de construcción del sitio**: los tres caminos del dueño (catálogo, lenguaje natural y referencia) y las dos vías de ajuste (agente y edición manual).
- La referencia se documenta como **origen temporal** con las mismas garantías del catálogo: enlace por `sandbox-web` y `egress-proxy`, captura procesada solo para extraer paleta y proporciones, caducidad a 30 días y cero texto o imágenes ajenas.
- Se explicita lo que el dueño ve en cada paso, incluida la cuenta de páginas que se facturarán antes de publicar.
- Subsecciones de 9 renumeradas para dejar el flujo justo después del agente de diseño.
- **El linter visual nunca bloquea lo que el dueño pide.** Sus `error` se avisan y se confirman; solo bloquean el esquema de 6.4 y la política de contenido de 10.1. `SLOP_PLACEHOLDER_TEXT` pasa de `error` a `warning`.
>

### v1.12

**Cambios de la v1.12:** **el sistema también descubre fuentes.** Ya no queda ninguna tarea humana en el catálogo. Cada mes, el job `catalog-discover` busca **páginas nuevas dentro de los orígenes que ya tiene** (galerías, índices de plantillas, changelogs) y además **incorpora orígenes nuevos**, verificando la licencia **por código** contra una lista de licencias permitidas. Sin licencia reconocible, el candidato se descarta con motivo. Se reescribe 7.7.1, se añade 7.7.8 y se actualizan 2, 13 y 17.

### v1.11

**Cambios de la v1.11:** se elimina **toda aprobación humana** del catálogo. El sistema captura, valida y **activa automáticamente** cada mes; no hay pantalla de aprobación ni cola de revisión. El operador solo mantiene la lista de orígenes (alta inicial y cada 6 meses, 10–20 nuevos) con URL, tipo, licencia y frecuencia: nada más. Se sustituye el panel de aprobación por un **registro de solo lectura** (`/admin/design-catalog/log`). Se actualizan 2, 7.7, 9.1, 13 y 17.

- **Se elimina toda aprobación humana del catálogo.** No hay cola de revisión ni pantalla de aprobación: las variantes válidas se activan solas.
- **El sistema descubre fuentes:** páginas nuevas dentro de los orígenes conocidos y orígenes nuevos con licencia verificada por código. Ya no hay alta manual.
- El panel de aprobación se sustituye por `/admin/design-catalog/log`, un registro de solo lectura para diagnóstico.
- La página capturada nace `approved` y la captura de pantalla queda solo como evidencia de auditoría.
- Las variantes descartadas se registran con su motivo y se reintentan en la siguiente captura de esa página.
- Se añade el riesgo de entrada defectuosa activada sin revisión y su mitigación.
- La captura de pantalla se conserva **solo** para la revisión visual del operador; nunca se usa para recomendar ni se envía a un modelo.

### v1.10

**Cambios de la v1.10:** el catálogo de estilos pasa a **crecimiento automático basado en uso real**. El sistema hace crawl **cada mes** de orígenes aprobados, extrae descriptores y **genera 3–5 variantes automáticas** por página capturada (`base`, `bolder`, `quieter`, `minimal`, `warmth`, `tech`). **Aprende del estilo que los usuarios eligen y publican** y con eso decide qué tipos de diseño buscar y en qué orden recomendarlos. La intervención humana es casi cero: el operador solo **aprueba en lote** una vez al mes. Se reescribe 7.7 y se actualizan 2, 9.1, 13 (Fase 5b), 15 y 17.

- Reescrita 7.7: el catálogo **crece solo** con crawl mensual de orígenes aprobados y **3–5 variantes automáticas** por página capturada.
- **Aprendizaje del estilo:** `design_variant_feedback` + `preference_vector` por usuario; el sistema busca y ordena según lo que los usuarios eligen y publican.
- **Intervención humana cero:** el sistema descubre orígenes y páginas, captura, valida y activa solo. No queda ninguna tarea manual en el ciclo.
- Se elimina el requisito de 5 fuentes por entrada: cada página capturada genera sus propias variantes.

### v1.9

**Cambios de la v1.9:** se añade la **biblioteca de estilos** (7.7) alimentada **solo por fuentes con diseño abierto y licencia libre** (7.7.1), mediante el worker `catalog-ingest` en la **Fase 5b**. Se guardan **solo descriptores y tokens**, nunca capturas ni HTML ajeno; cada entrada se **sintetiza de al menos 5 fuentes** distintas, el **operador aprueba** y hay **verificación de originalidad** (7.7.4). Todas las entradas son **responsive por obligación** (7.7.3). Se añade la sección **6.5**, un linter de calidad visual con reglas deterministas adaptadas de *impeccable* (Apache 2.0), y la herramienta `critique_draft` en 9.1. **Ninguna regla de 6.5 bloquea una publicación pedida por el dueño:** se avisa y él confirma.

- Nueva sección 7.7: biblioteca de estilos con **descriptores y tokens**, nunca capturas ni HTML ajeno.
- Fuentes restringidas a **diseño abierto y licencia libre verificada** (7.7.1). Prohibido Dribbble, Behance, Awwwards y sitios de negocios reales.
- Worker `catalog-ingest` en la **Fase 5b**, con `egress-proxy`, sin descubrimiento de fuentes y sin guardar imágenes.
- Cada entrada exige **al menos 5 fuentes** combinadas, **reglas responsive completas** y **aprobación del operador**.
- Verificación de originalidad por comparación numérica de tokens (`DESIGN_TOO_CLOSE_TO_SOURCE`).
- Nueva sección 6.5: linter de calidad visual con reglas deterministas adaptadas de *impeccable* (Apache 2.0), ejecutado sobre el HTML del release.
- Nueva herramienta `critique_draft` y adopción de las 24 direcciones de *impeccable* como variantes del catálogo.

### v1.8

**Cambios de la v1.8:** se reescribe la sección 5.4. Se aclara que **el dominio propio se queda en su registrador** (GoDaddy, Namecheap, Donweb, Cloudflare o cualquier otro) y que el cliente solo añade **un `CNAME` hacia `origin.sitios-saas.com`**; **no necesita cuenta de Cloudflare ni cambia nameservers**, y el certificado lo emite Cloudflare en nuestra cuenta. Se añade la tabla de los tres caminos para el **dominio raíz**, la detección automática del proveedor y la alternativa con `A` directa documentada como no preferente. Se aclara además que **Caddy nunca habla con Cloudflare**.

- Reescrita la sección 5.4: el dominio propio permanece en su registrador; el cliente solo añade un `CNAME` al fallback origin, sin cuenta de Cloudflare ni cambio de nameservers.
- Se separa lo que se le pide al cliente (5.4.1), lo que hace la plataforma (5.4.2) y el problema del dominio raíz (5.4.3) con sus tres caminos.
- Se documenta por qué no se entrega la IP del origen y qué se pierde si se hace (5.4.4).
- Se aclara en 5.3 que Caddy no consulta DNS ni Cloudflare: resuelve por el `Host` y el enlace de `/data/hosts/`.

### v1.7

- Durante los 4 días de gracia el sitio **sigue en línea y no se suspende**.
- Al terminar la gracia el sitio pasa al nuevo estado **`dark`**: no muestra ningún contenido y responde igual que un host inexistente, sin página de aviso.
- Los datos se conservan **30 días desde la fecha de pago** (`delete_after`); si no hay pago, se borra todo: releases, imágenes, vídeos, versiones, borradores y datos asociados.
- `suspended` queda reservado solo a abuso y contenido prohibido; el impago usa `dark`.
- Se añaden `dark_since` y `delete_after` a `sites`, avisos al dueño en los días 7, 20 y 27, y recuperación del sitio al regularizar el pago.

### v1.6

- Se corrigen los plazos, que la v1.5 tenía invertidos: **prueba de 7 días** desde la creación de la cuenta y **sin gracia** al terminar para quien nunca pagó.
- **Gracia de 4 días solo para cuentas con plan ya suscrito** cuyo cobro de renovación falla; mantiene el sitio en línea, incluido el dominio propio.
- `grace_until` nunca se rellena en una cuenta que jamás pagó; `account_terms` solo guarda el fin de la prueba.
- Reintentos de cobro movidos dentro de los 4 días de gracia (día 1, 2 y 4).
- Recordatorios al dueño en los días 3, 5 y 7 de la prueba.

### v1.5

- Se elimina el límite de páginas por sitio (antes 10). Solo queda el límite de 20 MB por página; el cobro sigue siendo por página publicada.
- El periodo de prueba pasa a **4 días** y los días de gracia a **7 días**, ambos contados desde la creación de la cuenta y no desde la primera publicación.
- Se añade `account_terms` para fijar los plazos una sola vez y se actualiza la Fase 2b y sus criterios de aceptación.

### v1.4

- Se restauran suscripciones, pagos y créditos: Fase 2b, tablas `subscriptions`, `payment_events`, `invoices` y `ai_credit_ledger`, y reglas de publicación en 4.3 y 1.
- Cobro **por página publicada**, con 7 días de gracia y 3 reintentos de cobro.
- Publicar o mantener un dominio propio exige suscripción estrictamente `active`.
- Nueva Fase 2c y sección 10.1: política de contenido prohibido (odio, acoso, pornografía, pedofilia/CSAM, violencia, ilegal, drogas, armas, fraude, phishing, suplantación), con revisión al publicar, re-escaneo semanal, denuncias, cola humana y protocolo CSAM.
- Los vídeos incrustados de YouTube o Vimeo no tienen límite de cantidad y no cuentan para los 20 MB; solo los vídeos subidos tienen límite (2 por página, 15 MB).
- `frame-src` de la CSP limitado a `youtube-nocookie.com` y `player.vimeo.com`; el documento guarda `provider` e `id`, nunca URL ni HTML de inserción.

### v1.3

**Cambios de la v1.3 (revisión externa):** el linter tiene especificación propia con severidades (6.4); se restauró el detalle de producto de los agentes de diseño (9.1) y de atención al cliente (9.5); se especificaron los avisos al dueño por WhatsApp desde el número de la plataforma (9.6); el consentimiento inicial tiene un valor por defecto cerrado (9.5, paso de consentimiento); se resolvió el choque de borde con Coolify (5.2); la vista previa funciona en local sin Cloudflare (5.5); todos los parámetros operativos tienen valor numérico (14.1); y se documentó que el dominio raíz con Cloudflare for SaaS exige Apex Proxying (5.4).

- Se completó la sección 9.1 con el flujo paso a paso del agente de diseño, en modo completo y rápido, y la política de imágenes y licencias (nuevo código de linter `IMAGE_LICENSE_MISSING`).
- Se completó la sección 9.6 con herramientas del agente de atención, trato humano, memoria, pausa por mensajes manuales del dueño y escalado con tiempos.
- Se fijó el consentimiento del primer contacto por defecto: aceptación explícita antes de guardar datos personales.
- Se añadió la sección 9.7 con los avisos al dueño por WhatsApp desde el número de la plataforma (OpenClaw), con verificación, contenido mínimo, agrupación y canales de respaldo.
- Se añadió la sección 14.1 con los parámetros operativos y valores por defecto; las decisiones abiertas pasan a 14.2.
- Se confirmó OpenClaw como transporte de WhatsApp, con sus riesgos registrados como ADR.
- Se retiró del documento todo lo relativo a cobros, suscripciones, créditos y gracia de pago (Fase 2b incluida), por decisión del responsable.
- Límite de peso por página: 20 MB incluyendo imágenes, vídeos y texto; se añade el bloque `video` y el código de linter `PAGE_TOO_HEAVY`.
- Los avisos al dueño por WhatsApp los decide el agente de atención mediante la herramienta `notify_owner`, no por cada evento del sistema.

### v1.2

**Cambio principal de la v1.2:** el documento tiene **una sola fuente de verdad**. El antiguo apéndice 17 se integró en el cuerpo y se eliminó; ya no existe ninguna regla de precedencia entre secciones. Esta versión se centra en que el sistema **funcione y sea seguro**; los precios, márgenes y estimaciones económicas se retiraron del alcance de este documento. El historial de cambios está en la sección 17.

- Se eliminó la estructura de apéndice con precedencia; esta versión es la única fuente de verdad.
- Se retiraron los importes y estimaciones económicas del alcance técnico.
- Se separaron aplicación, sitios y vista previa en familias de dominios distintas.
- Se corrigió el diseño de Caddy: datos propios fuera de `/data`, borde Traefik/Cloudflare y validación de host.
- Se añadieron verificación TXT y protección contra secuestro de dominios.
- Se movieron borradores y versiones a PostgreSQL; el disco conserva releases autocontenidos y assets.
- Se separaron `sandbox-web`, `sandbox-code`, `internal-api`, `llm-gateway` y `egress-proxy`.
- Se añadieron RLS forzada, roles DB, miembros, consentimientos, leads, notificaciones y OpenClaw.
- Se dividieron linter estático y revisión visual.
- Se definieron puerta de solo respuesta, revocación de tokens, reconciliación, purga de caché y criterios medibles de aceptación.
- Se redujo el MVP a Fases 0–4; las capacidades de sandbox, canales y agentes posteriores quedan condicionadas a sus fases.

### v1.1

Versión anterior recibida en `especificacion-construccion-v1.1.md`. Se conserva como referencia histórica fuera de la fuente de verdad activa.
---
**Estado:** especificación técnica consolidada para revisión. La construcción debe comenzar únicamente después de validar la Fase 0 y registrar los ADR necesarios.
