# P0-copy — Reporte de release

**Fecha:** 25 de noviembre de 2026
**Rama:** `main` (sin PR, sin ramas nuevas: el despliegue toma `main`)
**Tipo:** corrección urgente de producción (P0)

## Qué falló

En producción, un usuario escribió en el cajón de texto del chat:

> quiero una pagina web para un buffet de abogados en barranquilla

El diseño no generó nada. Terminó con estos dos textos exactos en pantalla:

- En el panel del chat de diseño: **«No pude escribir los textos de tu web. Pulsa «Diseñar de nuevo» para reintentarlo.»**
- En la cabecera del panel: **«No se pudo terminar»**

Es decir: el sitio no se guardó, no hubo borrador y el usuario se quedó sin web.

## La causa

`agents/design/src/agent.ts`, línea **140** (antes del arreglo):

```ts
if ("reason" in copyOutcome) {
  if (brief.description !== undefined) throw new CopyUnavailableError(copyOutcome.reason);
  warnings.push(`copy_fallback: ${copyOutcome.reason}`);
}
```

Cuando el modelo no devolvía textos utilizables tras el reintento, `runFastDesign` lanzaba
`CopyUnavailableError` **si el brief traía `description`**. Como el prompt que el usuario escribe
en el cajón de texto se guarda como `description` del brief, **todo sitio creado desde el cajón
de texto abortaba** en ese caso, en vez de usar el copy determinista `genericCopy`, que existe
justo para escribir la web sin inventar datos.

Ese error lo capturaba una rama dedicada del worker —`apps/workers/src/design-job.ts`, líneas
214-222 antes del arreglo— que producía el mensaje «No pude escribir los textos de tu web…» y
marcaba la ejecución como `error`. De ahí salían los dos textos que vio el usuario.

Nadie cambió nada para provocarlo: el copy genérico ya estaba implementado y probado; el `throw`
lo dejaba inalcanzable en el caso más común de uso (crear sitio desde el texto del chat).

## Qué se cambió

### `agents/design/src/agent.ts`

- Se elimina el `throw new CopyUnavailableError(...)`. Ahora, cuando no hay copy del modelo,
  siempre se avisa con `warnings.push("copy_fallback: <motivo>")` y la ejecución continúa.
- `draftSite` cae en `genericCopy`, que entrega la web completa: válida contra el esquema, sin el
  marcador `pendiente de confirmar` y sin datos inventados.
- La clase `CopyUnavailableError` se conserva exportada (la importa `apps/workers`, y el paquete
  publicado la expone), pero ya no se lanza. Se actualizan los comentarios para que digan lo que
  el código hace ahora.

### `agents/design/test/copy.test.mjs`

Dos pruebas afirmaban el aborto. Ahora afirman la entrega correcta:

- *«dos intentos rotos con brief de solo description lanza CopyUnavailableError»* pasa a
  *«…entrega la pagina y avisa copy_fallback»*: comprueba que el documento valida
  (`validateSiteDocument`), que no aparece `pendiente de confirmar` y que `warnings` lleva
  `copy_fallback`.
- La prueba de `empty_services` hace lo mismo: valida el documento, comprueba que no hay
  marcador ni datos inventados (`500 clientes`, `15 años`) y exige `copy_fallback` con motivo
  `empty_services`.
- El recuento de llamadas al modelo sube de 2 a 3 en ambas: antes la ejecución moría justo
  después del reintento del copy, sin llegar al resumen de la ronda.

### `apps/workers/src/design-job.ts`

- Se elimina la rama `catch` de `CopyUnavailableError` (líneas 214-222 antes del cambio), que ya
  era inalcanzable y era la que producía el mensaje del usuario.
- Se quita el import de `CopyUnavailableError`, que quedaba sin uso.
- El resto del `catch` no cambia: un brief inválido o un fallo real del modelo siguen sin guardar
  nada. El aviso `copy_fallback` se sigue registrando en el `console.warn("design_copy_fallback")`
  que ya existía unas líneas más abajo.

### `apps/platform/ui/DesignChat.tsx`

- Subtítulo del panel: «Responde lo que sepas. Lo demás queda por confirmar.» pasa a
  «Cuéntamelo con tus palabras. Con eso empiezo.»
- Mensaje tras enviar el prompt: «…lo que falte lo marco como pendiente y lo cambias cuando
  quieras.» pasa a «Cuando la veas, dime qué quieres cambiar.»
- Motivo: el panel prometía marcas de «pendiente» que el sistema ya no produce en este camino.
  La cadena «No se pudo terminar» (`DesignChat.tsx:410`) se mantiene: sigue siendo válida para
  los errores que de verdad abortan.

## Lo verificado (comprobado en esta sesión)

- `agents/design`: **140 tests, 140 pass, 0 fail** (`pnpm test` en `agents/design`).
- `apps/workers`: compila sin errores (`pnpm --filter @webdesign/workers build`, `tsc` limpio).
- `apps/platform`: UI construida (`pnpm --filter @webdesign/platform build` → «panel construido»).

## Lo NO verificado

- **No hubo revisión independiente de testing ni de seguridad.** Esos agentes estaban caídos y no
  se sustituyeron. Lo único verificado es lo de arriba: la suite del propio repositorio y que
  compila. Nadie ajeno a la implementación revisó el cambio.
- **No se ha probado en producción.** La corrección no se ha ejercitado contra el sitio desplegado
  ni con el caso real («buffet de abogados en barranquilla»). La verificación es de tests y
  compilación, no de extremo a extremo en el entorno real.

## Quién lo hizo

- **`p0-copy` (claude-sonnet-5)**: implementó la corrección (código, pruebas y cadenas del panel).
- **`claude-fable-5-2`**: diagnosticó el fallo y ordenó el arreglo.
- **Release (`subida-p0`, claude-haiku-5-5)**: verificación, reporte y publicación. No escribió ni
  corrigió código.

## Publicación

- **Commit del arreglo:** `751d51f630337371bc8bd8a40b27675c578409c7` (`751d51f`)
- **`origin/main` tras el push:** `751d51f630337371bc8bd8a40b27675c578409c7` — coincide con `HEAD`
- **Rama:** `main`, sin PR y sin ramas nuevas. Sin `--force` y sin `reset --hard`.
- **Archivos del commit:** los cinco previstos, ninguno más. Sin `.env`, claves ni credenciales.
- **Grafo:** reconstruido con `graphify update .` → **3345 nodos, 5476 aristas, 215 comunidades**
  desde `751d51f6`; tras publicar este reporte, **3346 nodos y 5477 aristas** desde
  `34404e94` (el nodo extra es este mismo documento).

## Pendiente conocido

- Los commits de este repositorio se firman como **`root`** porque el entorno no tiene
  `user.name` ni `user.email` configurados. Queda anotado como pendiente; no se ha configurado
  identidad por cuenta propia.
