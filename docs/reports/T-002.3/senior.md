# Reporte T-002.3 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T13:56Z (ampliado 2026-11-24T14:15Z con «Completitud por sección» y 2026-11-24T14:19Z con el proceso)
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - **Cambio 1:** la guardia toma como corpus del dueño sus seis campos (`description`, `name`, `businessType`, `city`, `service`, `contact`). `CLAIM` y `MONEY` se siguen podando siempre, con el porqué en un comentario. Además corregí un agujero del patrón `CLAIM` que el criterio 4 dejó al descubierto (ver Decisiones).
  - **Cambio 2:** sin copy, `draftSite` y `planSections` usan `genericCopy(brief)`. Ningún respaldo escribe ya el marcador: `heroHeadline`, `meta.name`, `design.brief`, `design.presetId` ni las secciones. `testimonial` y `pricing` se omiten siempre.
  - **Cambio 3:** cada intento de copy devuelve sus propios avisos de guardia, y solo se publican los del intento que gana.
  - Añadí 15 pruebas (10 de B1/B2 y 5 de los cambios) y reescribí 11 que afirmaban el comportamiento anterior. Cada cambio está justificado abajo y en un comentario dentro de la propia prueba.
- Archivos tocados:
  - `agents/design/src/copy.ts`: `CLAIM`, `ownerCorpus`, `hasInvention`, y en `guardCopy` el corpus y dos respaldos.
  - `agents/design/src/draft.ts`: quité `draftSection` y `PENDING_PRICE`; cambié `heroHeadline`, `docName` y `draftSite`; añadí `designBrief`.
  - `agents/design/src/plan.ts`: `planSections` siempre trabaja sobre un copy.
  - `agents/design/src/agent.ts`: `generateCopy` y `finishCopy` (avisos por intento) y una frase del `systemPrompt`.
  - `agents/design/test/copy.test.mjs`, `design.test.mjs` y `acceptance.test.mjs`.
  - No toqué `index.ts`: su diff (exportar `genericCopy`) es de T-002.2.

## Decisiones y por qué

1. **`CLAIM` no podaba la mitad de lo que debía. Comprobado antes de tocarlo.** Las raíces (`premiad`, `certificad`, `garantizad`, `líder`) llevaban `\b` al final, así que solo casaban con la palabra exacta:

   | Texto | Antes | Ahora |
   | --- | --- | --- |
   | `Somos líderes del sector` | pasa | se poda |
   | `Equipo premiado` | pasa | se poda |
   | `Productos certificados` | pasa | se poda |
   | `Resultado garantizado` | pasa | se poda |
   | `Es la empresa líder` | se poda | se poda |

   El criterio 4 del encargo («Somos líderes del sector» se poda) **no se podía cumplir sin esto**. Quité el `\b` final y uní `l[íi]der`. La política no cambia, solo cubre lo que ya decía cubrir. Que el dueño escriba una de estas palabras no la hace pasar (lo afirma la prueba nueva).

2. **`hasInvention` evalúa los reclamos y el dinero antes que las cifras.** Antes llegaba al mismo resultado dando un rodeo. Ahora el orden muestra la regla tal cual: reclamo o dinero se poda siempre; una cifra solo si no está en el corpus.

3. **Dos respaldos de `guardCopy` podían escribir el marcador.** Cuando se podaba `businessType` o `aboutHeading`, el valor de reserva era `brief.businessType`, que vale `pendiente de confirmar` si el dueño no dio el tipo. Ahora salen de `genericCopy(brief)`. Sin esto, B1 fallaba con copy del modelo.

4. **`design.brief` también es documento entregado.** `briefSentence` (en `brief.ts`, fuera de mi lista de archivos) interpola el marcador en cada hueco, y B1 mira `JSON.stringify(doc)` entero. En `draft.ts` creé `designBrief()`, que solo guarda lo que el dueño dijo (o su descripción libre si no dio ningún campo). `briefSentence` queda igual y sigue exportada, pero `draftSite` ya no la usa. **No toqué `brief.ts`.**

