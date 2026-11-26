# Reporte T-020 — release (claude-haiku-5-5)

- Fecha: 2026-11-26T20:26Z
- Resultado: DONE
- Commit publicado: `a2c0e0c3352d874ce3f2c5bcac527b8692b35945`
- Rama: `main` (sin rama nueva, sin PR, sin `--force`)

## Qué hice

- Verifiqué sobre `main` antes de tocar nada: rama, árbol de trabajo y ausencia de la clave
  de Unsplash en todo el repo.
- Corrí las cuatro verificaciones del encargo (tres suites y el typecheck del monorepo).
- Revisé el código de la release antes de commitear: `sector.ts`, `photo-bank.ts`,
  `internal-photos.ts`, `design-job.ts` y los dos archivos nuevos de prueba.
- Comprobé el banco en disco y en el zip: 37 fotos, 7 sectores, manifiesto de 37 entradas,
  `CREDITS.md`, y las 37 rutas del manifiesto existen como archivo.
- Preparé el commit con `git add` por ruta explícita: 49 archivos. Dejé fuera
  `docs/PLAN-VIABLE.md` (sigue sin seguimiento) y `apps/platform/ui-dist/` (ya ignorado
  por git, no entró).
- Hice push a `origin main` y verifiqué el SHA en remoto con `git ls-remote`.
- Reconstruí el grafo y escribí este reporte, que va en su propio commit.

## Verificación previa (ejecutada antes del commit)

```
git branch --show-current  →  main
clave 5Xyx7juGKl0VHn5spVoPswzXq3XFLf6qx9XyHH  →  0 coincidencias (repo e índice)
agents/design   →  tests 184 · pass 184 · fail 0
apps/workers    →  tests  34 · pass  34 · fail 0
apps/platform   →  tests  86 · pass  84 · fail 0 · skipped 2
pnpm typecheck  →  tasks 41 successful, 41 total
```

**Una cifra no coincide con el encargo y conviene saber por qué.** El encargo esperaba
agent-design **181**; salen **184**. No es un fallo: la suma por archivo da
170 previos + 11 de `sector.test.mjs` + 3 de `gallery-min.test.mjs`, y 170 + 11 = 181, que
es el número del encargo. Los 3 de más son de `gallery-min.test.mjs`, escrito a las 20:18,
después de que se fijara el 181. Ese archivo fija justo el mínimo de la galería
(3 fotos pintan la sección, 2 no), que es la limitación real del banco, así que lo publiqué
y usé el número real (184) en el mensaje del commit. Workers (34), platform (84 pass /
0 fail / 2 skipped) y typecheck coinciden exactamente con lo esperado.

Los 10 casos del banco en `platform` pasan, incluidos `salud landscape = 2`,
`salud square = 3` y `foto real del banco = JPEG > 25 KB, traversal rechazado`.

## Sobre el Dockerfile (punto 7 del encargo): no hubo nada que quitar

El encargo pedía quitar del `apps/platform/Dockerfile` el `COPY` y el `ENV` que metían las
fotos en la imagen. **No existen y nunca existieron**: `git log --all -p --
apps/platform/Dockerfile | grep -i photo` no devuelve una sola línea, y el archivo solo
tiene tres commits en su historia. El `Dockerfile` no cambia en esta release.

La consecuencia práctica es la misma que se buscaba —las fotos no viajan en la imagen— pero
la afirmación del mensaje de commit no podía ser «el Dockerfile pierde el COPY y el ENV»,
porque sería inventar un cambio. El commit dice lo que hay: el reparto de las fotos es el
zip, no la imagen.

Queda un rastro desactualizado que **no toqué** porque esta release no escribe código: la
cabecera de `apps/platform/src/photo-bank.ts` todavía dice que las fotos «llegan a
`/app/deploy/photo-bank` en la imagen Docker». Es un comentario, no comportamiento, y va
como pendiente abajo.

## Archivos publicados

