# T-033a — Release: el sistema elige fotos sin que nadie las mire

Fecha: 2026-11-27 (commit y push)

## Qué se publicó

- Commit: `27c662f` — `feat(fotos): el sistema elige fotos sin que nadie las mire`
- Rama: `main` (sin PR)
- Remoto: `27c662f196bb4e2ea48cb4141a0a98360f423272 refs/heads/main` (verificado con `git ls-remote`)
- Commit anterior: `13582e9`
- Ficheros:
  - `apps/platform/src/photo-filter.ts` (nuevo, 708 líneas)
  - `apps/platform/test/photo-filter.test.mjs` (nuevo, 454 líneas)
  - `apps/platform/package.json` (añade el nuevo test al script `test`)
- Fuera del commit a propósito: `docs/PLAN-VIABLE.md` (sin trazar; confirmado con `git diff --cached --name-only`)

## Problema

La biblioteca de fotos se curó a mano: 98 imágenes revisadas una a una. Eso no es producto,
porque si el dueño quiere más fotos depende de una persona mirándolas. Y el gateway solo
acepta texto, así que un job no puede mirar las imágenes.

## Cambios

1. **El criterio, escrito como reglas sobre metadatos.** `filterPhoto` / `filterBatch` aplican
   el primer rechazo en este orden: `duplicate`, `too_small`, `no_description`,
   `portrait_or_people`, `brand`, `aspect_mismatch`, `off_topic`.
2. **Bordes de palabra propios.** 39 términos de personas/retratos y 29 de marcas, con
   límites para que `man` no case dentro de `management` ni `hp` dentro de `happiness`.
3. **Guardas de contexto de marca.** `apple pie` no es la marca, `canon law` no es la cámara,
   `amazon river` no es la tienda.
4. **Relevancia por sector** con listas de aceptación para los 7 sectores.
5. **`altFor`:** escribe el texto alternativo en castellano usando **solo** palabras que ya
   están en la descripción original. Si no hay nada seguro, devuelve una frase del sector
   cierta por construcción. Nunca inventa el tipo de negocio.

## Verificación (comprobado)

- Rama `main`; `git status --short` con solo los ficheros del release.
- Búsqueda de las dos claves indicadas en todo el árbol (sin `node_modules` ni `.git`): cero
  coincidencias.
- `pnpm test` en `apps/platform`: **165 tests, 162 pass, 0 fail, 3 skipped**.
- El nuevo fichero por separado: **44 tests, 44 pass, 0 fail, 0 skipped**.
- `pnpm typecheck` en la raíz: 41/41 tareas correctas, exit 0.
- Push verificado con `git ls-remote` (coincide con el SHA local).
- No se usó `pnpm turbo run build --force`, ni `--force`, ni `git reset --hard`, ni borrado de ramas.

## Grafo

- `graphify-out/graph.json`: **3975 nodos**, 6583 aristas, 270 comunidades (reconstruido tras el commit).

## Pendiente

- **El filtro solo entiende el `alt` en inglés de la API.** El manifiesto guarda los `alt` ya
  en castellano, así que si alguien re-filtra el banco existente, **87 de 98 fotos caen en
  `off_topic`**. El job tiene que pasarle el `alt` crudo de `searchUnsplash`, **antes** de
  `altFor`. Si Unsplash localizara sus descripciones, habría que añadir las listas en castellano.
- **`salud` es el sector blando:** `equipment` y `treatment` son genéricos y dejan pasar fotos
  de gimnasio. `taller` deja pasar mesas de madera y `belleza` sillas junto a un espejo. La
  corrección barata sería marcar los términos débiles y exigir un segundo término del sector.
- **Falta el job** que use este filtro para construir la biblioteca en producción. Debe vivir
  en `apps/platform`, **no** en `apps/workers`: el volumen `/data/biblioteca` y la clave de
  imágenes solo están en `platform`, y un job en `workers` escribiría en un filesystem que la
  plataforma nunca lee.
- Los commits están firmados por `root` (identidad local de git, no configurada en este repositorio).
- El gateway sigue en 502 (pendiente de `LLM_PROVIDER_API_KEY`, ver T-033).