5. **`meta.name`.** El nombre del dueño va primero, después `copy.businessName` y, en último lugar, `heroHeadline(brief)`. El último escalón ya no es el marcador. `heroHeadline` mantiene el nombre del dueño tal cual aunque sea corto, y solo cuando no hay ni nombre ni tipo con ciudad recurre al titular del contrato de T-002.2.

6. **Preset sin id → `throw new Error("draftSite: preset sin id")`.** El encargo pedía una aserción o un valor neutro. Elegí la aserción: un id inventado escrito en `presetId` haría que el panel buscara un preset que no existe, y fallar en la frontera señala al llamador. `runFastDesign` ya lanza si no hay presets; el catálogo siempre trae id.

7. **El plan sigue coincidiendo con el documento.** `planSections` resuelve el copy igual que `draftSite` (`copy ?? genericCopy(brief)`), así que no pueden discrepar aunque se llamen por separado, como hace `agent.ts`. Eliminé la rama antigua sin copy (la que «degradaba» a texto con el marcador). El motivo distingue `copy_del_dueno` de `copy_generico`, para que el panel no presente un texto genérico como si lo hubiera dicho el dueño. El tipo `PlanAction` mantiene `"degrade"` por compatibilidad, aunque ya no se emite.

8. **Avisos por intento.** `finishCopy` ya no recibe `warnings`: devuelve `{ outcome, warnings }`. `generateCopy` publica los avisos **solo si ese intento trae copy**. Si ninguno trae copy, no se publican podas, porque no hay texto suyo en el sitio; el motivo viaja en `copy_fallback` o en `CopyUnavailableError`, igual que antes.

9. **`systemPrompt`.** Le decía al modelo «lo que no sepas queda como 'pendiente de confirmar'», que ya no es cierto y lo empujaba a escribir el marcador. Ahora dice que lo que no sabe no se escribe en el sitio y se le pide al dueño. Ninguna prueba lo fijaba.

## Pruebas que cambié y por qué (ninguna se tocó solo para que pasara)

| Prueba (archivo) | Antes afirmaba | Ahora afirma | Por qué |
| --- | --- | --- | --- |
| `c) campos faltantes…` (acceptance) | marcador en el doc | sin marcador; `pending` intacto; `meta.name` del dueño | Era justo lo que B1 prohíbe. Lo que se protegía (que el brief sabe qué falta) se mantiene. |
| `c) testimonial y pricing…` (acceptance) | `pricing` con el marcador como nombre del plan | ni `testimonial` ni `pricing`; sin cifras ni marcador | El encargo ordena omitir `pricing`. |
| `f) error 6.5 con ownerRequested` (acceptance) | error 6.5 disparado por `pricing` | mismo error, `SLOP_HEADING_SKIP`, disparado por un copy con `servicesHeading: ""` | Ver «riesgo 1». Lo que se protege no cambia: 6.5 avisa y no revierte. |
| `f) sin ownerRequested…` (acceptance) | ídem | ídem | ídem |
| `draft: valida… no inventa` (design) | ventajas degradadas; `pricing` con precio vacío | ventajas escritas con copy genérico; `pricing` omitido; sin testimonio | Mismo motivo que en `c)`. |
| `draft: 6.4… marcador llega al HTML` (design) | el HTML lleva el marcador | 6.4 limpio, HTML sin marcador y con el nombre del dueño | Mismo motivo que en `c)`. |
| `plan: degrada…` (design) | `[write, write, degrade, degrade, write]` | las 6 entradas con `type:action` y motivo `copy_generico` | El plan sin copy ya no degrada (decisión 7). |
| `runFastDesign: una ronda…` (design) | marcador en el doc | sin marcador; `copy_fallback` sigue en `warnings` | Mismo motivo que en `c)`. |
| `draftSite con copy y solo description` (copy) | marcador aceptado en `design.brief` | sin marcador en todo el doc; la descripción del dueño se conserva | Decisión 4. |
| `draftSite sin copy…` (copy) | sin ventajas y con marcador | copy genérico: ventajas, about, sin testimonio | Cambio 2. |
| `con JSON roto cae a copy_fallback…` (copy) | marcadores en el sitio | `copy_fallback` en `warnings` y sitio completo | Cambio 2. |