| Archivo | Estado |
| --- | --- |
| `agents/design/src/sector.ts` | nuevo |
| `agents/design/src/agent.ts` | modificado (`fetchPhotos` recibe `sector`) |
| `agents/design/src/index.ts` | modificado (exporta `SECTORS`, `sectorForBrief`, `Sector`) |
| `agents/design/test/sector.test.mjs` | nuevo (11 casos) |
| `agents/design/test/gallery-min.test.mjs` | nuevo (3 casos) |
| `apps/platform/src/photo-bank.ts` | modificado (manifiesto por sector, raíz en el volumen) |
| `apps/platform/src/internal-photos.ts` | modificado (banco primero, Pexels de respaldo) |
| `apps/platform/test/photo-bank.test.mjs` | modificado (10 casos del banco) |
| `apps/workers/src/design-job.ts` | modificado (manda el sector del brief) |
| `deploy/photo-bank/unsplash/` | nuevo: 37 JPEG + `manifest.json` + `CREDITS.md` |
| `deploy/unsplash-bank.zip` | nuevo, 8.16 MB (`unsplash/` con 39 archivos) |
| `docs/reports/T-020/release.md` | este reporte (commit aparte) |

## El banco, comprobado archivo por archivo

```
despacho   5   (2 landscape, 3 square)
hosteleria 7   (3 landscape, 4 square)
comercio   5   (2 landscape, 3 square)
salud      5   (2 landscape, 3 square)
taller     5   (2 landscape, 3 square)
belleza    5   (2 landscape, 3 square)
neutro     5   (2 landscape, 3 square)
total     37
```

- Manifiesto: 37 entradas; las 37 apuntan a un archivo que existe.
- Procedencia completa en las 37: autor, perfil, página de la foto y `download_location`;
  el `utm_source=zottaweb&utm_medium=referral` está en el perfil y en la página de las 37.
- Zip: `unsplash/` en la raíz del archivo, con `manifest.json`, `CREDITS.md` y las 37 fotos.

Dónde se lee en producción: `bankRoot()` usa `PHOTO_BANK_ROOT` si está; si no, con
`NODE_ENV=production` cae en `libraryRoot()`, que es `MEDIA_LIBRARY_ROOT` o
`/data/biblioteca` por defecto. El manifiesto se lee de `<raíz>/unsplash/manifest.json`,
que es exactamente cómo descomprime el zip. En desarrollo se lee del repo.

## Grafo

- `graphify-out/graph.json`: **3511 nodos**, 5760 aristas, 238 comunidades, construido
  desde `a2c0e0c3352d874ce3f2c5bcac527b8692b35945` (el commit de esta release).
- Antes de esta release el grafo tenía 3442 nodos: +69 por la biblioteca, el código y las
  pruebas nuevas.

## Pendientes y riesgos (tomados del encargo; no re-verificados en esta ejecución)

- Los commits siguen firmados por `root` (`root <root@927ff6249af8>`); no hay `user.name`
  ni `user.email` configurados en el repo, así que git los deduce del host.
- **Hay que subir `deploy/unsplash-bank.zip` al servidor y descomprimirlo en la raíz de
  medios (`/data/biblioteca`)**, o el banco saldrá vacío en producción. El zip descomprime
  como `unsplash/`, que es donde el código lo busca.
- La galería sale con 3 fotos en vez de 4 en seis sectores, porque el banco no tiene cuatro
  fotos cuadradas por sector; solo `hosteleria` tiene 4.
- Queda pendiente la caché de Unsplash para cuando el banco no cubra una búsqueda.

## Pendientes añadidos en esta ejecución

- El comentario de cabecera de `apps/platform/src/photo-bank.ts` sigue describiendo las
  fotos dentro de la imagen Docker; hay que corregirlo a la instalación por volumen.
- `docs/runbooks/despliegue.md` no documenta todavía el paso de descomprimir el zip en
  `/data/biblioteca`; solo habla de `MEDIA_LIBRARY_ROOT` como caché de Pexels.
- El banco raíz `deploy/photo-bank/manifest.json` se queda vacío a propósito y ya no se lee;
  sigue en el repo sin uso.
- `docs/PLAN-VIABLE.md` sigue sin seguimiento a propósito; va en un commit aparte.

## Entrego a

lead (con el pendiente crítico de descomprimir el zip en el servidor antes de dar la
biblioteca por viva en producción).
