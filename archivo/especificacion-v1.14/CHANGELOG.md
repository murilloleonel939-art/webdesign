# Historial de cambios de la especificación

Fuente única del historial. El documento vigente es `especificacion-v1.14/`; las versiones anteriores completas siguen en `especificacion-construccion-v1.N.md` como referencia.

## v1.14

- Revisión externa aplicada: 6 puntos.
- **Catálogo (7.7):** descriptores cerrados por esquema, sin texto libre al prompt; aviso legal y dictamen previo a la activación; frenos automáticos (versionado, activación gradual, cortacircuitos, tope por ciclo, apagado y reversión); aprendizaje solo con suscripción `active` y tope por cuenta; descubrimiento en dos niveles, con el nivel 2 (orígenes nuevos) apagado por defecto; CC-BY y CC-BY-SA fuera hasta resolver la atribución.
- **Borrado:** `delete_after` = último pago + 30 días, o fin de prueba + 30 días si nunca pagó. Facturas y evidencias legales se conservan aparte; los backups retienen 30 días más.
- **Prueba:** límites por IP, dispositivo, sitios y páginas; `X-Robots-Tag: noindex` hasta el primer pago.
- **Moderación:** escaneo al subir y al publicar; proveedor pendiente de elección; CSAM por hash verificado con Cloudflare; reporte por jurisdicción con confirmación legal.
- **Vídeos propios:** 2 por página, 8 MB cada uno, coherente con el límite de 20 MB.
- **Documento:** partido en archivos enlazados; el historial sale del cuerpo y pasa a este archivo.

## v1.13

**Cambios de la v1.13:** se añade la **sección 9.2 · Flujo de construcción del sitio**, que describe los tres caminos del dueño —**elegir del catálogo**, **describir con lenguaje natural** o **partir de una referencia** (enlace o captura de pantalla)— y cómo se aplican los cambios después. Se documenta la referencia como origen temporal con las mismas garantías de 7.7, la doble vía de ajuste (agente o edición manual) y el límite de la referencia: se extraen propiedades, no se copia la página. Se actualizan 9.1 y 17. Las subsecciones de 9 se renumeran: Soporte 9.3, SEO 9.4, Programación 9.5, Atención 9.6 y Avisos por WhatsApp 9.7.

- Nueva sección **9.2 · Flujo de construcción del sitio**: los tres caminos del dueño (catálogo, lenguaje natural y referencia) y las dos vías de ajuste (agente y edición manual).
- La referencia se documenta como **origen temporal** con las mismas garantías del catálogo: enlace por `sandbox-web` y `egress-proxy`, captura procesada solo para extraer paleta y proporciones, caducidad a 30 días y cero texto o imágenes ajenas.
- Se explicita lo que el dueño ve en cada paso, incluida la cuenta de páginas que se facturarán antes de publicar.
- Subsecciones de 9 renumeradas para dejar el flujo justo después del agente de diseño.
- **El linter visual nunca bloquea lo que el dueño pide.** Sus `error` se avisan y se confirman; solo bloquean el esquema de 6.4 y la política de contenido de 10.1. `SLOP_PLACEHOLDER_TEXT` pasa de `error` a `warning`.
>

## v1.12

**Cambios de la v1.12:** **el sistema también descubre fuentes.** Ya no queda ninguna tarea humana en el catálogo. Cada mes, el job `catalog-discover` busca **páginas nuevas dentro de los orígenes que ya tiene** (galerías, índices de plantillas, changelogs) y además **incorpora orígenes nuevos**, verificando la licencia **por código** contra una lista de licencias permitidas. Sin licencia reconocible, el candidato se descarta con motivo. Se reescribe 7.7.1, se añade 7.7.8 y se actualizan 2, 13 y 17.

## v1.11

**Cambios de la v1.11:** se elimina **toda aprobación humana** del catálogo. El sistema captura, valida y **activa automáticamente** cada mes; no hay pantalla de aprobación ni cola de revisión. El operador solo mantiene la lista de orígenes (alta inicial y cada 6 meses, 10–20 nuevos) con URL, tipo, licencia y frecuencia: nada más. Se sustituye el panel de aprobación por un **registro de solo lectura** (`/admin/design-catalog/log`). Se actualizan 2, 7.7, 9.1, 13 y 17.