## Pruebas nuevas (las cinco obligatorias, en `copy.test.mjs`)

1. **B1 y B2:** 10 briefs, desde solo descripción hasta los cinco campos, con acentos, teléfonos y un nombre con cifra (`Café 2019`). Cada uno se prueba por **los dos caminos** (copy genérico y copy válido del modelo):
   - el documento valida contra el esquema;
   - `JSON.stringify(doc)` no contiene `pendiente de confirmar`;
   - hay `features` con 3 o más elementos, `about` no vacío y `faq` con 2 o más.
2. **`Café 2019` sin descripción:** la guardia no lo poda, y el nombre llega al documento.
3. **Corpus completo:** la misma cifra escrita en cada uno de los seis campos no se poda. Control: si no la escribe nadie, sí se poda.
4. **«Somos líderes del sector»:** se poda aunque la descripción del dueño diga «somos lideres del sector», y lo mismo con «premiado», «certificados» y «garantizado».
5. **Dos intentos:** el primero se descarta con avisos de guardia y gana el segundo. `warnings` no contiene ningún `copy_guard` y el documento no lleva nada del primero. **Control:** cuando el copy ganador sí tiene podas, el aviso `copy_guard: services[2]` llega. Sin este control, la prueba anterior también pasaría si los avisos se perdieran siempre.

## Verificación (al cerrar la primera parte: 75 casos)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **75 tests, 75 pass, 0 fail** (60 anteriores + 15 nuevas).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **399 tests, 399 pass, 0 fail**. Cuadra con lo anterior: 371 (T-001) + 3 (T-002.1) + 10 (T-002.2) + 15 (esta tarea).
- Los números vigentes están en «Verificación final» (81 y 405).
- Siguen vigentes los 6 archivos de integración con base de datos que la spec (§7, ADR 0003) declara como «no verificados» en esta máquina, porque no hay Postgres. Ninguno toca este paquete.

## Completitud por sección

Decisión del lead sobre el riesgo 2: **completar por sección, sin mezclar.** La guardia no cambia; la completitud se resuelve al construir el documento.

### Regla implementada

| Sección | Si el copy del modelo (ya podado) tiene… | Se sustituye entera por… |
| --- | --- | --- |
| Servicios | menos de 3 | los 3 servicios genéricos **y** su encabezado (`servicesHeading`) |
| About | `aboutBody` vacío | el párrafo genérico **y** su encabezado (`aboutHeading`) |
| Proceso (pasos) | menos de 3 | los 3 pasos genéricos **y** su encabezado (`processHeading`) — añadido después, ver «Proceso» |
| FAQ | menos de 2 | las 3 preguntas genéricas |

Todo o nada: si una sección llega al mínimo se conserva la del modelo íntegra; si no, se usa la genérica íntegra. **Nunca** se mezcla un elemento del modelo con uno de plantilla dentro del mismo bloque. El encabezado va con el cuerpo, porque un encabezado del modelo encima de tarjetas genéricas sería justo la mezcla que se quiere evitar.

### Dónde está y por qué ahí

- **`completeCopy(copy, brief)` en `plan.ts`**, junto a las constantes `MIN_SERVICES = 3` y `MIN_FAQ = 2`. La usan tanto `draftSite` como `planSections`.
- El lead pidió resolverlo «en `draft.ts`». Lo que llega al documento se decide, efectivamente, en `draftSite`: `const text = completeCopy(copy ?? genericCopy(brief), brief)`. Pero la función tiene que vivir donde la puedan llamar los dos. `draft.ts` ya importa de `plan.ts`; ponerla en `draft.ts` habría obligado a `plan.ts` a importar de `draft.ts`, creando un ciclo de importación en tiempo de ejecución.
- **Por qué la necesita también el plan:** `agent.ts` llama a `planSections` por su cuenta con el copy sin completar. Si solo completara el borrador, el plan diría «omitir about» mientras el documento lleva el about genérico, y se rompería el invariante que fija la prueba «plan y documento coinciden».
- El motivo del plan dice el origen **por sección**: `copy_del_dueno` si el bloque es del modelo, `copy_generico` si se sustituyó. Con un mismo copy pueden convivir los dos motivos en secciones distintas (lo afirma la prueba de control).
- Es idempotente: sobre un copy ya completo (o sobre el genérico) no cambia nada.
- **`guardCopy` no cambia** y sigue devolviendo `dropped`. Los avisos `copy_guard` siguen llegando al panel aunque la sección se haya sustituido: la poda ocurrió en el copy que ganó, y el dueño debe saberlo.

