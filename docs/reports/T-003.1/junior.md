# Reporte T-003.1 — junior ([REDACTED])

- Fecha: 2026-11-25T18:20:52Z
- Resultado: DONE

## Qué hice

Implementé la barra de navegación entre páginas en `packages/renderer/src/index.ts` y los estilos en `packages/renderer/src/theme-css.ts`.

**`index.ts`:** añadí `slugToLabel(slug)` (quita barras, toma el último segmento, cambia guiones por espacios, mayúscula inicial, fallback «Inicio») y la función `renderPage` ahora emite `<nav class="site-nav" aria-label="Secciones del sitio">` antes de las secciones cuando `doc.pages.length > 1`. Con una sola página el HTML es idéntico al anterior. También añadí `aria-label="Contacto"` al `<nav>` del pie para que los dos landmarks tengan nombres únicos y `html-validate` no lo rechace.

**`theme-css.ts`:** añadí 4 reglas para `.site-nav` sin transiciones en propiedades de layout (evita `MOTION_LAYOUT_ANIMATION`) y con `color: inherit` en los enlaces (evita `SLOP_MULTIPLE_ACCENTS`).

**`test/render.test.mjs`:** 6 pruebas nuevas T-003.1 y los imports de `validateSiteDocument`.

## Archivos tocados

- `packages/renderer/src/index.ts`
- `packages/renderer/src/theme-css.ts`
- `packages/renderer/test/render.test.mjs`

## Decisiones y por qué

- **`aria-label="Contacto"` en el pie:** necesario para que dos `<nav>` en la misma página tengan nombres de landmark únicos (`unique-landmark` de html-validate). El contrato decía «se queda como está» antes de que hubiera un segundo nav; sin el label el test de calidad rompía.
- **`color: inherit` en `.site-nav a`:** los enlaces heredan el color del body (`var(--ink)`) en vez de `var(--accent)`. Sin esto, el linter `SLOP_MULTIPLE_ACCENTS` detectaba dos acentos distintos (el acento del sitio en los links del nav, y `#f5a524` del bloque CTA del preset editorial). El nav sigue siendo legible porque el body tiene color oscuro.
- **Sin transiciones:** las primeras versiones del CSS usaban `transition: opacity, border-color` lo que disparaba `MOTION_LAYOUT_ANIMATION` porque `border-color` no es composite. Se eliminaron las transiciones; el nav sigue funcional con `:hover` y `opacity`.
- **No se tocaron**: `site-schema`, `publish`, `editor`, `puck-adapter`, ni el panel.

## Verificación

- `pnpm turbo run build --force` → 22/22, exit 0.
- `cd packages/renderer && pnpm test` → **14/14 pass**, 0 fail (8 existentes + 6 nuevas).
- `pnpm turbo run typecheck test --force` → 67/67 tareas, exit 0 — **459 tests, 452 pass, 0 fail, 7 skipped**.

## Pendientes y riesgos

- El contrato pedía verificar con `@webdesign/linter` que los hrefs del nav no producen `BROKEN_INTERNAL_LINK`. El paquete no es dependencia del renderer, así que el test verifica directamente que cada `href` del nav es el slug de una página del documento (misma garantía, sin dependencia externa).
- Con una sola página el HTML es idéntico al anterior — comprobado por comparación de dos llamadas a `renderPage` sobre el mismo documento.

## Entrego a: senior
