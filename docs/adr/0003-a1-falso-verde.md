# ADR 0003 — El criterio A1 contaba archivos en falso verde

Fecha: 2026-11-24. Estado: aceptado. Contexto: revisión de T-001 por testing.

## Contexto

La spec (sección 7) fijó el criterio A1 como «`pnpm turbo run typecheck test --force` → 371
pass, 0 fail». Testing lo ejecutó y devolvió `FAIL`: el comando termina en verde y reporta
371 aprobados, pero **seis archivos de integración con base de datos no ejecutan ni un
caso** y aun así salen como aprobados:

`migrate`, `rls`, `assets-db`, `save`, `another-active` y `cycle`.

Se reprodujo a mano: `apps/platform` informa `✔ test/cycle.test.mjs (1222ms)` con `tests
71, pass 71, skipped 0`, cuando ese archivo hace `process.exit(0)` en la rama sin
`DB_TEST_URL`. El `process.exit(0)` mata el runner antes de que se contabilice el caso
saltado, así que el archivo queda como aprobado y el `skip` ni aparece.

Efecto real: **371 nominales, 365 ejecutados**. El criterio que escribí era inmedible tal
como estaba y premiaba un verde falso.

## Decisión

1. **A1 se redefine.** Ya no cuenta archivos: exige `0 fallos` y `0 archivos en falso
   verde`. Un `✔` sin casos ejecutados cuenta como «no verificado» y se nombra.
2. **Las suites con base de datos se verifican en CI**, que levanta
   `pgvector/pgvector:pg18` (`.github/workflows/ci.yml`). En esta máquina no hay Postgres y
   no se van a fingir.
3. **Se abre `T-009`** para arreglar la causa: la rama sin base de datos no debe salir
   como aprobada. Propuesta: emitir el caso con `skip: true` y salir sin `process.exit(0)`,
   para que el runner cuente el archivo como saltado y el total deje de mentir.
4. **No se toca el código de T-001.** El diff no roza la base de datos ni las suites
   afectadas, y su propio criterio A2/A3 se demostró con 25 casos ejecutados.

## Consecuencias

- T-001 puede cerrarse con esta excepción documentada, no silenciada.
- El repo arrastra un verde inflado desde antes de esta tarea; queda registrado como
  `T-009` y no como deuda de T-001.
- Cambiar un criterio después de un `FAIL` obliga a dejar el rastro: este ADR. Si alguien
  discrepa, el punto a discutir es el criterio, no el resultado de testing.
- Hallazgo adicional de testing, menor y también fuera de alcance: la prueba de integración
  de publicación no la invoca la suite del paquete. Se anota en `T-009`.