### Pruebas nuevas (4, en `copy.test.mjs`)

1. **Servicios podados a 1:** la guardia deja 1 de 3. La sección es exactamente `{ heading, items }` genéricos y no contiene ni el servicio que sobrevivió (`Tueste artesanal de origen`) ni los podados (`900 clientes`, `15 años`).
2. **About podado:** «Abrimos en 2015…» se poda. La sección es exactamente `{ heading, body }` genéricos y «Abrimos en 2015» no aparece.
3. **FAQ podada a 1:** la guardia deja 1 de 2. Los ítems son exactamente las 3 genéricas, y no aparecen ni la que sobrevivió (`¿Tenéis terraza?`) ni la podada (`400 clientes`).
4. **Control:** con 3 servicios válidos y un about limpio se conservan los del modelo, y solo la FAQ (que quedó en 1) pasa a la genérica. Sin este control, las tres anteriores pasarían también si el borrador sustituyera siempre.

Al escribir el control, dos veces la expectativa estaba mal por culpa de mi fixture (un servicio y un about con cifra, que la guardia poda como debe). Corregí el fixture, no el código.

### Pruebas existentes que cambiaron (6)

En todas **se conservan intactas las aserciones de la guardia** (`copy.services.length === 2`, `copy.aboutBody === ""`), que el lead confirmó como correctas. Solo cambia lo que se afirma del **documento**, que es justo lo que redefine la decisión:

| Prueba | El documento antes | El documento ahora |
| --- | --- | --- |
| `copy: dos servicios validos…` (copy) | 2 tarjetas | sección genérica completa |
| `copy: el tercer servicio… se poda` (copy) | 2 tarjetas | sección genérica completa; sigue sin `500 clientes` |
| `copy: con aboutBody podado…` (copy) | sin sección about | about genérico exacto |
| `runFastDesign: si el copy que gana tiene podas, el aviso SI llega` (copy) | 2 tarjetas | sección genérica; el aviso `copy_guard: services[2]` sigue llegando |
| `runFastDesign: copy con 2 servicios…` (design) | 2 tarjetas | sección genérica completa; el plan dice `copy_generico` |
| `runFastDesign: plan y documento coinciden cuando el about se poda` (design) | los dos omitían el about | los dos escriben el genérico (`["write", "copy_generico"]`) |

La última sigue protegiendo lo mismo que antes: que plan y documento no discrepen.

### Lo que la regla no cubre

- ~~`process` sin mínimo.~~ Resuelto: el lead aprobó igualarlo. Ver «Proceso».
- `copySection` conserva sus guardas antiguas (`services.length === 0`, etc.) por si alguien la llama con un copy sin completar. Con `completeCopy` delante, nunca se activan.

### Proceso (último cambio de T-002.3)

Aprobado por el lead: el proceso sigue la misma regla que las demás secciones.

- `MIN_PROCESS = 3` en `plan.ts`. Si la guardia deja menos de 3 pasos, `completeCopy` sustituye **la sección entera**: los 3 pasos genéricos y su encabezado. No se mezcla nada.
- En el plan, el bloque `process` pasa a `write` con motivo `copy_generico` cuando se sustituye, y `copy_del_dueno` cuando se conservan los del modelo. Antes se omitía si quedaban 0 pasos.
- Ninguna prueba existente cambió por esto: las 79 siguieron en verde sin tocarlas.

Pruebas nuevas (2, en `copy.test.mjs`):

