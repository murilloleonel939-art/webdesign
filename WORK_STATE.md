# Estado del proyecto

## Objetivo
Construir la plataforma multi-sitio de agentes IA según `especificacion-construccion-v1.15.md`
(documento único por versión; `archivo/` es histórico y no se modifica).

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
