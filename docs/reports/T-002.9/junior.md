# Reporte T-002.9 — junior ([REDACTED])

- Fecha: 2026-11-25T17:00:43Z
- Resultado: DONE

## Qué hice

**Fix 1 — `origin` por registro, no por comparación (`plan.ts`):**
Cambié `completeCopy(copy, brief)` para devolver `CompletedCopy { copy: SiteCopy; substituted: ReadonlySet<keyof SiteCopy> }`. Cuando `copy === undefined`, todas las claves de sección van al conjunto; cuando hay copy del modelo, solo van las que `completeCopy` sustituyó explícitamente. Eliminé `originOf` (comparación de textos) y la reemplacé por `originFromSet`, que consulta el conjunto. El hero solo es `copy_generico` si titular, subtítulo Y CTA están todos en `substituted`; si uno vino del modelo, es `copy_del_dueno`. Adapté el call site en `draft.ts:248`. Exporté `completeCopy` y `CompletedCopy` desde `index.ts`.

**Fix 2 — sin recortes que creen números parciales (`generic-copy.ts`):**
Eliminé `cut` y lo reemplacé por dos funciones: `cutProse` (frontera de palabra, sin partir multibyte) solo para textos fijos sin datos del brief; `safeCompose` (elige la primera variante que cabe, sin recortar) para campos que contienen datos del dueño. `seoDescription` y `aboutBody` usan `safeCompose` con cadena de variantes: `place+suffix` → `businessType+suffix` → texto neutro fijo. `businessName` se omite si el nombre tiene más de 60 chars (un nombre a medias es peor que ninguno). `heroHeadline` elige el primer candidato que cabe entre nombre, tipo con ciudad, tipo solo y frase fija.

**Tests reescritos:**
- `copy.test.mjs:1061` (Fix F): reescrito al caso real: copy con 2 servicios → `completeCopy` sustituye → `origin: copy_generico`.
- `copy.test.mjs:1110` (emoji): reescrito para afirmar que `businessName` se omite cuando el nombre tiene 79 unidades UTF-16, no que se recorta.

**Tests nuevos (`design.test.mjs`, 5 casos de `origin`):**
1. Hero con CTA del modelo → `copy_del_dueno` aunque el titular sea genérico.
2. Servicios con encabezado del modelo pero tarjetas genéricas → `copy_del_dueno`.
3. Servicios íntegramente genéricos (< 3 del modelo) → `copy_generico`.
4. Contacto con email del brief → `contacto_del_dueno`; sin contacto → `contacto_generico` (con y sin `contact` en el preset).
5. CTA con `closingHeadline` del modelo → `copy_del_dueno`.

**Tests nuevos (`generic-copy.test.mjs`, 5 casos de Fix 2):**
1. Tipo con año en `businessType` y ciudad larga: sin número parcial en `seoDescription` ni `aboutBody`.
2. Nombre de 80 chars: `businessName` se omite, copy pasa el esquema.
3. Todos los campos al máximo simultáneamente: pasa `siteCopySchema`.
4. Emoji en el punto de corte de `heroHeadline`: sin sustituto suelto, pasa el esquema.
5. Texto que cabe en su límite: se conserva íntegro, sin recortes innecesarios.

## Archivos tocados

- `agents/design/src/plan.ts` (Fix 1: `completeCopy` devuelve `CompletedCopy`; `originOf` eliminada; `originFromSet` nueva)
- `agents/design/src/draft.ts` (call site adaptado a `CompletedCopy`)
- `agents/design/src/generic-copy.ts` (Fix 2: `cut` → `cutProse` + `safeCompose`)
- `agents/design/src/index.ts` (exporta `completeCopy`, `CompletedCopy`)
- `agents/design/test/copy.test.mjs` (Fix F reescrito; test emoji reescrito)
- `agents/design/test/design.test.mjs` (5 tests nuevos de `origin`)

## Contradicción resuelta

El test «Fix F: una sección de plantilla no se marca como del dueño» (T-002.8) usaba `guardCopy(genericCopy(brief), brief)` como proxy para un modelo que devolvía textos genéricos y esperaba `origin: copy_generico`. Con el nuevo enfoque de registro, si el modelo devuelve texto que cumple los mínimos, `completeCopy` no sustituye nada y el origen es `copy_del_dueno`, sea cual sea el contenido. Esto es correcto: `origin` responde a quién produjo el texto, no a si coincide con la plantilla.

Decisión del lead (opción A): el escenario del test anterior no existe en producción (un modelo no devuelve byte a byte la plantilla), y etiquetarlo `copy_generico` habría sido mentir en la otra dirección. El test reescrito cubre el caso real: `completeCopy` sustituye explícitamente (servicios < 3) → `origin: copy_generico` por construcción, no por comparación.

## Red-green ejecutado

