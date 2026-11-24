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
