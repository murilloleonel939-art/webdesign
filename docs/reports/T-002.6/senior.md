# Reporte T-002.6 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T15:10Z
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - Reproduje el fallo antes de tocar nada: con preset `hero+contact` el documento salía con dos secciones y sin servicios, about ni preguntas.
  - El arreglo está en `planSections`: nueva función `closePlan` que pone `hero` primero, añade las secciones canónicas que el preset no incluya (solo si el copy las sostiene, en orden features → text → process → faq) y cierra siempre con `contact` y `cta`.
  - El plan y el documento salen de la misma llamada, así que el invariante no se rompe. El motivo de cada sección añadida dice su origen y por qué está.
  - Verifiqué los **ocho presets reales** de la migración 0009, con y sin copy: todos cumplen.
- Archivos tocados: `agents/design/src/plan.ts` (`CANONICAL`, `supports`, `closePlan`) y `agents/design/test/copy.test.mjs` y `design.test.mjs`. No toqué la migración 0009, ni los presets, ni las reglas de poda, ni `generic-copy.ts`.

## Cómo queda la regla

1. Se recorre el preset **igual que antes**: lo que incluye conserva su posición relativa y sus motivos (`copy_del_dueno` / `copy_generico`). `pricing` y `testimonial` se siguen omitiendo.
2. `hero` va primero siempre.
3. Las canónicas que falten se añaden, en este orden: **features → text → process → faq** (los pasos detrás de los servicios). Solo se añade la que el copy **ya completado** puede sostener: 3+ servicios, `aboutBody` no vacío, 3+ pasos, 2+ preguntas. El predicado se pregunta a `completeCopy`, que es el mismo copy que verá el borrador.
4. Al final, `contact` y después `cta`, existan o no en el preset. Si el preset los trae en otro orden, se reordena el cierre: la página acaba con contacto y cierre.
5. Motivos para el panel:
   - lo que pidió el preset: `copy_del_dueno` / `copy_generico` (sin cambios);
   - lo que añade la completitud: `completitud_copy_del_dueno` / `completitud_copy_generico`, que dice el origen **y** por qué está;
   - contacto y cierre añadidos: `cierre_obligatorio`.

## Presets reales (migración 0009)

Lo pediste expresamente: comprobé los ocho con copy y sin copy. **Todos cumplen** B2, el orden (hero primero, contact y cta al final), la ausencia de precios y testimonios, y `plannedTypes(plan) === ids del documento`.

| Preset | Trae | Documento resultante |
| --- | --- | --- |
| editorial | hero, text, features, testimonial, cta | hero, text, features, process, **faq**, contact, cta |
| minimal | hero, text, features, contact | hero, text, features, process, **faq**, contact, **cta** |
| warm (Cálido) | hero, text, gallery, testimonial, contact | hero, text, features, process, faq, contact, cta |
| tech (Tecnología) | hero, features, pricing, faq, cta | hero, features, process, faq, **text**, contact, cta |
| studio (Estudio) | hero, gallery, text, testimonial, contact | hero, text, features, process, faq, contact, cta |
| trust (Confianza) | hero, features, testimonial, pricing, contact | hero, features, process, text, faq, contact, cta |
| fresh (Fresco) | hero, text, gallery, pricing, contact | hero, text, features, process, faq, contact, cta |
| bold (Contundente) | hero, features, gallery, cta, contact | hero, features, process, text, faq, contact, cta |

En negrita, lo que el preset no traía. Ningún preset produce un documento que no cumpla, así que no hay id que reportar como problemático.

Un matiz honesto sobre el orden: donde el preset no incluye `text`, el about entra **después** de `features` y `process` (caso de `tech`, `trust` y `bold`), porque el orden canónico manda para lo añadido. Sigue siendo obligatorio que exista y sigue antes del cierre, pero no queda pegado al hero. Si se prefiere el about siempre inmediatamente detrás del hero, es cambiar el orden de `CANONICAL`.

## Pruebas

**Nuevas (5, las que pediste):**
1. Preset con solo `hero` y `contact` + copy completo → `hero, features, text, process, faq, contact, cta`.
2. Preset sin `faq` → la FAQ aparece antes de `contact`, y el plan la marca `write` con motivo `completitud_*`.
3. Preset con `pricing` y `testimonial` → no hay precios ni testimonios (`sin €`, `sin premiad/certificad`), pero sí el resto.
4. Sin copy (rama genérica) con preset mínimo → misma completitud, y el plan coincide sección a sección con el documento.
5. Control: preset completo y copy completo → el orden del preset se respeta (`text` antes de `features`), no se duplica nada (un solo `contact`, y dos bloques `features` que son ventajas + proceso), y **ninguna** sección se marca como añadida.

**Ajustadas (2), por el cambio de comportamiento, no para que pasen:**

| Prueba | Antes | Ahora |
| --- | --- | --- |
| `plan: omite testimonios y precios…` (design) | Esperaba 6 entradas con el orden del preset y nada más | Espera 8: el preset manda en lo suyo y se añaden `faq` y `contact`. Añadí dos aserciones nuevas sobre el motivo de lo añadido. |
| Ídem, aserción de motivos (T-002.3) | Exigía que **todo** lo escrito fuera `copy_generico` | Se mira solo lo que pidió el preset. Lo añadido por completitud y cierre tiene su propio motivo, por diseño. La intención original («el panel no presenta plantilla como si fuera del dueño») se mantiene. |

Las otras 98 pasan sin tocarlas.

## Verificación (después del último cambio)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **105 tests, 105 pass, 0 fail** (100 + 5).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **429 tests, 429 pass, 0 fail** (424 + 5).
- Sin verificar en esta máquina: los 6 archivos de integración con Postgres (spec §7, ADR 0003). Ninguno toca este paquete.

## Pendientes y riesgos

- El efecto de esta tarea se ve en todos los sitios: ahora todos llevan `contact` y `cta` aunque el preset no los pidiera. Es lo que pediste («como cualquier web»), pero cambia la forma de los ocho presets del catálogo, no solo la de los que fallaban.
- La sección `contact` se escribe aunque el dueño no haya dado contacto: sale con el CTA genérico y sin teléfono ni correo. Está bien para B2, pero es una sección de contacto vacía a propósito; no la toqué porque las reglas de poda y el copy ya están aprobados.
- Sigue en pie lo aceptado en T-002.5: `meta.name` y `design.brief` conservan el nombre del dueño tal cual, y el contexto de una cifra no se comprueba más allá de su campo.
- No hice commit.

- Entrego a: testing (revisión desde cero; seguridad solo si da PASS)
- Referencias:
  - `docs/reports/T-002/testing.md` (fallo de B2)
  - `agents/design/src/plan.ts` (`CANONICAL`, `supports`, `closePlan`)
  - `agents/design/test/copy.test.mjs` (bloque «T-002.6» al final)
  - `agents/design/test/design.test.mjs` (prueba del plan)
  - `packages/db/migrations/0009_design_catalog.sql` (los 8 presets, solo lectura)
  - `/tmp/t26-build.log`, `/tmp/t26-pkg.log`, `/tmp/t26-test.log` (efímeros)