- **Se elimina toda aprobación humana del catálogo.** No hay cola de revisión ni pantalla de aprobación: las variantes válidas se activan solas.
- **El sistema descubre fuentes:** páginas nuevas dentro de los orígenes conocidos y orígenes nuevos con licencia verificada por código. Ya no hay alta manual.
- El panel de aprobación se sustituye por `/admin/design-catalog/log`, un registro de solo lectura para diagnóstico.
- La página capturada nace `approved` y la captura de pantalla queda solo como evidencia de auditoría.
- Las variantes descartadas se registran con su motivo y se reintentan en la siguiente captura de esa página.
- Se añade el riesgo de entrada defectuosa activada sin revisión y su mitigación.
- La captura de pantalla se conserva **solo** para la revisión visual del operador; nunca se usa para recomendar ni se envía a un modelo.

## v1.10

**Cambios de la v1.10:** el catálogo de estilos pasa a **crecimiento automático basado en uso real**. El sistema hace crawl **cada mes** de orígenes aprobados, extrae descriptores y **genera 3–5 variantes automáticas** por página capturada (`base`, `bolder`, `quieter`, `minimal`, `warmth`, `tech`). **Aprende del estilo que los usuarios eligen y publican** y con eso decide qué tipos de diseño buscar y en qué orden recomendarlos. La intervención humana es casi cero: el operador solo **aprueba en lote** una vez al mes. Se reescribe 7.7 y se actualizan 2, 9.1, 13 (Fase 5b), 15 y 17.

- Reescrita 7.7: el catálogo **crece solo** con crawl mensual de orígenes aprobados y **3–5 variantes automáticas** por página capturada.
- **Aprendizaje del estilo:** `design_variant_feedback` + `preference_vector` por usuario; el sistema busca y ordena según lo que los usuarios eligen y publican.
- **Intervención humana cero:** el sistema descubre orígenes y páginas, captura, valida y activa solo. No queda ninguna tarea manual en el ciclo.
- Se elimina el requisito de 5 fuentes por entrada: cada página capturada genera sus propias variantes.

## v1.9

**Cambios de la v1.9:** se añade la **biblioteca de estilos** (7.7) alimentada **solo por fuentes con diseño abierto y licencia libre** (7.7.1), mediante el worker `catalog-ingest` en la **Fase 5b**. Se guardan **solo descriptores y tokens**, nunca capturas ni HTML ajeno; cada entrada se **sintetiza de al menos 5 fuentes** distintas, el **operador aprueba** y hay **verificación de originalidad** (7.7.4). Todas las entradas son **responsive por obligación** (7.7.3). Se añade la sección **6.5**, un linter de calidad visual con reglas deterministas adaptadas de *impeccable* (Apache 2.0), y la herramienta `critique_draft` en 9.1. **Ninguna regla de 6.5 bloquea una publicación pedida por el dueño:** se avisa y él confirma.

- Nueva sección 7.7: biblioteca de estilos con **descriptores y tokens**, nunca capturas ni HTML ajeno.
- Fuentes restringidas a **diseño abierto y licencia libre verificada** (7.7.1). Prohibido Dribbble, Behance, Awwwards y sitios de negocios reales.
- Worker `catalog-ingest` en la **Fase 5b**, con `egress-proxy`, sin descubrimiento de fuentes y sin guardar imágenes.
- Cada entrada exige **al menos 5 fuentes** combinadas, **reglas responsive completas** y **aprobación del operador**.
- Verificación de originalidad por comparación numérica de tokens (`DESIGN_TOO_CLOSE_TO_SOURCE`).
- Nueva sección 6.5: linter de calidad visual con reglas deterministas adaptadas de *impeccable* (Apache 2.0), ejecutado sobre el HTML del release.
- Nueva herramienta `critique_draft` y adopción de las 24 direcciones de *impeccable* como variantes del catálogo.

## v1.8

