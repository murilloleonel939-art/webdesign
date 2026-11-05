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

## 12. Infraestructura y despliegue

Staging y producción están separados. Coolify despliega desde GitHub con healthchecks, migraciones explícitas y rollback. Ningún despliegue ejecuta migraciones destructivas automáticamente.

Requisitos del compose: redes descritas en §3.2; volúmenes separados para Postgres, Caddy y sitios; límites de CPU/RAM; `restart: unless-stopped`; healthchecks; Redis con autenticación, AOF y `maxmemory-policy noeviction`; Postgres sin puerto público; Caddy sin acceso a `/caddy-data` desde la ruta de sitios; secretos mediante variables protegidas de Coolify.

`platform` recibe `DATABASE_URL` con su rol, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, rutas de solo lectura y configuración de dominios. `workers` recibe su rol, acceso de escritura a sitios y tokens DNS limitados. `llm-gateway` recibe únicamente claves de modelos. `sandbox` e instancias OpenClaw no reciben claves reales.

Backups: Postgres con restauración probada y `/data/sites` con restic o rclone cifrado a destino externo. Se prueba restauración al menos en cada cambio de infraestructura y trimestralmente. Alertas al 80 % de disco, fallos de backup, divergencia de releases, certificados y colas atascadas.

## 13. Fases de construcción

Cada fase entrega código, migraciones, pruebas, README, evidencias de aceptación, riesgos y pendientes.

### Fase 0 · Fundamentos

Monorepo, CI, TypeScript estricto, compose local, `site-schema`, `storage`, `db`, auth base y paquetes de seguridad.

**Aceptación:** CI pasa; stack local levanta con un comando; pruebas de validación, RLS básica y traversal pasan.

### Fase 1 · Núcleo del sitio

Schema completo, migraciones, renderer, componentes, adaptador Puck, editor, preview aislada, releases, rollback, linter estático y almacenamiento.

**Aceptación:** crear, editar, previsualizar, publicar y revertir; HTML válido, CSP, accesibilidad crítica y prueba de carga básica; tipo desconocido rechazado.

### Fase 2 · Multiusuario y hosting

Usuarios, miembros, RLS, cuotas, Redis/BullMQ, Caddy detrás de Traefik, Cloudflare, pool de dominios, formularios `/_f/lead`, antispam y avisos al panel.

**Aceptación:** dos usuarios no pueden verse; dos sitios se sirven correctamente; host no registrado devuelve respuesta uniforme; cuota excedida se rechaza; backup se restaura; formulario llega al panel.

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
| Proveedor de cobros | Elegir tras prueba de webhooks, reembolsos, impuestos locales y exportación. Criterio: medios de pago del país objetivo, recurrencia con cantidad variable por página y recibo por correo |
| Proveedor de correo | Uno con SPF, DKIM, DMARC, API y retención configurable |
| Soporte y atención LLM | Comparar Haiku y GPT-6 Luna con conjunto de evaluación; elegir por calidad y estabilidad |
| Telegram | grammY propio en `platform`/`workers`; OpenClaw solo para WhatsApp |
| Cloudflare | Proxy, Origin CA/Full strict, Authenticated Origin Pulls y Cloudflare for SaaS |
| Pool DNS | Registro comodín proxied por dominio, con límite operativo y separación por abuso |
| Bandeja | Panel propio; evaluar Chatwoot solo mediante PoC aislada |
| Embeddings | Modelo fijado durante Fase 7; dimensión configurable por migración de índice |
| Retención | Mínima necesaria; 30 días para sitios borrados y políticas configurables por dato. **La contabilidad y las evidencias legales se conservan aparte del borrado de contenido**, por el plazo que exija la ley |
| Proveedor de moderación | No elegido. Requisitos en 10.1; se decide en la Fase 2c con prueba de casos reales |
| Detección de CSAM por hash | Verificar si Cloudflare la ofrece sin coste para estos sitios; si no, contratarla con el proveedor de moderación |
| Jurisdicciones de reporte de CSAM | Confirmar autoridades y canales por país antes de operar allí (10.1) |
| Dictamen legal del catálogo | Requisito de activación de la Fase 5b, no una tarea pendiente cualquiera (7.7.9.C) |
| Analítica | Logs agregados sin cookies como primera opción |
| Textos legales | Revisión profesional antes de activar formularios, canales y consentimiento |
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
