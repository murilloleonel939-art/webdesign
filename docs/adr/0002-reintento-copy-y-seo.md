# ADR 0002 — El reintento de textos y el respaldo del SEO

Fecha: 2026-11-24. Estado: aceptado. Contexto: tarea T-001.

## Contexto

`agents/design/src/agent.ts` pide los textos del sitio al modelo una vez y, si la
respuesta no se puede leer, reintenta una segunda vez con una línea extra que explica el
fallo. Dos pruebas del paquete están en rojo:

1. `copy.test.mjs` caso `empty_services`: espera dos llamadas al modelo y recibe una.
2. `copy.test.mjs` caso «los reclamos sin cifra también se caen»: espera que
   `seoDescription` acabe valiendo lo mismo que `heroSubline`, y vale el texto que escribió
   el modelo.

## Decisión 1 — el fallo de la guardia sí reintenta

`finishCopy` devuelve un `CopyOutcome` que puede traer `{copy}` o `{reason}`. Hoy el
resultado se devuelve directo (`return finishCopy(...)`), así que un `empty_services`
corta antes del reintento aunque el comentario del propio código diga lo contrario. Se
corrige el flujo: el `reason` de la guardia se trata como motivo de lectura y entra en el
reintento; el corte por `transport_` se mantiene, porque sin presupuesto no tiene sentido
gastar otra llamada.

Motivo: el caso es recuperable. Si el modelo inventó cifras en los tres servicios, un
segundo intento con la orden de no inventar puede salvarlo; fallar a la primera le dice al
dueño «no se pudo escribir» en un caso que sí tenía arreglo.

## Decisión 2 — el SEO se conserva si no trae inventos

La guardia ya recalcula `seoDescription` solo cuando el modelo inventa algo, y entonces
baja al subtitular del hero. La prueba pedía el recálculo siempre. Gana la guardia: si el
modelo escribió una descripción limpia («Cafetería de especialidad en Valencia con tueste
propio y desayunos»), reemplazarla por el subtitular pierde información útil y no aporta
nada.

La prueba se corrige para afirmar el comportamiento real, en vez de debilitar la guardia
para que pase.

## Consecuencias

- `T-001` no toca `guardCopy`: el cambio es de flujo y de prueba.
- Ningún dato inventado llega al sitio; la garantía que importa no se relaja.
- Si más adelante se quiere SEO siempre derivado, se cambia la guardia y su prueba en el
  mismo commit, nunca solo una de las dos.

## Revisión — 2026-11-26 (P0-transporte-y-fotos)

Estado: la Decisión 1 se mantiene; se corrige su segunda mitad. La Decisión 2 no cambia.

### Qué decía la decisión original

La Decisión 1 dejaba escrito que «el corte por `transport_` se mantiene, porque sin
presupuesto no tiene sentido gastar otra llamada». Entonces era razonable: el único
motivo de transporte que se había visto en las pruebas era el presupuesto agotado, y
esa mitad del argumento sigue siendo cierta —sin saldo, una segunda llamada no se
puede pagar—. Lo que no se vio es que el mismo corte atrapaba también los fallos de
los que sí se sale con otra llamada.

### Qué se descubrió en producción

`LlmClient.complete` devuelve `{ ok: false, stop: { kind: "done" }, error }` en cuatro
situaciones distintas: `invalid_request`, `refused`, reintentos agotados (`timeout`,
`rate_limit`, `provider_error`, 502 incluido) y fallo sin error asociado. El agente
construía el motivo con `stop.kind`, que solo vale `done` o `budget`, así que los
cuatro llegaban al panel como `transport_done`: un rechazo del modelo y un 502 del
proveedor eran indistinguibles. Como la condición de corte era
`reason.startsWith("transport_")`, cualquier fallo de transporte cerraba el
reintento. Con `maxRetries: 0` en el worker
(`apps/workers/src/pg-store.ts`), un solo 502 perdía el sitio entero; en producción
se veía como `design_copy_fallback { reason: 'transport_done' }`.

La causa real del fallo nunca se perdió: vive en `error.code`, que es un valor cerrado
(`timeout`, `rate_limit`, `invalid_request`, `provider_error`, `refused`). El contrato de
`LlmClient` no cambia.

### Decisión 3 — el corte lo decide la causa, no el prefijo

El motivo se construye con la causa real: `budget` si `stop.kind` es `"budget"`,
`error.code` si el fallo trae error, y `unknown` si no lo trae
(`agents/design/src/agent.ts:340`). El corte pasa a una lista explícita de causas
reintentables
(`agents/design/src/agent.ts:301`), aplicada en `agents/design/src/agent.ts:377`: solo se
corta cuando reintentar no puede cambiar el resultado.

| Causa (`stop.kind` / `error.code`) | Motivo publicado | ¿Reintenta? | Por qué |
|---|---|---|---|
| `budget` (cualquier límite) | `transport_budget` | No | Sin saldo no hay 2ª llamada. |
| `invalid_request` | `transport_invalid_request` | No | La petición no cambia. |
| `refused` | `transport_refused` | No | El modelo ya dijo que no. |
| `timeout` | `transport_timeout` | Sí | Fallo de red o latencia momentánea. |
| `rate_limit` | `transport_rate_limit` | Sí | Límite momentáneo. |
| `provider_error` (502 incluido) | `transport_provider_error` | Sí | Caída transitoria. |
| Sin error | `transport_unknown` | Sí | Causa desconocida: vale otro intento. |

Motivo: los tres motivos que no se reintentan tienen en común que el segundo intento
repite el mismo resultado —o el mismo gasto que no se puede pagar—; los cuatro que sí
se reintentan son justo los que un segundo intento puede salvar, y son los que dejan
al dueño sin sitio cuando fallan una sola vez.

### Consecuencias

- `packages/llm` no cambia: el arreglo es del agente y el contrato de `LlmClient` sigue
  igual.
- El panel deja de ver `transport_done`: verá `transport_<causa>` con los siete valores
  de la tabla, que es lo que hace legible el `design_copy_fallback` del runbook.
- El reintento gasta como mucho una llamada más que antes, y solo en los fallos
  recuperables; el tope de presupuesto de `FAST_BUDGET` ya contemplaba los dos intentos
  del copy.
- Un `refused`, un `invalid_request` o un `budget` no gastan la segunda llamada: el contador
  de llamadas del copy se queda en una y la prueba lo comprueba.
- Si aparece una causa nueva en `error.code`, sin tocar nada cae en el `?? "unknown"` y se
  reintenta; para que no se reintente hay que añadirla al corte a propósito.
- Pruebas: `agents/design/test/transport.test.mjs` cubre el reintento por `provider_error`,
  el corte por `budget`, `refused` e `invalid_request` con el contador de llamadas, y los
  siete motivos de la tabla.

