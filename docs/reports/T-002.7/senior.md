# Reporte T-002.7 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T15:48Z
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - **Fix A:** la ronda de resumen recibe solo herramientas con `mutates: false`; el modelo ya no puede tocar el sitio desde ahí.
  - **Fix B:** instantánea del documento verificado antes del resumen, descarte del cambio con aviso `resumen_intento_mutar`, y `assertDeliverable` (esquema + red del marcador) antes de devolver.
  - **Fix C:** el `businessName` del modelo pasa por `briefValueOk` antes de convertirse en el nombre público.
  - **Fix E:** el titular compuesto se recorta al máximo del copy (90) con el mínimo de 8 respetado; el copy genérico vuelve a pasar su propio esquema.
  - **Fix F:** el origen de cada sección se decide por **contenido** comparado con el genérico, no por si había copy del modelo. `hero`, `cta`, `features`, `process`, `faq`, `text` y las añadidas por completitud.
- Archivos tocados: `agents/design/src/agent.ts`, `agents/design/src/draft.ts`, `agents/design/src/plan.ts`, `agents/design/src/generic-copy.ts`, `agents/design/test/acceptance.test.mjs` y `agents/design/test/copy.test.mjs`. **No** toqué `packages/agent-sdk`, `tools.ts` (no hizo falta: `get_site` ya es `mutates: false`) ni la migración 0009.

## Fix A — la ronda de resumen no puede mutar

Confirmé el agujero en el código antes de tocar nada: `packages/agent-sdk/src/loop.ts:101` ejecuta **todas** las `toolCalls` de la ronda, y `maxRounds` solo limita rondas. Con `makeDesignTools(store)` en esa llamada, un `update_section` del resumen escribía en `store.doc`, que se devolvía después sin volver a pasar por guardia, red, completitud ni linters.

Ahora: `const readOnlyTools = makeDesignTools(store).filter((tool) => !tool.mutates)`. Solo queda `get_site`, que es justo lo que el resumen puede necesitar (mirar el sitio) y no lo modifica. El `beforeMutation` de esa ronda sigue en el código: sin herramientas que muten no se dispara nunca, y lo dejé para no tocar más de lo necesario.

## Fix B — revalidar lo que se entrega

1. `const verified = structuredClone(store.doc)` **antes** de `runAgent`.
2. Al terminar, si `JSON.stringify(store.doc) !== JSON.stringify(verified)`, se restaura la instantánea y se añade el aviso `resumen_intento_mutar` (visible en el panel).
3. `assertDeliverable(doc)` antes de devolver: `validateSiteDocument` + `containsMarker`. Si no pasa, lanza `documento no entregable: …` en vez de entregar algo sin verificar.

## Fix C — nombre del negocio

`docName` aplica `briefValueOk` al `businessName` del modelo. Lo que escribió el **dueño** se conserva tal cual (decisión de T-002.5, ya afirmada en una prueba): es un dato identificativo, no una afirmación redactada por nosotros. Lo que deduce el **modelo** sí pasa por la guardia. En mi primer intento apliqué el filtro también al nombre del dueño; la prueba existente lo detectó, lo revertí y lo dejé como estaba.

## Fix D — `design.brief`: **no se publica**. Evidencia

Investigado, sin cambiarlo. La cadena completa:

| Pieza | Qué hace con `design.brief` | Evidencia |
| --- | --- | --- |
| `packages/renderer/src/index.ts` | **No lo usa.** El HTML se monta con `doc.meta`, `doc.theme`, `doc.pages[].seo` y `doc.pages[].sections`. La cadena `design` no aparece en el archivo. | `grep -n design packages/renderer/src/index.ts` → solo el import de tipos |
| `packages/publish/src/index.ts` | Lo que va a disco son los **HTML renderizados**: `files[slugToFile(page.slug)] = rendered.get(page.id)` → `publishRelease(sitesRoot, ...)`. | líneas 140-141 y 189 |
| `packages/publish/src/index.ts` | El documento completo (con `design.brief`) se guarda en la columna `site_versions.doc` (JSONB), en la base de datos. | línea 193 |
| `apps/platform/src/server.ts` | El borrador se sirve en `/api/sites/:id/draft` con **sesión obligatoria** (401 sin ella) y `loadDraft(pool, session.userId, siteId)`: solo el dueño. | `draftMatch`, línea 623, y el bloque que sigue |
| `apps/platform/ui/panel.tsx` | Lee `doc.design.idea`, no `design.brief`. | línea 321 |
| `packages/puck-adapter`, `apps/platform/src/catalog.ts` | Propagan `design` dentro del propio documento; no lo publican por otra vía. | `design: doc.design`, `...doc.design` |

**Conclusión:** `design.brief` no llega al HTML publicado ni a ningún archivo del sitio; solo se guarda en el documento del borrador y de la versión, que ve el dueño autenticado. Es aceptable y **se deja como está**. Queda documentado aquí, como pediste. Si en el futuro se publica el JSON del documento (una API pública, un export), este campo pasa a ser una fuga y habría que quitarlo.

## Fix E — el titular compuesto se pasaba de largo

Reproducido: `businessType` de 120 + `city` de 80 daba un titular de **204** caracteres y `draftSite` abortaba con `props invalid for hero: Too big: expected string to have <=120 characters`. Además, el copy genérico **no pasaba su propio esquema** (`siteCopySchema`: businessType ≤ 60, heroHeadline ≤ 90, aboutHeading ≤ 80, seoDescription ≤ 155).

