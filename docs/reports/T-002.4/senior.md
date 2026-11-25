# Reporte T-002.4 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T14:44Z
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - Reproduje los cuatro hallazgos antes de tocar nada, con el script de testing (`node --test /tmp/t002-independent.mjs`): 6 pass / **4 fail**. Al terminar, 9 pass / 1 fail, y el que falla es una expectativa de ese script que **contradice el Fix C** (ver «Discrepancia»).
  - **Fix A:** el marcador se detecta por subcadena y sin distinguir mayúsculas en `normalizeBrief`, en `guardCopy` y en una red final dentro de `draftSite`.
  - **Fix B:** las cifras se comparan por token completo, no por subcadena. **Fix C:** `CLAIM` con las flexiones explícitas que ordenaste. **Fix D:** todo valor del brief pasa por el predicado de la guardia antes de interpolarse.
  - **Un quinto punto** que encontré al probar el Fix D: el respaldo del titular dentro de `guardCopy` restauraba el reclamo. Está corregido y lo explico abajo.
- Archivos tocados:
  - `agents/design/src/copy.ts` (`CLAIM`, `NUMBER`, `ownerNumbers`, `hasInvention`, `briefValueOk`, respaldo de `heroSubline`).
  - `agents/design/src/brief.ts` (`containsMarker`; `normalizeBrief` descarta una `description` con el marcador).
  - `agents/design/src/draft.ts` (`copySection` con red final, `hasMarker`, `safeText`, `heroHeadline`, `meta.name`, SEO, `design.brief`, `design.idea`, `alt`, comprobación final).
  - `agents/design/src/generic-copy.ts` (`publishable`; el tipo, la ciudad, el nombre y el servicio pasan por el predicado).
  - `agents/design/test/copy.test.mjs` (+15 pruebas).
  - `brief.ts` no estaba en la lista de T-002.3, pero el Fix A pedía expresamente tocar `normalizeBrief`. `plan.ts` y `agent.ts` no se tocaron.

## Fix A — el marcador no llega nunca al documento

Tres capas, de dentro afuera. La primera es la que faltaba; la tercera no depende de las otras dos.

1. **`normalizeBrief`:** una `description` que **contenga** el marcador se considera no aportada y se omite del brief. Antes bastaba con que no fuera exactamente igual, así que «Horario pendiente de confirmar.» entraba como dato del dueño.
2. **`guardCopy`:** `hasInvention` devuelve `true` si el texto contiene el marcador, en mayúsculas o minúsculas. Se aplica a todos los campos que pasan por la guardia, así que un `aboutBody` que lleve la frase dentro se poda como cualquier invento.
3. **Red final en `draftSite`:** `copySection` construye la sección y comprueba su `props`; si contiene el marcador, **rehace la sección entera** con `genericCopy` y, si tampoco queda limpia, la omite. También se aplica a `meta.name`, `seo.title`, `seo.description`, `design.brief`, `design.idea` y al `alt` de las fotos. Y antes de devolver el documento hay una comprobación final que lanza si algo se coló: prefiero un error explícito a publicar el marcador.

El helper `containsMarker` vive en `brief.ts`, junto al marcador, porque lo necesitan las tres capas.

## Fix B — cifras por token, no por subcadena

- `NUMBER = /\d+([.,]\d+)?/g` es la misma regex para el texto del modelo y para el corpus del dueño.
- `ownerNumbers(brief)` extrae un **conjunto de tokens** de los seis campos. `hasInvention` exige que el token del texto esté en ese conjunto: igualdad exacta, sin `includes`.
- Resultado: `name: "Café 2019"` ya no avala «Tenemos 19 sucursales.» (`19` ≠ `2019`), y `description: "abrimos en 2019"` sí conserva «Desde 2019 te atendemos.».
- El mismo criterio cubre el caso `20000` / `2000`, que añadí como prueba.

**Riesgo residual, y no es mío resolverlo aquí:** comparar tokens sigue permitiendo cambiar el **significado** de una cifra. Si el contacto lleva «24», el modelo puede escribir «Entrega en 24 horas» y la guardia lo acepta. Es el hallazgo 1 de seguridad y el encargo pedía exactamente esta comparación por token; vincularlo al campo y al contexto es otro cambio.

## Fix C — regex exacta

Implementada **literalmente** la que enviaste, incluidos los `\b` en los dos extremos:

```
\b(clientes satisfechos|años de experiencia|anos de experiencia|premiad[oa]s?|certificad[oa]s?|certificaci[oó]n(es)?|garantizad[oa]s?|l[íi]der(es)?|n[ºo°]\s*1)\b
```

Antes de escribirla la probé contra las 22 formas: **ninguna queda mal**, así que no tuve que parar por ese motivo.

| Se podan (10) | No se podan |
| --- | --- |
| premiado, premiados, certificado, certificaciones, garantizado, líder, líderes, nº1, clientes satisfechos, años de experiencia | liderar, coliderar, certificar, «Ana se encarga de liderar las reuniones.», «Taller de liderazgo…», «Atendemos por la mañana.», «Tostamos el grano en casa» |

Comprobé también que las mayúsculas con tilde funcionan (`LÍDER`, `CERTIFICACIÓN`, `AÑOS DE EXPERIENCIA`) y que «Lideresa» no se poda.

## Discrepancia con el script de testing: no la he «arreglado»

`/tmp/t002-independent.mjs` mantiene la tabla de su reporte original y espera **lo contrario** del Fix C en tres formas:

