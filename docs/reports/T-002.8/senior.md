# Reporte T-002.8 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T16:08Z
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - Reproduje los dos fallos de testing antes de tocar nada: `businessName` de 80 con el esquema en 60, y `contact`/`cta` etiquetados `cierre_obligatorio` solo cuando el preset no los traía.
  - **Fix 1:** un único paso final, `fit()`, recorta **cada** campo de `genericCopy` a su límite de `COPY_LIMITS`, y el recorte no parte un carácter multibyte.
  - **Fix 2:** separé los dos conceptos en el tipo del plan: `origin` (de dónde sale el texto) y `reason` (por qué está la sección). `origin` se decide solo por el contenido; el mismo contenido da el mismo `origin` con cualquier preset.
  - 5 pruebas nuevas, todas con prueba de rojo real; 7 aserciones existentes movidas de `reason` a `origin`, justificadas en la propia prueba.
- Archivos tocados: `agents/design/src/generic-copy.ts`, `agents/design/src/plan.ts`, `agents/design/src/draft.ts`, `agents/design/test/copy.test.mjs` y `agents/design/test/design.test.mjs`. Nada de platform, panel ni migraciones. Las reglas de poda y la completitud no cambian.

## Fix 1 — `genericCopy` rompía su propio esquema

**Causa exacta:** en T-002.7 recorté al construir, campo a campo, y se quedó fuera `businessName`, que se asignaba al final sin pasar por ningún límite. Es justo el problema de hacerlo caso a caso.

**Arreglo:** un único `fit(copy)` al final de `genericCopy`, que conoce el mapa entero de `COPY_LIMITS` y lo aplica a todo: los campos sueltos, cada elemento de `services`, `process` y `faq`, `businessName` y `photoQueries`. Quité los recortes sueltos que puse en T-002.7: ahora hay un solo sitio. Si mañana se añade un campo al copy, se añade una línea en `fit` y no hay forma de olvidarlo en mitad de la construcción.

**Multibyte:** `cut` ya no parte un par sustituto. Un emoji ocupa dos unidades UTF-16; si el corte cae entre las dos, se descarta la mitad suelta. Lo comprobé con un caso en el que el corte cae **justo** en mitad de un emoji: `"a" + 39 × 😀` (79 unidades, válido en el brief). El resultado tiene 59 unidades, no 60, y ningún sustituto huérfano.

Hice una corrección sobre mi propia prueba: el primer caso de emojis que probé (80 emojis) **no probaba nada**, porque son 160 unidades UTF-16 y `normalizeBrief` descartaba el brief entero. Lo sustituí por el caso de arriba, que sí ejercita el corte.

## Fix 2 — `origin` separado de `reason`

**Tipo** (`PlannedSection`, en `plan.ts`):

```ts
export type SectionOrigin = "copy_del_dueno" | "copy_generico" | "contacto_del_dueno" | "contacto_generico";
interface PlannedSection { type; as; action; reason: string; origin?: SectionOrigin }
```

- `reason`, **por qué está**: `preset`, `completitud_copy_del_dueno`, `completitud_copy_generico`, `cierre_obligatorio`, `h1_obligatorio`, `fotos_de_la_busqueda` o el motivo de una omisión (`testimonio_requiere_cliente_real`, `precio_requiere_dato_del_dueno`, …).
- `origin`, **de dónde sale el texto**: solo en las secciones que se escriben y llevan texto. La galería (son fotos) y las omitidas no lo tienen.

**Reglas aplicadas**, todas en `originOf(type, text, generic, brief)`:
- `contact`: `contacto_del_dueno` si el brief trae correo o teléfono publicables, `contacto_generico` si no. **Solo por los datos.**
- `cta`, `hero`, `features`, `text`, `process` y `faq`: `copy_generico` si su texto coincide con el genérico, `copy_del_dueno` si no.
- `cierre_obligatorio` es ahora solo un `reason`. Lo que añaden la completitud y el cierre se calcula con la **misma** función `write()` que las secciones del preset, así que su `origin` no puede salir distinto.

**Una sola fuente para el contacto.** Moví la validación de correo y teléfono a `ownerContact(brief)` en `plan.ts`, y `contactProps` (`draft.ts`) la reutiliza. Antes estaba solo en el borrador; si plan y borrador validaran distinto, el panel diría «contacto del dueño» sobre una sección que sale sin datos. Tiene el mismo comportamiento que antes: correo tal cual, teléfono recortado a 30.

