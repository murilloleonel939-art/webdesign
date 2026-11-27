# T-025 — Release (T-023 + T-024 + T-025)

- **Fecha:** 2026-11-27 (UTC)
- **Rama:** `main` (sin PR, sin ramas nuevas)
- **Commit de código:** `43708c95cac57a4cd3cb59093fa73d3d4e09dfaa` (`43708c9`), autor `root`. Sin firma GPG (`%G?` = N).
- **Remoto:** `git ls-remote origin main` devuelve el mismo SHA (comprobado).
- **Grafo:** 3597 nodos en `graphify-out/graph.json` antes de la reconstrucción en segundo plano iniciada por el hook.

## Contenido
- T-023 tema: tokens en lugar de colores literales, radio desacoplado, formulario en rejilla, pasos numerados, ritmo vertical.
- T-024 datos: `agents/design/data/design-intelligence.json` (194 productos, 34 patrones, 89 estilos, 74 tipografías) y su script de extracción.
- T-025 composición: `productForBrief` y `patternFor` eligen las secciones de la portada. Nuevas secciones `testimonials`, `pricing` (con plan destacado) y `metrics`; sin datos del dueño se omiten con aviso.

## Verificación (lo comprobé)
- agent-design: 207/207
- site-schema: 23/23
- ui-components: 18/18
- renderer: 31/31
- typecheck: limpio
- Búsqueda del token de seguridad en el repo: cero coincidencias.

## Comprobación del JSON en el contenedor
- `agents/design/src/product.ts` y `dist/product.js` leen `new URL("../data/design-intelligence.json", import.meta.url)`.
- `agents/design/package.json` no tiene campo `files`, y `data/` no está en `.gitignore`. `apps/workers` depende de `@webdesign/agent-design` y `apps/workers/Dockerfile` usa `pnpm deploy`.
- Lo comprobado: el archivo es untracked hasta este commit, y ahora está versionado. Lo que creo (no lo he probado con un build de Docker): `pnpm deploy` copia `data/` junto al paquete, así que la ruta relativa resuelve en el contenedor.

## Pendientes
- El panel todavía no recoge testimonios, precios ni cifras. En producción esas tres secciones no aparecerán hasta que el dueño pueda darlos.
- El texto de la portada repite el «sobre nosotros» de `/sobre-nosotros`.
- El gateway sigue devolviendo 502, así que el copy lo escribe el generador, no el modelo.
- Según el brief del lead, 32 de 194 productos caen al patrón de respaldo. No lo he recalculado; el JSON indica 48 sin patrón asociado en la extracción previa. Conviene confirmarlo.