**Cambios de la v1.8:** se reescribe la sección 5.4. Se aclara que **el dominio propio se queda en su registrador** (GoDaddy, Namecheap, Donweb, Cloudflare o cualquier otro) y que el cliente solo añade **un `CNAME` hacia `origin.sitios-saas.com`**; **no necesita cuenta de Cloudflare ni cambia nameservers**, y el certificado lo emite Cloudflare en nuestra cuenta. Se añade la tabla de los tres caminos para el **dominio raíz**, la detección automática del proveedor y la alternativa con `A` directa documentada como no preferente. Se aclara además que **Caddy nunca habla con Cloudflare**.

- Reescrita la sección 5.4: el dominio propio permanece en su registrador; el cliente solo añade un `CNAME` al fallback origin, sin cuenta de Cloudflare ni cambio de nameservers.
- Se separa lo que se le pide al cliente (5.4.1), lo que hace la plataforma (5.4.2) y el problema del dominio raíz (5.4.3) con sus tres caminos.
- Se documenta por qué no se entrega la IP del origen y qué se pierde si se hace (5.4.4).
- Se aclara en 5.3 que Caddy no consulta DNS ni Cloudflare: resuelve por el `Host` y el enlace de `/data/hosts/`.

## v1.7

- Durante los 4 días de gracia el sitio **sigue en línea y no se suspende**.
- Al terminar la gracia el sitio pasa al nuevo estado **`dark`**: no muestra ningún contenido y responde igual que un host inexistente, sin página de aviso.
- Los datos se conservan **30 días desde la fecha de pago** (`delete_after`); si no hay pago, se borra todo: releases, imágenes, vídeos, versiones, borradores y datos asociados.
- `suspended` queda reservado solo a abuso y contenido prohibido; el impago usa `dark`.
- Se añaden `dark_since` y `delete_after` a `sites`, avisos al dueño en los días 7, 20 y 27, y recuperación del sitio al regularizar el pago.

## v1.6

- Se corrigen los plazos, que la v1.5 tenía invertidos: **prueba de 7 días** desde la creación de la cuenta y **sin gracia** al terminar para quien nunca pagó.
- **Gracia de 4 días solo para cuentas con plan ya suscrito** cuyo cobro de renovación falla; mantiene el sitio en línea, incluido el dominio propio.
- `grace_until` nunca se rellena en una cuenta que jamás pagó; `account_terms` solo guarda el fin de la prueba.
- Reintentos de cobro movidos dentro de los 4 días de gracia (día 1, 2 y 4).
- Recordatorios al dueño en los días 3, 5 y 7 de la prueba.

## v1.5

- Se elimina el límite de páginas por sitio (antes 10). Solo queda el límite de 20 MB por página; el cobro sigue siendo por página publicada.
- El periodo de prueba pasa a **4 días** y los días de gracia a **7 días**, ambos contados desde la creación de la cuenta y no desde la primera publicación.
- Se añade `account_terms` para fijar los plazos una sola vez y se actualiza la Fase 2b y sus criterios de aceptación.

## v1.4

- Se restauran suscripciones, pagos y créditos: Fase 2b, tablas `subscriptions`, `payment_events`, `invoices` y `ai_credit_ledger`, y reglas de publicación en 4.3 y 1.
- Cobro **por página publicada**, con 7 días de gracia y 3 reintentos de cobro.
- Publicar o mantener un dominio propio exige suscripción estrictamente `active`.
- Nueva Fase 2c y sección 10.1: política de contenido prohibido (odio, acoso, pornografía, pedofilia/CSAM, violencia, ilegal, drogas, armas, fraude, phishing, suplantación), con revisión al publicar, re-escaneo semanal, denuncias, cola humana y protocolo CSAM.
- Los vídeos incrustados de YouTube o Vimeo no tienen límite de cantidad y no cuentan para los 20 MB; solo los vídeos subidos tienen límite (2 por página, 15 MB).
- `frame-src` de la CSP limitado a `youtube-nocookie.com` y `player.vimeo.com`; el documento guarda `provider` e `id`, nunca URL ni HTML de inserción.

## v1.3

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

## v1.2

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

## v1.1

Versión anterior recibida en `especificacion-construccion-v1.1.md`. Se conserva como referencia histórica fuera de la fuente de verdad activa.
---
**Estado:** especificación técnica consolidada para revisión. La construcción debe comenzar únicamente después de validar la Fase 0 y registrar los ADR necesarios.
