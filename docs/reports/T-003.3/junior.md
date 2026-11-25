# T-003.3 — Reporte junior

## Quién hizo qué

- **Código de multipágina** (`plan.ts`, `draft.ts`, `index.ts`, `apps/workers/src/design-job.ts`, renderer y site-schema): escrito por el agente `junior` (claude-sonnet-5).
- **Clasificador** (`agents/design/src/classify.ts`) y sus 12 pruebas (`agents/design/test/classify.test.mjs`): escritos por el agente `dev-fix` (claude-sonnet-5).
- **Adaptación de pruebas existentes**: 22 aserciones en `agents/design/test/copy.test.mjs` y 10 en `agents/design/test/design.test.mjs` llevan el marcador `T-003.3:`.
- **Este reporte**: redactado por el agente release (claude-haiku-5-5) a partir de la lectura del código. Los agentes anteriores cayeron antes de escribir el suyo.

## Qué hace el código

### Clasificador (`classify.ts`)

Decide entre `landing` y `site` de forma determinista, sin modelo:

1. Si aparece una señal de oferta única (curso, lanzamiento, reserva, descarga, evento, webinar, oferta…) → `landing`.
2. Si aparece una señal de negocio con áreas (restaurante, clínica, despacho, taller, academia, tienda, agencia…) → `site`.
3. Sin señal → `landing`.

Coincidencia por palabra completa (`\b...\b`) sobre el texto normalizado (minúsculas, sin acentos). La raíz `abogad` solo ancla al inicio de palabra, para cubrir abogado/abogada/abogados.

### Plan (`plan.ts`)

- `Plan` = `{ presetId, shape, pages: PlannedPage[] }`.
- `PlannedPage` = `{ slug, title, sections: PlannedSection[] }`.
- Para `landing`: una página (`/`) con las secciones de siempre.
- Para `site`: cuatro páginas fijas. Cada sección se incluye solo si el copy la sostiene (`sectionSupported`); no se añade `omit` en el plan de sitio.

### Borrador (`draft.ts`): tabla de las 4 páginas

| Página | id | slug | Secciones (en orden) |
|---|---|---|---|
| Portada | `p_home` | `/` | hero, features, faq, cta (según copy) |
| Servicios | `p_servicios` | `/servicios` | hero, features, process, cta |
| Sobre nosotros | `p_sobre` | `/sobre-nosotros` | hero, text, faq |
| Contacto | `p_contacto` | `/contacto` | hero, contact |

- Los `pricing` y `testimonial` no aparecen nunca.
- El hero de las subpáginas usa la etiqueta de la página como titular (con `· nombre` si es corto de 8 caracteres).
- Si el copy no llega al mínimo de una sección, entra la genérica (`completeCopy`), nunca mezclada.

### Lectura cambiada en `design-job.ts`

Antes registraba `sections: result.plan.sections.length`. Ahora registra `pages: result.plan.pages.length`, porque `Plan` ya no tiene `sections` en la raíz.

## Pruebas

- **Clasificador**: 12 casos en `classify.test.mjs`: reglas 1, 2 y 3; `restaurante` → site; `asesoria` → site; `lanzamiento` y `ebook` → landing; palabra completa (`bar` no casa en `barrio` ni `baratos`; `curso` no casa en `recursos`); raíz `abogad`; señal entre otras palabras; normalización de mayúsculas y acentos.
- **Adaptadas**: las aserciones que esperaban la sección en la portada ahora la buscan en la página que la contiene. Ejemplos: el `text` (about) está en `/sobre-nosotros` (`copy.test.mjs` ~l.237), el `process` está en `/servicios` (~l.723 y ~l.761), y el `plan.pages.find(p => p.slug === "/servicios")`.
- **Criterio de adaptación**: se movió cada aserción a la página donde ahora vive la sección. No se relajó ninguna comprobación: el `origin`, el contenido exacto de `features.props.items` y la validez del documento (`validateSiteDocument`) siguen igual de estrictos.

## Verificado (lo comprobado)

- `agents/design`: 140 tests, 140 pass, 0 fail.
- Monorepo: `turbo run typecheck test --force` → 67/67 tareas correctas.
- Build: `turbo run build --force` → 22 tareas.

## Qué no se verificó

- **No hubo revisión independiente de testing ni de seguridad** para T-003: esos agentes cayeron y no se sustituyeron. Lo único verificado es la suite del repo.
- No se probó en un navegador ni con un brief real de punta a punta.
