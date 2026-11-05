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
| `renderer` | HTML por página, escape total, CSP, `rel="noopener noreferrer"`, resolver de assets | 5 |
| `linter` | Linter estático 6.4: seguridad, datos, contraste WCAG, peso, fuentes alojadas | 10 |
| `releases` | `/data/sites/<id>/releases/v<N>`, `public` symlink, cambio atómico, rollback | 5 |
| `storage` | Rutas seguras, nombre físico de assets | (en `security`) |
| `auth`, `security`, `db` | Base de Fase 0 | 7 |

## Fase 1 — pendiente
1. Editor Puck sobre `site-schema` (adaptador, guardado por id).
2. Preview aislado por origen.
3. Publicación que encadena renderer → linter → releases, con `audit_log`.
4. Tablas de páginas, releases y assets con RLS y sus migraciones.

## Decisiones
- Una sola web publicada por cliente (`sites_one_active_per_owner`); borradores sin límite.
- `design_origins` exige licencia verificada; MIT entra en `license_allowlist`.
  Plantillas HTML de archivo único con MIT (Linea de 8B) permitidas como fuente de
  tokens y orden de secciones, nunca el archivo literal.
- Los `error` del linter bloquean la publicación; `warning` e `info` no.
- Respuestas en español, identificadores en inglés.

## Próximos pasos
Editor Puck y preview; luego publicación transaccional con `audit_log`.