1. **Pasos podados a 1:** la guardia deja 1 de 3. El bloque `s_process` es exactamente `{ heading, items }` genéricos y no contiene ni el paso que sobrevivió (`Pasas a probarlo`) ni los podados (`900 clientes`, `15 años`). Además comprueba que los servicios del modelo siguen intactos (cada sección se decide por separado) y que el plan marca `process` como `copy_generico` y `features` como `copy_del_dueno`.
2. **Control:** con 3 pasos válidos se conservan los del modelo, y el plan los marca `copy_del_dueno`.

Al escribir la primera, el paso que sobrevivía era «Nos escribes», que coincide con el título del primer paso genérico: la comprobación de «sin nada del modelo» habría fallado aunque el código estuviera bien. Cambié el fixture por un texto inequívoco.

**Comprobé que la prueba es un rojo real:** quité temporalmente el bloque de `process` en `completeCopy`, recompilé y la prueba de pasos podados **falló** (42 pass, 1 fail), mientras el control seguía pasando, como debe. Restauré `plan.ts` (verificado con `diff`: idéntico) y volvió a 43/43.

### Verificación final (repetida después del último cambio)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **81 tests, 81 pass, 0 fail** (75 + 4 de completitud + 2 de proceso).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **405 tests, 405 pass, 0 fail** (399 + 6).
- Siguen sin verificar aquí los 6 archivos de integración con base de datos (spec §7, ADR 0003). Ninguno toca este paquete.

## Pendientes y riesgos

1. **El error 6.5 que había en todo borrador sin copy desaparece, y es intencionado.** Antes, cualquier preset con `pricing` producía `SLOP_HEADING_SKIP`, porque los planes son `h3` sin `h2`. Probé cinco variantes de tema (contraste, escala y márgenes) y ninguna produce ya un error 6.5 en los borradores normales. El único disparador que encontré por el flujo real es un copy del modelo con `servicesHeading: ""`, que el esquema admite y que deja las tarjetas en `h3` justo detrás del `h1`. Eso es un defecto real y alcanzable. Propuesta: que `guardCopy` o `normalizeCopy` rellene los encabezados vacíos. No lo arreglé porque las pruebas `f)` lo necesitan como disparador y no estaba en el encargo.
2. ~~**B2 solo con copy completo.**~~ Resuelto por decisión del lead: completitud por sección. Ver «Completitud por sección».
3. Sin copy del modelo, las fotos siguen sin buscarse: `loadPhotos` lee `copy?.photoQueries` del copy del modelo, no del genérico. Lo dejé así a propósito para no ampliar el alcance. El sitio sale completo, sin fotos.
4. `briefSentence` (en `brief.ts`) sigue escribiendo el marcador y sigue exportada, aunque `draftSite` ya no la usa. Si otro llamador la usa para algo que se entrega, el marcador volvería por ahí. Hoy no hay ningún otro llamador en el repo (comprobado con grep en `apps`, `packages` y `agents`).
5. No hice commit; eso es del release. El árbol también contiene los cambios sin commitear de T-002.1 y T-002.2.

- Entrego a: testing
- Referencias:
  - `docs/spec.md` §7 (B1, B2, A3) y §8 (T-002.3)
  - `agents/design/src/copy.ts` (`CLAIM`, `ownerCorpus`, `hasInvention`, `guardCopy`)
  - `agents/design/src/draft.ts` (`heroHeadline`, `docName`, `designBrief`, `draftSite`)
  - `agents/design/src/plan.ts` (`planSections`)
  - `agents/design/src/agent.ts` (`generateCopy`, `finishCopy`, `designAgent.systemPrompt`)
  - `agents/design/test/copy.test.mjs` (bloque «T-002.3» al final del archivo)
  - `agents/design/src/plan.ts` (`completeCopy`, `MIN_SERVICES`, `MIN_PROCESS`, `MIN_FAQ`)
  - `agents/design/test/copy.test.mjs` (bloque «completitud por sección» al final del archivo)
  - `/tmp/t23c-pkg.log`, `/tmp/t23c-test.log`, `/tmp/t23c-build.log` (logs de la verificación final, efímeros)