**Compatibilidad:** `reason` sigue existiendo y siendo `string`, y `origin` es opcional, así que los consumidores siguen compilando. El único consumidor externo del plan es `apps/workers/src/design-job.ts:233`, que solo lee `result.plan.sections.length`. Hay un efecto visible para quien sí lea `reason` de las secciones del preset: antes valía `copy_del_dueno` / `copy_generico` y ahora vale `preset`. Es el cambio de diseño pedido, pero conviene saberlo si el panel llegara a mostrarlo.

## Pruebas

**Nuevas (5):**
1. Todos los campos del brief **al máximo a la vez** (incluida una `Á` multibyte en cada uno) → pasa `siteCopySchema`, y cada campo respeta su límite.
2. Corte en mitad de un emoji → sin sustituto suelto y con el emoji partido descartado, no rellenado.
3. **Mismo contenido, mismo `origin`:** contacto y CTA explícitos, con un preset que los trae y con otro que no → mismo `origin` (`contacto_del_dueno` y el del CTA), distinto `reason` (`preset` frente a `cierre_obligatorio`).
4. El origen del contacto depende solo de los datos: correo y teléfonos → `contacto_del_dueno`; sin contacto o con texto no utilizable → `contacto_generico`, aunque el preset lo pida.
5. La galería no tiene `origin`: son fotos, no texto.

**Comprobé que detectan los defectos:** reintroduje los dos fallos originales (sin recorte de `businessName`; `contact` añadido sin `origin`) y las pruebas 1 a 4 **fallaron** (4 fail). Restauré los dos archivos (`diff` idéntico) y volvieron a 118/118.

**Ajustadas (7 aserciones), por el cambio de diseño, no para que pasen:** todas leían el **origen** del texto en `reason`. Ahora lo leen en `origin`, y donde procede comprueban además `reason: "preset"`. Cada una lleva un comentario «Cambiado en T-002.8» en la propia prueba.

| Prueba | Antes leía | Ahora lee |
| --- | --- | --- |
| `completitud: pasos podados a 1…` | `reason` de process y features | `origin` |
| `completitud: con 3 pasos válidos…` | `reason` de process | `origin` |
| `Fix F: una sección de plantilla…` | `reason` contiene `copy_generico` | `origin === "copy_generico"` |
| `Fix F: el texto del modelo que sí es suyo…` | `reason` de features y faq | `origin` |
| `plan: omite testimonios y precios…` (design) | todo el preset con `reason === "copy_generico"` | `origin` en todas las secciones de texto |
| `runFastDesign: copy con 2 servicios…` (design) | `reason` de features | `origin` |
| `runFastDesign: plan y documento coinciden…` (design) | `[action, reason]` | `[action, reason, origin]` = `["write", "preset", "copy_generico"]` |

Las pruebas de completitud (`completitud_*`), de cierre y de `h1_obligatorio` siguen igual: esos ya eran motivos.

## Verificación (después del último cambio)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **118 tests, 118 pass, 0 fail** (113 + 5).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **443 tests: 436 pass, 0 fail, 7 skipped**.
- **Skipped: 7**, como esperabas con T-009: db 2, assets 1, editor 1, publish 1 y platform 2. Son los archivos de integración con Postgres; **sin verificar en esta máquina**.

## Pendientes y riesgos

- El valor de `reason` en las secciones del preset cambia de `copy_*` a `preset`. Ningún consumidor lo lee hoy (comprobado por búsqueda en `apps` y `packages`); si el panel empezara a mostrarlo, debe leer `origin` para el origen.
- `fit` recorta en seco: no corta en límite de palabra. Para los textos fijos no importa (caben todos); para un dato del dueño muy largo puede quedar una palabra a medias. No lo cambié porque el encargo pedía recortar al límite y `trimWord` cambiaría textos ya fijados por el contrato de T-002.2.
- No hice commit.

- Entrego a: testing (revisión desde cero)
- Referencias:
  - `agents/design/src/generic-copy.ts` (`cut`, `fit`)
  - `agents/design/src/plan.ts` (`SectionOrigin`, `PlannedSection`, `originOf`, `ownerContact`, `closePlan`)
  - `agents/design/src/draft.ts` (`contactProps`)
  - `agents/design/test/copy.test.mjs` (bloque «T-002.8» al final)
  - `/tmp/t28-build.log`, `/tmp/t28-pkg.log`, `/tmp/t28-test.log` (efímeros)
