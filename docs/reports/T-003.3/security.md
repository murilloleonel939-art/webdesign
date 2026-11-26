# Reporte T-003.3 — security (nemotron 3 ultra)

- Fecha: 2026-11-26
- Resultado: CLEAR
- Veredicto sobre los 35 casos medidos (implementación original): 23 rechazados correctamente, 9 aceptados correctamente, 3 aceptados con segmentos vacíos discutibles.

- 1. Retroceso cuadrático: **RETIRADO** — La cifra inicial de 3,4 ms/llamada era un error de lectura mía: el dato real era 3.369 ms **totales** para 1000 llamadas (0,0034 ms/llamada). La implementación original **no muestra retroceso cuadrático observable** en V8 con entradas de hasta 199 caracteres. El fix aplicado (validación lineal con `split("-")` + `^[a-z0-9]+$` por parte) se justifica como **garantía estructural**: el nuevo código no puede volverse superlineal aunque cambie el motor de regex, no como corrección de un agujero medido. Coste actual ~0,0129 ms/llamada (4× el regex anterior en esta entrada concreta), seguirá siendo O(n) predecible.

- 2. Segmentos vacíos: **CERRADO (LOW → resuelto)** — Código nuevo rechaza `/a//b`, `/a///b`, `/a//` (segmentos vacíos intermedios) y solo permite segmento vacío final (`/servicios/`). Comportamiento intencionado y seguro; no hay travesía posible.

- 3. Frontera de 200: **CERRADO (LOW → resuelto)** — Código nuevo usa `>= 200`, así que 199 es el máximo real. Contrato y código alineados.

- 4. Camino sin validar: **NO HAY** — Linter (`UNSAFE_URL`, error), esquema Zod (`urlSchema.refine(isSafeUrl)`) y `safeHref` (confía en validación previa) cubren todos los caminos hacia `href` en HTML.

## Hallazgos (severidad, archivo:línea, escenario, fix):

| Severidad | Archivo:línea | Escenario | Fix |
|---|---|---|---|
| — | packages/site-schema/src/index.ts:3 | Retroceso cuadrático teórico en `SAFE_SEGMENT` original | Sustituido por validación lineal estructural (`split("-")` + `SAFE_PART`) — garantía O(n), no corrección de hallazgo medido |
| LOW → resuelto | packages/site-schema/src/index.ts:10 | Segmentos vacíos aceptados (`/a//b`) | Nuevo código rechaza segmentos vacíos intermedios; solo permite trailing slash |
| LOW → resuelto | packages/site-schema/src/index.ts:8 | Límite `> 200` vs contrato «más de 200» | Cambiado a `>= 200` (máx. 199 chars) |

## No revisado:
- Validación de esquemas externos (http/https/mailto/tel) — fuera del alcance de `isSafeUrl` para rutas internas.
- Sanitización de salida en el renderer — asumida correcta por `safeHref`.
- `slugSchema` (línea ~73): regex anidado `^\/([a-z0-9]+(-[a-z0-9]+)*\/?)*$` similar al original. **No es hallazgo actual** — sin medición de degradación y sin entrada de usuario directa equivalente. Merece **tarea propia de revisión** si algún día se expone a entrada no controlada o se mide; por ahora, riesgo teórico sin evidencia.

## Auditoría del código nuevo (`split("-")` + `SAFE_PART`):
- Guion inicial (`"-abc"`): `split("-")` → `["", "abc"]`; parte vacía falla `SAFE_PART` → **rechazado** (correcto).
- Guion final (`"abc-"`): `split("-")` → `["abc", ""]`; parte vacía falla → **rechazado** (correcto).
- Guiones dobles (`"a--b"`): `split("-")` → `["a", "", "b"]`; parte vacía falla → **rechazado** (correcto).
- Segmento vacío (`""`): `isSafeSegment("")` devuelve `false` explícito → **rechazado** (correcto).
- Cadena vacía completa (`"/"`): `segments = [""]`; `pop()` elimina el trailing → array vacío; `every` en array vacío devuelve `true` → **aceptado** (correcto, raíz).
- Multibyte (`"/ñ"`, `"/aá"`): `SAFE_PART` solo permite `[a-z0-9]` → **rechazado** (correcto, consistente con spec).
- **No se ve rendija**: todos los casos límite del regex original se preservan o endurecen; la validación por partes es equivalente semánticamente y más estricta en vacíos.

## Entrego a: release

REPORTE | T-003.3 | security | CLEAR | docs/reports/T-003.3/security.md