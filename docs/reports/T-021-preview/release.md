# Reporte T-021-preview — release (claude-haiku-5-5)

- Fecha: 2026-11-26T22:17Z
- Resultado: DONE
- Commit de código publicado: `8527430110ccfc6acfe69ba292d360ccd12e2b51`
- Base: `347665c` (`main`)
- Rama: `main` (sin rama nueva, sin PR, sin `--force`, sin `reset --hard`, sin borrar ramas)

## Qué se publicó

1. **`packages/preview/src/index.ts`** — tres funciones nuevas (`newAssetSigningKey`,
   `signAssetUrl`, `verifyAssetUrl`) sobre el `sign()` que ya existía. La firma ata
   `kind: "asset"`, `siteId`, `assetPath` exacto y `exp`; caducidad de 15 minutos. No se
   tocó ninguna firma previa: los enlaces de vista previa funcionan igual.
2. **`apps/platform/src/server.ts`** — la vista previa deja de incrustar base64: el `src`
   pasa a `/assets/<siteId>/<ruta>?pv=<firma>`. La rama `pv` va dentro del manejador de
   `/assets/`, solo se alcanza con `GET` ya comprobado, lee una ruta fija y responde `404`
   ante cualquier fallo, sin distinguir firma mala de asset inexistente. La rama normal
   (con sesión y control de dueño) queda igual: el sitio publicado sigue sirviendo sin
   firma. El cuerpo del envío de fichero se extrajo a `sendAssetFile`, usado por las dos
   ramas. El `alt` de la vista previa se lee ahora de `doc.assets`, la misma fuente que la
   publicación, en vez de `""` fijo.
3. **Pruebas** — `packages/preview/test/preview.test.mjs` (+ firma, sitio, ruta, caducidad),
   `apps/platform/test/preview-assets.test.mjs` (nuevo, extremo a extremo) y una regresión
   de `alt` en `apps/platform/test/cycle.test.mjs`. `apps/platform/package.json` incorpora
   la prueba nueva a `pnpm test`.

## Verificación (sobre `main`, antes del commit)

```
git branch --show-current            →  main
grep de la clave del encargo         →  0 coincidencias
packages/preview                     →  tests 16 · pass 16 · fail 0
packages/renderer                    →  tests 21 · pass 21 · fail 0
apps/platform                        →  tests 90 · pass 87 · fail 0 · skipped 3
pnpm typecheck                       →  41 successful, 41 total (exit 0)
```

Las cifras coinciden con lo que pedía el encargo. Las 3 omitidas son los tres ficheros
gateados por `DB_TEST_URL` (`otro-sitio-activo`, `cycle`, `preview-assets`).

## Comprobado aparte: la firma casa con la ruta

El test extremo a extremo nuevo **no llegó a ejecutarse** aquí: no hay Postgres ni docker
en esta máquina, así que sale por la rama skip igual que los otros dos. Para no publicar
sobre una prueba omitida verifiqué el mecanismo por fuera del repo, contra `dist`:

```
ruta casa (/^\/assets\/<uuid>\/(image|video|poster)\/<file>$/)   →  true
relative de la ruta === assetPath firmado                        →  true
firma valida en su sitio y su ruta                               →  true
otro sitio / otra ruta / otro kind                               →  rechazados
token manipulado, vacio, basura, sin punto                       →  rechazados
valida a los 15 min exactos · caducada a los 15 min + 1 s        →  true / true
enlace de vista previa usado como ?pv=                            →  rechazado
clave efimera de un proceso usada en otro                         →  rechazada
```

El punto que importaba: `known.path` (lo que se firma) y `relative` (lo que extrae el
patrón de la URL) son la misma cadena, `image/<fichero>`. Si no lo fueran, cada URL firmada
daría 404 en silencio; lo comprobé, no lo supuse.

## Encargo 2 — NO aplicado, y por qué

Había que quitar `data:` de `PREVIEW_CSP`. **No lo quité**: hay una prueba que depende de
él.

- `apps/platform/test/preview-isolation.test.mjs:103-109`, «la vista previa permite las
  imagenes incrustadas», afirma
  `assert.match(r.headers["content-security-policy"] ?? "", /img-src[^;]*data:/)`.

Quitarlo la rompe, así que según el encargo lo dejo y lo digo. Esa prueba y su comentario
describen el mecanismo viejo (incrustar base64) que este cambio retira: la limpieza
razonable es darle la vuelta al assert (que `img-src` **no** lleve `data:`) y solo entonces
recortar la cabecera. No toqué ni la prueba ni la CSP: publicar código y sus pruebas
cambiando la prueba a la vez es justo lo que un release no debe hacer.

## Pendientes

1. **Commits firmados por `root`… pero sin firma GPG.** `%G?` da `N` en este commit y en
   todo el historial. El autor es `root <root@927ff6249af8>`; no hay firma criptográfica.
   Lo digo tal cual para que nadie lea «firmado» como «verificado».
2. **Gateway: medido 200, no 502.** El encargo daba por hecho que seguía en 502. El
   2026-11-26T22:16Z responde `GET https://zottaweb.site/healthz` → 200
   `{"status":"ok"}` y `GET /app/` → 200 (`/` y `/login` dan 404 en ese host). No
   redesplegué nada: solo hice push. No pude confirmar que lo desplegado sea este código;
   para eso hace falta un despliegue, no un `git push`.
3. **`activeAssets` sigue cargando todos los assets en memoria en cada render de la vista
   previa.** Confirmado: `apps/platform/src/api.ts:193-195` construye `assetFilesById`
   leyendo cada fichero, y tras este cambio `server.ts` ya no lo usa (solo aparece en
   `api.ts`). Es coste puro: pendiente quitarlo o hacerlo perezoso.
4. **8 fallos preexistentes en `cycle.test.mjs` con Postgres real**, ajenos a este cambio.
   Vienen del encargo; aquí no se pueden reproducir por falta de base de datos.
5. **Discriminador de un solo sentido.** `verifyAssetUrl` exige `claims.kind === "asset"`,
   así que un enlace de vista previa no vale como `?pv=` (comprobado). Al revés no:
   `verifyPreviewToken` no mira `kind`, de modo que un token de asset pasa por enlace de
   vista previa con `pageId` `undefined` → `renderPreview` devuelve `undefined` → **404**.
   Sin exposición de datos, pero el comentario del código promete una separación en los dos
   sentidos que solo se cumple en uno. Endurecerlo es un cambio aparte.
6. **`docs/PLAN-VIABLE.md` queda sin commitear** a propósito. `apps/platform/ui-dist/` está
   ignorado por git, así que no entra.

## Grafo

3573 nodos tras la reconstrucción automática posterior al commit («grafo» = nodos de
`graphify-out/graph.json`, que no se versiona).
