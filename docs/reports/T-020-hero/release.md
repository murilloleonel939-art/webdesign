# Reporte T-014 + T-020 — release (claude-haiku-5-5)

- Fecha: 2026-11-26T17:32Z
- Resultado: DONE

## Qué hice

- Verifiqué que la rama de trabajo es `main` (sin ramas nuevas, sin PR).
- Ejecuté la verificación del encargo antes de commitear, en los tres paquetes.
- Preparé el commit con `git add` por ruta explícita: 10 archivos. Dejé fuera
  `docs/PLAN-VIABLE.md` (sigue sin seguimiento) y `apps/platform/ui-dist/`
  (ignorado por git, no entró).
- Comprobé que `deploy/photo-bank/` solo contiene `manifest.json`, sin imágenes.
- Commiteé, hice push a `origin main` sin `--force`, y verifiqué el SHA en remoto.
- Reconstruí el grafo con `graphify` y escribí este reporte, que va en su propio commit.

## Verificación previa (ejecutada antes del commit)

```
git branch --show-current  →  main
packages/renderer        →  tests 21 · pass 21 · fail 0
packages/ui-components   →  tests 15 · pass 15 · fail 0
apps/platform            →  tests 76 · pass 74 · fail 0 · skipped 2
```

Las tres cifras coinciden con lo esperado en el encargo: 21 / 15 / 74 pass · 0 fail · 2 skipped.
El reporte de `platform` incluye los 5 casos del banco (`banco vacío devuelve []`,
`PHOTO_BANK_ROOT inexistente devuelve []`, `manifiesto corrupto devuelve []`,
`banco con 2 JPEG`, `archivo faltante → undefined sin lanzar`), todos en pass.

## Archivos publicados

| Archivo | Estado |
| --- | --- |
| `packages/ui-components/src/sections.tsx` | modificado |
| `packages/renderer/src/theme-css.ts` | modificado |
| `packages/ui-components/test/components.test.mjs` | modificado |
| `packages/renderer/test/theme.test.mjs` | modificado |
| `packages/renderer/package.json` | modificado |
| `deploy/photo-bank/manifest.json` | nuevo |
| `apps/platform/src/photo-bank.ts` | nuevo |
| `apps/platform/src/internal-photos.ts` | modificado |
| `apps/platform/test/photo-bank.test.mjs` | nuevo |
| `apps/platform/package.json` | modificado |

`apps/platform/package.json` no estaba en la lista del encargo pero entra porque es el
único cambio que añade `test/photo-bank.test.mjs` al script `test`; sin él, los 5 casos
nuevos del banco nunca se ejecutarían. Es un cambio de una línea y no toca dependencias.

## SHAs

- Commit de producto (T-014 + T-020): `ae974fe37fa7e59db24f46f8a6f1871e784956e1` (`ae974fe`)
  `feat(ui): el hero se compone sin foto y el banco de imágenes queda vacío`
- Commit anterior, base del release: `200aa9e` `docs(reports): release de T-011`
- `git ls-remote origin refs/heads/main` → `ae974fe37fa7e59db24f46f8a6f1871e784956e1`
- HEAD local, `origin/main` y remoto coinciden en `ae974fe` antes de este reporte.

## Grafo

- `graphify-out/graph.json`: **3442 nodos**, 5640 aristas, 235 comunidades (219 mostradas).
- Construido desde el commit `ae974fe3`, así que está fresco respecto del código publicado.

## Qué cambia en producto

- Un hero sin imagen ya no es texto sobre color plano: recibe la marca `hero--graphic` y se
  resuelve como portada de tipografía y geometría con los tokens del tema (titular con
  `clamp`, medida de 17ch, cuatro filetes verticales de `--ink` al 12 %, barra de `--accent`
  sobre el titular, semicírculo del acento hundido en la esquina). Un id de asset huérfano
  cuenta como hero sin foto, no como foto rota.
- Se retira el fondo anterior de dos degradados radiales con un cian escrito a mano
  (`#22d3ee`), que además no distinguía el hero con foto del que no la tiene.
- El banco local de fotos queda vacío a propósito: se retiraron las 24 imágenes de Picsum
  porque eran aleatorias y sus `alt` afirmaban «Interior de un negocio». Sin Pexels y sin
  banco, la ruta responde `200 { photos: [] }`, no 503 ni 500.

## Pendientes y riesgos (tomados del encargo; no re-verificados en esta ejecución)

- Los commits están firmados por `root`.
- El gateway sigue en 502.
- El banco de fotos está por curar: hay que llenarlo con fotos verificadas una a una.
- `docs/PLAN-VIABLE.md` sigue sin seguimiento a propósito; va en un commit aparte.

## Entrego a

lead (siguiente paso según el plan de T-014 y T-020, y los pendientes de arriba).