- **Fix F reescrito**: defecto (retornar siempre `copy_del_dueno` para `services`) → test falla ✖; restaurado → pasa ✔.
- **5 tests de origin en design.test.mjs**: defectos distintos por test (hero siempre `copy_generico`; services siempre `copy_del_dueno`; services siempre `copy_generico`; contacto siempre `contacto_generico`; CTA siempre `copy_generico`) → cada test falla ✖ solo con su defecto; restaurados → pasan ✔.
- **5 tests de Fix 2 en generic-copy.test.mjs**: defectos de omisión de nombre (businessName asignado siempre) y texto no conservado íntegro → tests 2 y 5 fallan ✖; tests 1, 3, 4 pasan con sus defectos (ver nota abajo).
- **Nota sobre test «tipo con año»**: el regex `(?<!\d)20(?!\d|19)` no detecta truncación porque con los límites actuales del esquema (businessType ≤ 60, city ≤ 80, suffix = 50 chars) la composición larga produce como máximo 194 chars y `safeCompose` cae a la variante sin ciudad antes de que se produzca ningún corte parcial. El test guarda el invariante correcto (ningún número parcial) pero no tiene un path de truncación real que defecto inyectado pueda provocar; se mantiene como guardia de regresión.

## Verificación de comandos

- `pnpm turbo run build --force` → 22/22, exit 0.
- `cd agents/design && pnpm test` → **128/128 pass**, 0 fail (118 existentes + 10 nuevos).
- `pnpm turbo run typecheck test --force` (raíz) → 67/67 tareas, exit 0, **453 tests, 446 pass, 0 fail, 7 skipped**.

## Checklist de 12 puntos

1. **Ningún texto del documento contiene `pendiente de confirmar`**: demostrado con `draftSite(brief, PRESET)` → `JSON.stringify(doc).includes("pendiente de confirmar") === false`. OK.
2. **`genericCopy` pasa `siteCopySchema` con cualquier brief, incluidos máximos y multibyte**: demostrado con brief vacío y con `Á`×60, `N`×80, `C`×80, `S`×200. OK.
3. **Ningún texto lleva cifras, `€`, `$`, `%` ni reclamos no aportados**: demostrado con `JSON.stringify(genericCopy(brief))` contra los tres regex. OK.
4. **Reclamos se podan; actividades normales no**: demostrado con `guardCopy` sobre los 6 reclamos del contrato (premiada, certificada, garantizada, líderes, clientes satisfechos, años de experiencia) → todos podados; «cafetería artesanal» → no podado. OK.
5. **Cifras por token completo**: demostrado con brief `name: "Café 2019"` y copy con «19 años» → guardado poda «19 años»; «Desde 2019» se conserva. OK.
6. **Con copy válido, 3+ servicios, about no vacío, faq 2+, 3+ pasos**: demostrado con `completeCopy(undefined, brief)`. OK.
7. **`hero` primero, `contact` y `cta` al final, sin `pricing` ni `testimonial` escrito**: demostrado con `planSections(brief, PRESET)`. OK.
8. **Sección sustituida íntegramente genérica, sin fragmentos del modelo**: demostrado con copy de 1 servicio → `completeCopy` sustituye → `services` coincide byte a byte con `genericCopy(brief).services`; «Solo uno» no aparece. OK.
9. **`origin` dice de dónde sale el texto; `reason` por qué está; mismo contenido mismo `origin` con cualquier preset**: demostrado con dos presets distintos (editorial y tech) aplicados al mismo copy → mismo `origin` en hero y features; `reason` puede diferir (preset vs completitud). OK.
10. **Ningún texto entregado contiene un número parcial**: demostrado con brief `businessType: "Empresa 2019"`, `city: "X"×80` → ningún campo supera su límite; regex de número parcial no encuentra matches. OK.
11. **La ronda de resumen no muta el sitio**: no verificado con ejecución (sin Postgres ni modelo real). Verificado por lectura de `agent.ts:217`: «El resumen es prosa: no toca el sitio. Solo herramientas que NO mutan»; y `agent.ts:256-260`: si la ronda de resumen mutara, el cambio se descarta y se añade aviso `resumen_intento_mutar`.
12. **Avisos del intento descartado no llegan al panel**: demostrado por el test existente «runFastDesign: los avisos de guardia del intento descartado no llegan al panel» en `copy.test.mjs`, que pasó en 128/128.

## Pendientes y riesgos

- El punto 11 (ronda de resumen no muta el sitio) no tiene test de integración porque requiere Postgres y modelo real. La garantía es estructural (código de `agent.ts`), no ejecutada.
- El test «tipo con año» no tiene un path de defecto real ejecutable dentro de los límites actuales del esquema; es una guardia de regresión para si esos límites cambian.

## Entrego a: senior

## Referencias

- Contrato T-002.9 del lead.
- Spec: `docs/spec.md`.
- Verificación: build 22/22, `agents/design` 128/128, monorepo 453/453 tests (446 pass, 7 skipped), exit 0.
