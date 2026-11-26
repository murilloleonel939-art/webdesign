# Reporte T-022 — release (claude-haiku-5-5)

- Fecha: 2026-11-26T23:18Z
- Resultado: DONE
- Commit de código publicado: `069657dfa9e496e4a1ffacc1b9e31dcd6ec3a214`
- Base: `10ae007` (`main`)
- Rama: `main` (sin rama nueva, sin PR, sin `--force`, sin `reset --hard`)

## Verificación

```
git branch --show-current   →  main
agents/design               →  tests 189 · pass 189 · fail 0
pnpm typecheck              →  41 successful, 41 total (exit 0)
```

El typecheck no fue un acierto de caché: `36 cached, 41 total`, compiló las cinco tareas
afectadas. Las cifras coinciden con lo que pedía el encargo.

## Qué se publicó

1. **`agents/design/src/draft.ts`** — `/servicios` entra en la tabla de páginas con
   `gallery` (`["hero", "features", "process", "gallery", "cta"]`). Las páginas interiores
   reciben un `innerPhotos` sin `hero`, así que su hero sale con portada gráfica en vez de
   repetir la foto principal. Y se añade a `usedPhotos` las fotos de galería cuando la
   portada no tiene galería y `/servicios` sí: antes se descargaban y no se declaraban.
2. **`agents/design/src/plan.ts`** — la misma página en el plan, y la galería pasa a
   justificarse con `fotos_de_la_busqueda` (igual que el landing), no con el preset.
3. **`agents/design/test/site-gallery.test.mjs`** (nuevo, 5 casos) — la tabla exacta, que
   solo el hero de la portada lleva `image`, que plan y documento coinciden página a
   página, que con 2 fotos de galería la sección no se crea, y que el landing no cambia.

Revisé el diff, no solo el verde de las pruebas. El empuje duplicado que sospeché no
existe: el `usedPhotos.push` de la línea 297 vive en la rama `landing`, y las páginas del
sitio pasan por `buildPage`, que no registra galería. Por eso `doc.assets` sale con cuatro
ids y sin repetir, que es lo que afirma la prueba.

## Lo que las pruebas fijan

Con galería de 3 fotos: `/` → `["asset-1"]`, `/servicios` → `["asset-2","asset-3","asset-4"]`,
`/sobre-nosotros` y `/contacto` → `[]`, total 4 imágenes, 4 ids distintos, y
`doc.assets` = los mismos 4. El landing: una página, cuatro imágenes.

## Una cifra del mensaje que no siempre se sostiene

El commit dice «el sitio usa las cuatro fotos», y eso es cierto con **3** fotos de galería.
Pero `loadPhotos` pide **4** cuadradas (`agents/design/src/agent.ts:448`,
`count: 4`), y la sección de galería pinta **todas** las que lleguen
(`assetIds: photos.gallery.map(...)`, `agents/design/src/draft.ts:109`): `GALLERY_MIN = 3`
es un mínimo, no un tope. Con una búsqueda que devuelva 4 cuadradas, `/servicios` pinta 4
y el sitio muestra **5** imágenes, no 4.

No es un fallo del arreglo, es una cifra optimista: las cinco serían únicas, ninguna
repetida y nada descargado quedaría sin mostrar, que es lo que T-022 venía a resolver.
Pero el número del mensaje solo se cumple en el caso de 3. Ya está publicado y reescribir
historia no es una opción aquí, así que queda como pendiente decidir cuál de los dos lados
se ajusta: cortar la galería a 3 en la sección, o pedir 3 en `loadPhotos`.

## Otro caso residual, este ya decidido

Con 2 fotos de galería la sección no se crea (mínimo 3) y esas dos no se declaran: el
documento sale solo con el hero. Se descargan y no se muestran, o sea la misma clase de
desperdicio que T-022 arregla para el caso de 4. No lo presento como descuido: la prueba
«site con 2 fotos de galería» lo fija a propósito, así que es una decisión, y conviene
saber que existe.

## Pendientes

1. **Commits de `root` sin firma GPG.** `%G?` da `N`, igual que todo el historial.
2. **La cifra «cuatro»** descrita arriba: con 4 fotos de galería el sitio muestra 5.
   Decidir si se corta en la sección o en la búsqueda.
3. **El caso de 2 fotos** descargadas sin mostrar.
4. **No verifiqué el efecto en producción.** No desplegué ni consulté el sitio: esto es un
   `git push`, y lo que afirmo sale de las pruebas y del código, no de un sitio real.
5. `docs/PLAN-VIABLE.md` sigue sin commitear a propósito.

## Grafo

3588 nodos tras la reconstrucción automática posterior al commit («grafo» = nodos de
`graphify-out/graph.json`, que no se versiona).
