# Estado del proyecto

## Objetivo
Construir la plataforma multi-sitio de agentes IA según `especificacion-construccion-v1.15.md`
(documento único por versión; `archivo/` es histórico y no se modifica).

## Fases
- **Fase 0 — Fundamentos: cerrada.** Monorepo pnpm+turbo, Postgres 18+pgvector en Coolify,
  rol `app_platform` con RLS forzada (`rolbypassrls = f`), migraciones forward-only,
  `apps/platform` con `/healthz` y migración al arrancar, CI verde.
- **Fase 1 — Núcleo del sitio: en curso.**

## Fase 1 — hecho
| Paquete | Contenido | Pruebas |
| --- | --- | --- |
| `site-schema` | Documento canónico spec 6.1 con Zod: meta, design, theme, pages, sections, assets | 6 |
| `renderer` | HTML por página sobre `ui-components`, CSP, `rel="noopener noreferrer"`, testimonios sin confirmar nunca se publican | 6 |
| `linter` | Linter estático 6.4: seguridad, datos, contraste WCAG, peso, fuentes alojadas | 10 |
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
1. Panel del editor en el navegador (montaje de Puck y `iframe` de vista previa).
2. Servir `/assets/` del sitio publicado (Caddy en Fase 2) y validación HTML + accesibilidad crítica en CI.
3. Validación HTML y accesibilidad crítica en CI.
4. Prueba de carga básica.
2. Servir `/assets/` del sitio publicado (Caddy en Fase 2) y validación HTML + accesibilidad crítica en CI.
3. Validación HTML y accesibilidad crítica en CI.
4. Prueba de carga básica.

## Decisiones
- Una sola web publicada por cliente (`sites_one_active_per_owner`); borradores sin límite.
- `design_origins` exige licencia verificada; MIT entra en `license_allowlist`.
  Plantillas HTML de archivo único con MIT (Linea de 8B) permitidas como fuente de
  tokens y orden de secciones, nunca el archivo literal.
- Los `error` del linter bloquean la publicación; `warning` e `info` no.
- Respuestas en español, identificadores en inglés.

## Próximos pasos
Editor Puck y preview; luego publicación transaccional con `audit_log`.