| Forma | Script de testing espera | El Fix C ordena (y hace el código) |
| --- | --- | --- |
| `certificaciones` | que **no** se pode | que **sí** se pode |
| `liderar` | que **sí** se pode | que **no** se pode |
| `liderazgo` | que **sí** se pode | que **no** se pode |

No he tocado la regex para satisfacer esas expectativas: son anteriores al encargo y el Fix C las deroga expresamente («No deben podarse … liderar, coliderar, certificar»; «deben podarse … certificaciones»). Si el lead quiere lo del script, es cambiar una línea del patrón y volver a calibrar. El script está fuera del repo, así que no lo modifiqué.

## Fix D — ningún valor del brief entra en una plantilla sin el predicado

- Nuevo predicado público `briefValueOk(value, brief)` en `copy.ts`: es **el mismo** `hasInvention` que usa la guardia, más el marcador. No hay dos políticas.
- `generic-copy.ts`: el tipo de negocio, la ciudad, el nombre y el servicio se filtran antes de interpolarse. Si el tipo no pasa, `businessType` cae a «negocio local», el encabezado a «Quiénes somos» y el «about» y el SEO salen sin el tipo dentro. **No se sanea recortando palabras:** o el dato pasa entero, o no se usa.
- **Quinto punto (encontrado al probar el Fix D):** `heroHeadline(brief)` es el respaldo del titular dentro de `guardCopy` y también el último escalón de `meta.name`. Interpolaba `brief.businessType` sin filtro, así que la guardia podaba «Los 25 mejores mecánicos» y acto seguido escribía «taller certificado en Bilbao» en el hero. Es exactamente el hallazgo 2 de seguridad («el respaldo restaura reclamos podados») y cae dentro de «antes de interpolar cualquier valor del brief». Corregido: ahora respaldo es «negocio local en Bilbao» y, con un tipo limpio, sigue usando los datos del dueño («taller de bicicletas en Bilbao»).

### Lo que dejo fuera, a propósito

- **`meta.name` y `design.brief` conservan el nombre y el tipo del dueño tal cual**, aunque lleven un reclamo: son datos identificativos del negocio, y el hallazgo bajo de `draft.ts` está declarado fuera de alcance. Las pruebas lo afirman explícitamente (`doc.meta.name === "Café nº1 de Valencia"`) para que no parezca un olvido. **Decisión pendiente del lead:** si el nombre comercial con reclamo tampoco debe publicarse, es el mismo predicado en `docName` y `designBrief`.
- `contactProps` publica el contacto tal cual (validado por forma de correo o teléfono). No lo toqué.

## Pruebas nuevas (15, en `copy.test.mjs`)

- **Fix A (5):** `aboutBody` con el marcador dentro → se poda y el documento lleva el genérico; detección sin distinguir mayúsculas; `description` con marcador → no aportada; control de que una `description` limpia se respeta; red final probada **con un copy fabricado a mano** (sin pasar por la guardia) → se sustituye solo la sección afectada; y la misma red sobre una tarjeta de servicio.
- **Fix B (3):** «19» frente a «2019»; cifra completa conservada; tokens en cualquier campo (`2000` vs `20000`).
- **Fix C (2):** las 10 formas que se podan y las 6 que no, una por una.
- **Fix D (4):** tipo con reclamo fuera del copy y de las secciones; control con tipo limpio; nombre con reclamo fuera de la plantilla; respaldo del titular sin reclamo, con su control.
- **Sin cambios en las 81 existentes:** pasaron todas sin tocarlas. Eso incluye la tabla de guardia de T-002 y los controles de completitud.

## Verificación (después del último cambio)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **96 tests, 96 pass, 0 fail** (81 + 15).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **420 tests, 420 pass, 0 fail**.
- Script independiente de testing: de 6/4 a **9 pass / 1 fail**, y el que falla es la discrepancia del Fix C descrita arriba.
- Sin verificar en esta máquina: los 6 archivos de integración con Postgres (spec §7, ADR 0003). Ninguno toca este paquete.

## T-002.5

Dos cambios, nada más. El reporte propio de esta subtarea está en `docs/reports/T-002.5/senior.md`; aquí queda el resumen para quien lea T-002.4 de corrido.

- **`liderazgo` se poda.** La política, tal como la dejó el lead: la guardia poda las afirmaciones de estado y conserva las actividades. Patrón: `l[íi]der(azgos?|es)?`, con **una `s` más que el que se envió** (ver abajo).
- **`contact` sale del corpus numérico.** Un teléfono o un correo ya no autorizan cifras: el «24» de «600 24 24 24» no valida «Entrega en 24 horas». El contacto se sigue publicando en su sección.
- Verificación: paquete **100/100** y raíz **424 pass, 0 fail**.

- Entrego a: testing (revisión desde cero)
- Referencias:
  - `docs/reports/T-002/testing.md`, `docs/reports/T-002/security.md`
  - `agents/design/src/copy.ts` (`CLAIM`, `NUMBER`, `ownerNumbers`, `hasInvention`, `briefValueOk`)
  - `agents/design/src/brief.ts` (`containsMarker`, `normalizeBrief`)
  - `agents/design/src/draft.ts` (`heroHeadline`, `copySection`, `safeText`, comprobación final)
  - `agents/design/src/generic-copy.ts` (`publishable`)
  - `agents/design/test/copy.test.mjs` (bloque «T-002.4» al final)
  - `/tmp/t24-build.log`, `/tmp/t24-pkg.log`, `/tmp/t24-test.log` (efímeros)
