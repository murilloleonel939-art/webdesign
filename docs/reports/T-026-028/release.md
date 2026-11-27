# T-026 + T-027 + T-028 — Release (contenido del dueño, fusión y herencia del brief)

- **Fecha:** 2026-11-27 (UTC)
- **Rama:** `main` (sin PR, sin ramas nuevas, sin `--force`, sin `reset --hard`)
- **Commit de código:** `376525d1a33ce156841c7e262e45450354c52754` (`376525d`), autor `root`. Sin firma GPG (`%G?` = N).
- **Remoto:** `git ls-remote origin refs/heads/main` devuelve `376525d1a33ce156841c7e262e45450354c52754`, idéntico al local (comprobado tras el push).
- **Grafo:** 3758 nodos y 6159 aristas en el commit de código (`built_at_commit` = `376525d`); tras reconstruirse sobre este reporte, 3767 nodos y 6170 aristas (257 comunidades). El conteo sube con cada documento nuevo, así que conviene leerlo junto a su `built_at_commit`.
- **Commit del reporte:** `1242661` — el SHA final publicado en `main`.

## Contenido publicado

### T-026 — el dueño puede dar sus datos
- Tercera pestaña **«Contenido»** en el panel, junto a «Sitio» y «Dominio», con tres bloques: cifras (`[cifra] [etiqueta]`), testimonios (`[cita] [nombre] [rol]`) y precios (`[nombre] [precio] [qué incluye]` + casilla de destacado).
- Guarda por el mismo `PUT /draft` con `expectedRev` y 409.
- Todo opcional: sin datos, el sitio sale como hasta ahora.
- Los `maxLength` de los campos coinciden con el esquema y los botones de añadir se deshabilitan al llegar al máximo.
- Archivos nuevos: `packages/site-schema/src/owner.ts`, `packages/site-schema/test/owner.test.mjs`.

### T-027 — rediseñar ya no borra el contenido del dueño
- `markOwnerEdits` marca en el guardado del panel los props que tocó el dueño (`section.ownerEdited`, campo nuevo **opcional**; se omite del documento cuando no hay marcas, así que los borradores anteriores siguen siendo válidos).
- `mergeOwnerContent` los conserva al regenerar: los tres bloques de datos se preservan enteros y se reinsertan si el patrón nuevo no los pide; el contacto conserva email y teléfono; los textos marcados ganan.
- Un cambio explícito pedido en el chat caduca esas marcas, para que «cambia el titular a X» sí se aplique.
- Estructura, orden y estilo siguen viniendo del rediseño.
- Archivo nuevo: `apps/workers/test/design-owner-merge.test.mjs`.

### T-028 — el rediseño hereda el brief
- La ruta lee el borrador y completa `name` (`meta.name`), `businessType`/`city`/`service` (de `design.brief`, y si la cabeza no se parte, de `describeFromText(design.ownerPrompt)`) y `contact` (de la sección).
- Solo rellena huecos: lo que el dueño acaba de escribir manda.
- `ownerProvided` deja de ser editable en el editor de Puck; se confirma en la pestaña «Contenido».
- Archivos nuevos: `apps/platform/src/brief-inherit.ts`, `apps/platform/test/design-brief-inherit.test.mjs`.

## Verificación (lo comprobé, ejecutado en este contenedor)

```
apps/platform    tests 102 · pass 99 · fail 0 · skipped 3
apps/workers     tests  42 · pass 42 · fail 0
packages/site-schema tests 47 · pass 47 · fail 0
packages/editor  tests   6 · pass  5 · fail 0 · skipped 1
agents/design    tests 207 · pass 207 · fail 0
pnpm typecheck (raíz)  exit 0 · 41 tasks successful (41 cached, FULL TURBO)
```

- Rama actual: `main`. `git status --short` limpio tras el commit, salvo `docs/PLAN-VIABLE.md`, que quedó **sin versionar a propósito**.
- Se publicaron 22 archivos (17 modificados + 5 nuevos). `apps/platform/ui-dist/` **no** entró en el commit.
- Búsqueda del token de seguridad en el repo (`grep -rn` excluyendo `node_modules` y `.git`): **cero coincidencias**.
- Revisión del diff staged por patrones de credenciales: los únicos aciertos son identificadores de test (`tokenMatches`, `revokeToken`, `token: "jti"`, `sid=token-de-prueba`). Sin secretos reales.
- Nunca se imprimió la URL del remoto ni ningún token: la salida del push se filtró por `sed` antes de mostrarse.

## Pendientes y riesgos conocidos

1. **Los textos editados a mano antes de este cambio no tienen marca.** `ownerEdited` es opcional, así que esos documentos siguen siendo válidos, pero sus props no están anotados: se perderían en el primer rediseño. Quedan protegidos a partir del primer guardado en el panel.
2. **Si el rediseño elimina una sección editorial que el dueño había escrito, su texto se va con la estructura.** Manda la estructura; la fusión protege props dentro de secciones que sobreviven, no secciones que desaparecen.
3. **El gateway sigue en 502.** El copy lo sigue escribiendo el generador, no el modelo. Heredado de T-025; no lo he vuelto a comprobar en esta sesión.
4. **Siguen habiendo 8 fallos preexistentes en `cycle.test.mjs` contra Postgres real.** Ajenos a este cambio; no requieren Postgres para el resto de la suite. No los he re-ejecutado aquí.

## Notas de proceso

- No se escribió ni corrigió código en esta tarea: solo verificación, commit, push y este reporte.
- El hook de graphify lanzó la reconstrucción en segundo plano tras el commit; el `graph.json` resultante ya tiene `built_at_commit` = `376525d`, es decir, refleja el estado publicado.
