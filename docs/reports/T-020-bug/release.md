# Reporte T-020-bug — release (claude-haiku-5-5)

- Fecha: 2026-11-26T21:08Z
- Resultado: DONE
- Commit de código publicado: `40d963e378cf60839ba830af3287e92fd5144f61`
- Base: `42e5aca` (`main`)
- Rama: `main` (sin rama nueva, sin PR, sin `--force`, sin `reset --hard`)

## La causa, confirmada

`authorizeAgent` (`apps/platform/src/internal-photos.ts`) leía `row.siteId` del resultado de
`app_agent_token_check`, pero `pg` devuelve la columna con el nombre que pone el SQL, sin
alias. Con `SELECT run_id, user_id, site_id` la fila llega como `{ run_id, user_id, site_id }`,
así que `row.siteId` era `undefined`, la comparación `row.siteId !== siteId` daba siempre
verdadera y **toda petición con token válido respondía 404 `not_found`**. El worker convertía
cualquier no-2xx en lista vacía sin registrar nada: el fallo era invisible desde el primer día,
también con Pexels configurado.

Lo reproduje fuera del test con la propia función que usa la prueba para imitar a `pg`:

```
consulta antigua → {"run_id":"R","user_id":"U","site_id":"S"} → row.siteId = undefined
```

## Qué se publicó

1. **El arreglo** (`apps/platform/src/internal-photos.ts`): alias explícito en el `SELECT`
   (`run_id AS "runId", user_id AS "userId", site_id AS "siteId"`) y comentario con el porqué.
   Revisé los demás accesos a filas del archivo: los de las líneas 178-179 (`source_url`,
   `credit_text`) ya van en snake_case a propósito y no tocan este resultado.
2. **Instrumentación del worker** (`apps/workers/src/design-job.ts`): `design_photos_http_error`
   (con `siteId`, url, orientation, count, `status` y cuerpo recortado a 300), 
   `design_photos_bad_payload`, y `design_photos_request_failed` con `name`, `message` y `cause`
   (`code` o `message` del `cause`). La URL no lleva el token —va en la cabecera— y la cabecera
   nunca se registra.
3. **Instrumentación de platform**: `internal_photos_denied { siteId, status, error }` cuando
   `authorizeAgent` rechaza.
4. **Pruebas nuevas**: `apps/platform/test/internal-photos.test.mjs` (banco en `/tmp`, pool falso
   que reconstruye las claves de columna desde el propio SQL, 1 hero + 4 de galería, y 401
   registrado sin el token) y dos en `apps/workers/test/design-job.test.mjs` (un no-2xx y una
   excepción quedan registrados, sin token). `apps/platform/package.json` incorpora la prueba a
   `pnpm test`.

**Las dos pruebas que dependen del alias fallan si se revierte el SQL**, porque el pool falso
deriva las claves del texto del `SELECT`: sin `AS "siteId"` la fila vuelve con `site_id` y
`authorizeAgent` da 404. Comprobado el mecanismo, no supuesto.

## Verificación (antes del commit, sobre `main`)

```
git branch --show-current            →  main
clave del encargo en todo el repo    →  0 coincidencias
apps/platform                        →  tests 89 · pass 87 · fail 0 · skipped 2
apps/workers                         →  tests 36 · pass 36 · fail 0
agents/design                        →  tests 184 · pass 184 · fail 0
pnpm typecheck                       →  41 successful, 41 total
```

Las cuatro cifras coinciden con lo esperado en el encargo. `apps/platform` corre 89 pruebas
en 87 pass + 2 skipped, que es la misma cuenta que el encargo pide como «87 pass».

## Preparación del commit

`git add` por ruta explícita, cinco archivos:

```
apps/platform/package.json
apps/platform/src/internal-photos.ts
apps/platform/test/internal-photos.test.mjs   (nuevo)
apps/workers/src/design-job.ts
apps/workers/test/design-job.test.mjs
```

Quedan fuera, como pedía el encargo: `docs/PLAN-VIABLE.md` (sigue sin seguimiento) y
`apps/platform/ui-dist/` (ya ignorado por git en `.gitignore:12`, no podía entrar).

## Push

```
git push origin main   →  42e5aca..40d963e  main -> main
git ls-remote origin main → 40d963e378cf60839ba830af3287e92fd5144f61  refs/heads/main
git rev-parse HEAD        → 40d963e378cf60839ba830af3287e92fd5144f61
```

Local y remoto coinciden.

## Grafo

- `graphify-out/graph.json`, construido desde `40d963e378cf60839ba830af3287e92fd5144f61`
  (el commit del arreglo): **3544 nodos**, 5791 aristas, 235 comunidades.
- Con este reporte encima, el grafo queda en **3554 nodos**, 5802 aristas y 242 comunidades,
  construido desde `774b555`; los 10 nodos de más son el propio reporte.
- Antes de esta release el grafo estaba en **3522 nodos / 5773 aristas** (cierre de T-020):
  **+32 nodos y +29 aristas** hasta el estado publicado ahora.

## Pendientes y riesgos (tomados del encargo; no re-verificados en esta ejecución)

- Los commits siguen firmados por `root` (`root <root@927ff6249af8>`), committer incluido: no
  hay `user.name` ni `user.email` en el repo y git los deduce del host.
- **Además del código, en producción hay que corregir `PLATFORM_INTERNAL_URL` en el servicio
  `workers`**: hoy apunta a `http://q7sdp3weaophpdzspqwcq8ws:3000`, que no resuelve
  (`wget: bad address`), y debe ser `http://platform:3000`, que responde `{"status":"ok"}`.
  Sin esto el arreglo llega pero las fotos siguen sin pedirse al host correcto.
- El gateway sigue devolviendo 502 y hay que redesplegarlo para ver el motivo real.

## Entrego a

lead (con el pendiente de `PLATFORM_INTERNAL_URL` en el servicio `workers` antes de dar las
fotos por vivas en producción).
