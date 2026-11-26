# Reporte P0-transporte-y-fotos — release

- Fecha: 2026-11-26 15:59 UTC
- Tarea: reintento por causa real del fallo y búsqueda de fotos sin copy del modelo
- Rama desplegada: `main` (sin PR, sin rama nueva)
- Resultado: DONE

## SHAs

| Ref | SHA |
|---|---|
| Commit de la corrección | `3a93efccce954c5899985ba4ee3807678c8557ec` (`3a93efc`) |
| `origin/main` tras el push | `3a93efccce954c5899985ba4ee3807678c8557ec` |

Push: `9293a96..3a93efc  main -> main`. El SHA remoto coincide con `HEAD`
(comprobado con `git ls-remote origin refs/heads/main`).

## Grafo

El hook de graphify se disparó al hacer el commit y reconstruyó el grafo
(2026-11-26 15:59 UTC), sin intervención manual.

- Nodos: **3397**
- Aristas: **5559**
- Comunidades: **234**

`graphify-out/` está en `.gitignore` (línea 17), así que el grafo es artefacto local y no entra
en el commit. Cifras del grafo final, con este reporte ya dentro (el hook reconstruyó dos veces:
3388 nodos / 5549 aristas / 217 comunidades tras el commit de la corrección, y 3397 / 5559 / 234
al añadir este archivo).

## Archivos commiteados

```
 agents/design/src/agent.ts            |  49 ++++--
 agents/design/test/transport.test.mjs | 288 ++++++++++++++++++++++++++++++++++
 docs/adr/0002-reintento-copy-y-seo.md |  72 +++++++++
 3 files changed, 396 insertions(+), 13 deletions(-)
```

`git diff --cached --name-only` confirmó exactamente esos tres antes del commit. No había `.env`,
claves ni credenciales en el diff; las coincidencias de `token` en la prueba son fixtures
(`token: "t"`, `maxTokens`, `tokensIn`).

## Verificación previa a la publicación

- `git branch --show-current` → `main`
- `git status --short` antes de añadir → solo los tres archivos del encargo
  (` M agent.ts`, ` M 0002-...md`, `?? transport.test.mjs`)
- `pnpm build` en `agents/design` → `tsc -p tsconfig.json`, sin errores
- `pnpm test` en `agents/design` → **147 tests / 147 pass / 0 fail**

Coincide con lo esperado. No se cambió ninguna expectativa de prueba para forzar el verde.

## Qué se publicó

**Bug 1 — el corte del reintento lo decide la causa, no el prefijo.** `LlmClient` solo devuelve
`done` y `budget`, así que un 502, un timeout y un rechazo del modelo llegaban los tres como
`transport_done`. El motivo ahora se construye con `error.code`
(`agents/design/src/agent.ts:340`) y el corte es una lista explícita de causas reintentables
(`agents/design/src/agent.ts:301`, aplicada en `:377`): solo `budget`, `invalid_request` y
`refused` cortan; `timeout`, `rate_limit`, `provider_error` y `unknown` se reintentan.

**Bug 2 — sin copy del modelo se buscan fotos igual.** `loadPhotos` sale antes de la red solo si
no hay `fetchPhotos`; las consultas caen ahora en `genericCopy(brief).photoQueries` cuando falta
el copy del modelo, así que Pexels se llama aunque el modelo haya fallado.

**ADR 0002.** La decisión original se conserva como historia y se añade la revisión con la
Decisión 3 y la tabla de los siete motivos. Las referencias lineales del ADR
(`agent.ts:301`, `:340`, `:377`) se comprobaron contra el archivo commiteado: son exactas.

Pruebas nuevas en `agents/design/test/transport.test.mjs`: reintento por `provider_error`, corte
por `budget` con el contador de llamadas en una, motivo con la causa real en vez de `stop.kind`, y
las dos ramas de fotos (consultas del copy de emergencia y consultas del copy del modelo).

## Pendientes

- **Firma del commit.** Los commits siguen firmados por `root <root@927ff6249af8>`: el entorno no
  tiene `user.name` ni `user.email` configurados. No se tocó la configuración de git.
- **Constructor del panel.** No se refresca tras diseñar. Es la siguiente tarea; no entra aquí.
- **Copy de emergencia.** Sigue ignorando `description`.
- **`/root/deploy-work`.** `entrypoint.sh` y `deploy/llm-shim.py` sin commitear, fuera de este
  repo. Confirmado con `git status --short`: ` M deploy/llm-shim.py`, ` M entrypoint.sh`, más dos
  respaldos `.bak-20261124` sin seguimiento.

## Nota de alcance

No se escribió ni se corrigió código en esta tarea: el rol era publicar lo ya verificado. El árbol
quedó limpio (`git status --short` sin salida) tras el commit de la corrección.
