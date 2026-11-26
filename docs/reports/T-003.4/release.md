# Reporte T-003.4 — release

- Fecha: 2026-11-26 15:09 UTC
- Tarea: validación lineal y límites explícitos en las rutas internas (`isSafeUrl`)
- Rama desplegada: `main` (sin PR, sin rama nueva)
- Resultado: DONE

## SHAs

| Ref | SHA |
|---|---|
| Commit de la corrección | `11680b56a028702f20535778409edcc299ea2f72` (`11680b5`) |
| `origin/main` tras el push | `11680b56a028702f20535778409edcc299ea2f72` |

Push: `ecab6c8..11680b5  main -> main`. El SHA remoto coincide con `HEAD`.

## Grafo

`graphify update .` ejecutado tras el push (2026-11-26 15:09 UTC).

- Nodos: **3353**
- Aristas: **5487**

El motor informó «No tracked code files in change set - skipping rebuild»: el cambio entra por el
árbol de trabajo y el grafo se reetiquetó, pero no hubo recálculo semántico del subgrafo de
`site-schema`. Los conteos son los del grafo actualizado en esta ejecución.

## Archivos commiteados

```
docs/reports/T-003.3/security.md            | 39 ++++++++++++++++++++
packages/site-schema/src/index.ts           | 41 +++++++++++++++------
packages/site-schema/test/validate.test.mjs | 56 +++++++++++++++++++++++++++++
3 files changed, 126 insertions(+), 10 deletions(-)
```

## Verificación previa a la publicación

- `git branch --show-current` → `main`
- `pnpm build` en `packages/site-schema` → `tsc -p tsconfig.json`, sin errores
- `pnpm test` en `packages/site-schema` → **19 tests / 19 pass / 0 fail**

No se cambió ninguna expectativa de prueba para forzar el verde.

## Qué se corrigió

1. **Estructura con retroceso potencial.** El regex `^([a-z0-9]+(-[a-z0-9]+)*)?$` tenía grupos
   anidados. Se sustituyó por validación lineal: partir el segmento por `-` y validar cada parte
   con `^[a-z0-9]+$`.
2. **Segmentos vacíos.** `/a//b` se aceptaba. Ahora solo se permite un segmento vacío y solo al
   final, para que `/servicios/` siga valiendo.
3. **Frontera del límite.** `> 200` dejaba pasar exactamente 200 caracteres; ahora es `>= 200`,
   con 199 como máximo real.

## Nota sobre el hallazgo inicial

Dicha tal cual: el hallazgo inicial de «retroceso cuadrático» partió de una cifra mal transmitida
por el arquitecto (3,4 ms por llamada en vez de 3,369 ms las 1000 llamadas). El auditor retiró el
hallazgo al verificar el dato real, y el cambio se conserva como garantía estructural.

## Pendientes

- **Firma del commit.** Los commits siguen firmados por `root` (`root <root@927ff6249af8>`): el
  entorno no tiene `user.name` ni `user.email` configurados, así que git los deriva del usuario y
  el hostname. No se tocó la configuración de git en esta tarea.
- **`slugSchema`.** Conserva la misma forma de regex anidado. La auditoría dijo que no es hallazgo
  actual (no hay entrada que lo explote), pero merece tarea propia si se mide o se expone.
- **`/root/deploy-work`.** `entrypoint.sh` y `llm-shim.py` siguen sin commitear, fuera de este
  repo. Confirmado con `git status --short` en ese directorio: ambos aparecen como modificados
  (` M entrypoint.sh`, ` M deploy/llm-shim.py`), junto con dos respaldos `.bak-20261124` sin
  seguimiento.

## Observación de trabajo (no bloqueante)

Quedaron sin commitear en el repo, ajenos a esta tarea:

```
?? docs/reports/P0-copy/security.md
?? docs/reports/P0-copy/testing.md
?? docs/reports/T-003.3/testing.md
```

No se añadieron al commit: el encargo fijaba tres archivos y solo se commiteó esos tres.