Arreglado en `generic-copy.ts`, que es donde se compone el titular: un `cut` local recorta `heroHeadline` (90, mínimo 8 respetando la frase fija), `businessType` (60), `aboutHeading` (80), `heroSubline` (220), `aboutBody` (700) y `seoDescription` (155), todos con los límites de `COPY_LIMITS` que ya exporta `copy.ts`. Mantuve además el recorte defensivo a 120 en `copySection` (`draft.ts`), que protege si el titular llegara por otra vía.

Resultado con el caso extremo: titular de 90, copy que **pasa `siteCopySchema`**, y `draftSite` entrega el documento.

## Fix F — `closePlan` atribuía al dueño lo que era plantilla

El origen se decidía por **procedencia** (`copy !== undefined`), así que una sección que `completeCopy` había sustituido por la genérica —o un modelo que devolvió justo los textos fijos— se marcaba `copy_del_dueno`. Ahora `originOf(type, text, generic)` compara el contenido con `genericCopy(brief)` y decide por contenido. Se aplica a `features`, `text`, `process`, `faq`, `hero`, `cta` y a las canónicas añadidas por `closePlan` (`completitud_copy_generico` / `completitud_copy_del_dueno`).

Dos casos que la prueba destapó y que he separado a propósito:
- **`contact`** no es texto del copy: muestra el dato del dueño. Su motivo pasa a `contacto_del_dueno` o `copy_generico`, en vez de heredar el del `aboutBody`, que no tenía nada que ver.
- **`cta`** se juzga por su propio `closingHeadline`/`closingCta`, no por el párrafo.

## Pruebas

**Las cinco del encargo, escritas en esta pasada** (no existían tras el corte):

1. `update_section` en la ronda de resumen con texto inventado → el documento **no** contiene «900 clientes».
2. `remove_section` en la ronda de resumen → la sección `s_features` sigue en el documento entregado.
3. Control sin llamadas → las páginas entregadas son **idénticas** a las del borrador con el mismo copy, y no aparece el aviso `resumen_intento_mutar`.
4. `businessName` del modelo con reclamo y dueño sin nombre → ni `meta.name` ni `seo.title` llevan «nº1».
5. Fix E y Fix F: cinco pruebas más (recorte del titular con 120+80, control de que un nombre corto no se toca, sección de plantilla no atribuida al dueño, control de que el texto propio sí se atribuye, y el `contact`/`cta` con su propio motivo).

**Comprobé que son rojos reales, no pruebas decorativas:**

| Configuración | Resultado |
| --- | --- |
| Sin Fix A ni Fix B | **fallan** los casos de `update_section` y `remove_section` (3 fail) |
| Solo Fix B (herramientas mutables + instantánea + descarte) | **17/17 pasan**: la defensa en profundidad aguanta sola aunque A se rompa |
| Con A y B (estado entregado) | 17/17 |

Después restauré `agent.ts` (`diff` idéntico al que tenía) y recompilé.

**Ninguna prueba existente cambiada.** Las 105 anteriores siguen pasando sin tocarlas; ahora son 113.

## Verificación (`pnpm turbo run build --force`, paquete y raíz)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **113 tests, 113 pass, 0 fail** (105 + 8).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **438 tests: 431 pass, 0 fail, 7 skipped**.
- Los 7 skipped son los archivos de integración con Postgres (db 2, assets 1, editor 1, publish 1, platform 2): sin Postgres no ejecutan, y así lo cuenta ahora el runner (ADR 0003). **Sin verificar en esta máquina.**
- Nota: la raíz ya no está como la dejé en T-002.6 (429/0/0) por los cambios de T-009 en otros paquetes, como avisaste: `git status` muestra modificadas pruebas de `db`, `assets`, `editor`, `publish` y `platform`, más `packages/publish/package.json`. **No son mías**; no toqué nada fuera de `agents/design`.

## Pendientes y riesgos

- `design.brief` y el nombre del dueño conservan texto libre/identificativo en el documento del borrador y de las versiones. Aceptado y documentado (Fix D). Si algún día se expone el JSON del documento, hay que revisarlo.
- `assertDeliverable` **lanza**: un documento que llegue roto a ese punto tumba la ejecución en vez de publicarse. Es lo que pediste («lanza un error claro en vez de entregar algo no verificado»), pero conviene saberlo: no repara, señala.
- El aviso `resumen_intento_mutar` en el panel indica que el modelo intentó escribir fuera de su turno. No es un error del dueño ni de los datos; es un aviso de seguridad para que se vea.
- No hice commit.

- Entrego a: testing (revisión desde cero; seguridad después, solo con PASS)
- Referencias:
  - `agents/design/src/agent.ts` (`readOnlyTools`, `verified`, `assertDeliverable`)
  - `agents/design/src/draft.ts` (`docName`, recorte del titular)
  - `agents/design/src/plan.ts` (`originOf`, `closePlan`, `sectionOrigin`)
  - `agents/design/src/generic-copy.ts` (`cut`, `COPY_LIMITS`)
  - `agents/design/test/acceptance.test.mjs` (bloque «T-002.7»)
  - `agents/design/test/copy.test.mjs` (bloques «Fix E» y «Fix F»)
  - `packages/renderer/src/index.ts`, `packages/publish/src/index.ts`, `apps/platform/src/server.ts`, `apps/platform/ui/panel.tsx` (evidencia del Fix D, solo lectura)
  - `/tmp/t27-build.log`, `/tmp/t27-pkg.log`, `/tmp/t27-test.log` (efímeros)
