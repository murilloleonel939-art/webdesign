# Reporte P0-chat-y-editor — release

- Fecha: 2026-11-26 (hora de la sesión: 16:40 UTC)
- Tarea: chat con la frase del cliente y editor sin parpadeo en blanco
- Rama desplegada: `main` (sin PR, sin rama nueva)
- Resultado: DONE

## SHAs

| Ref | SHA |
|---|---|
| Commit de la corrección | `7aa96754cc459c0aff0144dd4ca1a7bdcef2e40f` (`7aa9675`) |
| `origin/main` tras el push | `7aa96754cc459c0aff0144dd4ca1a7bdcef2e40f` |

Push: `f28f515..7aa9675  main -> main`. El SHA remoto coincide con `HEAD`
(comprobado con `git ls-remote origin refs/heads/main`).

## Grafo

El hook de graphify se disparó tras el commit y reconstruyó el grafo sin intervención manual.

- Nodos: **3400**
- Aristas: **5564**
- Comunidades: **233**

Cifras leídas de `graphify-out/graph.json` (3400 nodos) y del aviso del watcher (5564 aristas,
233 comunidades). `graphify-out/` está en `.gitignore`, así que el grafo es artefacto local y no
entra en el commit.

## Archivos commiteados

```
 apps/platform/test/design-chat-flow.test.mjs |  30 +++++++++++-
 apps/platform/ui/design-chat-flow.ts         |  24 ++++++++++
 apps/platform/ui/panel.tsx                   |  71 +++++++++++++++++++++++-----
 3 files changed, 112 insertions(+), 13 deletions(-)
```

No se añadió `docs/PLAN-VIABLE.md` (sin relación con el encargo, sin seguimiento) ni
`apps/platform/ui-dist/` (ignorado en `.gitignore`, línea 12). No había `.env`, claves ni
credenciales en el diff.

## Verificación previa a la publicación

- `git branch --show-current` → `main`
- `git status --short` antes de añadir → los tres archivos del fix y `?? docs/PLAN-VIABLE.md`
- `pnpm typecheck` en `apps/platform` → `tsc -p tsconfig.json --noEmit`, exit 0
- `pnpm test` en `apps/platform` → **75 tests / 73 pass / 0 fail / 2 skipped**
  (los 2 omitidos son preexistentes: no hay base de datos)

## Qué se publicó

**Bug 1: el chat mostraba la idea del diseño como si fuera el mensaje del cliente.** El agente
sobrescribe `design.idea` con el resumen del preset y el panel leía ese campo. Ahora el panel usa
`design.brief` (la frase del dueño) y solo cae a `idea` cuando `brief` está vacío, que es el caso
de un sitio recién creado y aún sin diseñar. Función nueva `ownerPrompt()` en
`apps/platform/ui/design-chat-flow.ts`, usada en `apps/platform/ui/panel.tsx`.

**Bug 2: el lienzo del editor parpadeaba en blanco al terminar.** Al decir el chat «Tu web está
lista», el editor pintaba el documento anterior mientras la recarga del borrador iba por su
cuenta. Ahora el panel marca `pendingDoc`, muestra el esqueleto que ya existía y espera a que la
revisión del borrador avance (hasta 5 reintentos, unos 1,6 s) antes de pintar.

Pruebas nuevas en `apps/platform/test/design-chat-flow.test.mjs`: `ownerPrompt` con `brief`,
con `brief` vacío y `idea` como fallback, recorte de espacios y cadena vacía sin datos.

## Pendientes

- **Firma del commit.** El commit sigue firmado por `root <root@927ff6249af8>`: el entorno no
  tiene `user.name` ni `user.email` configurados. No se tocó la configuración de git.
- **Gateway del modelo.** Según el lead, sigue devolviendo 502 `provider_error`. No lo
  reverifiqué en esta tarea.
- **Pexels.** Según el lead, la clave responde 401 `Invalid API key`. No lo reverifiqué en esta
  tarea.
- **Verificación en navegador.** No se comprobó en la GUI desplegada; la verificación es de
  typecheck y pruebas unitarias.

## Nota de alcance

No se escribió ni se corrigió código en esta tarea: el rol era publicar lo ya verificado.
