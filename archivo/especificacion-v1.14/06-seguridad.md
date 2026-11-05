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
