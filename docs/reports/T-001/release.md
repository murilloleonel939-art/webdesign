# Reporte T-001 — release (claude-haiku-5-5)

- Fecha: 2026-11-24T11:59:49Z
- Resultado: BLOCKED

- Qué hice (3 a 5 líneas):
  - Creé la rama `feat/t-001-reintento-copy` desde `main` y añadí exactamente los 12 archivos aprobados (verificado con `git diff --cached`).
  - Commit `d9c8295` con el mensaje aprobado (12 archivos, 714 inserciones, 12 eliminaciones).
  - Push de la rama a `origin` correcto (`[new branch]`, tracking configurado).
  - Creación del PR vía API de GitHub: falló con HTTP 403. Autenticación verificada antes: `Bearer` y `token` devuelven 200 en `/user`.
  - No se hizo segundo commit ni se tocó `main`.

- Archivos tocados:
  - `.gitignore`, `.gitattributes`, `agents/design/src/agent.ts`, `agents/design/test/copy.test.mjs`
  - `docs/spec.md`, `docs/PLAN-ACCION-PRODUCTO.md`
  - `docs/adr/0002-reintento-copy-y-seo.md`, `docs/adr/0003-a1-falso-verde.md`
  - `docs/reports/T-001/diff.patch`, `senior.md`, `testing.md`, `security.md`
  - Este reporte (`release.md`) sin commitear.

- Decisiones y por qué:
  - Verifiqué que `.capturas/` y `graphify-out/` aparecen como ignorados (`!!`) y no están en el índice.
  - Verifiqué que no hay `.env` ni credenciales en el índice.
  - No usé `gh` (no instalado) ni `jq` (no instalado); el payload del PR se generó con `python3`.
  - Probé ambos esquemas de cabecera (`Bearer` y `token`); los dos autentican, así que el 403 no es de formato de cabecera.

- Pendientes y riesgos:
  - El token del remoto autentica contra `/user`, pero no tiene permiso para crear PRs en `murilloleonel939-art/webdesign` (`Resource not accessible by personal access token`). Probablemente le falta el scope/permiso de Pull requests (escritura) o no tiene acceso de escritura al repo.
  - La rama ya está en remoto. Para abrir el PR a mano: https://github.com/murilloleonel939-art/webdesign/pull/new/feat/t-001-reintento-copy
  - Git no tiene identidad configurada (`user.name`/`user.email`); el commit usó la identidad por defecto del sistema.
  - Recomendación de seguridad: el token compartido en sesiones anteriores debe considerarse expuesto (ver registro de 21 nov); conviene revocarlo y usar uno nuevo con permiso `pull_requests: write`.

- Entrego a: humano (crear PR con permiso correcto, o abrir el PR desde la URL anterior; después merge humano).

- Referencias:
  - Commit: `d9c8295` (rama `feat/t-001-reintento-copy`)
  - PR: no creado. Error: HTTP 403, `Resource not accessible by personal access token`.

## Resolución (2026-11-24)

El PR no se creó: el fine-grained PAT no tenía el permiso `Pull requests` y la API
respondió 403 `Resource not accessible by personal access token`. Se intentó de nuevo con
el token actualizado y el error se reprodujo; el token tiene `admin`, `push` y `pull` sobre
el repo, pero los permisos por recurso de un fine-grained PAT se conceden aparte.

Decisión del dueño del producto: **este proyecto no usa ramas de trabajo**, porque el
despliegue solo toma `main`. El commit `d9c8295` se lleva a `main` por avance rápido, sin
PR y sin merge de un tercero. La rama remota `feat/t-001-reintento-copy` queda como
testigo y no se borra desde aquí.

Consecuencia: la regla del brief «no mergear sin revisión humana» se cumple igual, porque
la revisión humana es esta decisión explícita de desplegar desde `main`; lo que cambia es
que no hay PR como puerta.

## Publicación final

- Fecha: 2026-11-24 (12:11 UTC aprox.)
- SHA subido a `main`: `d2d0fe3` (`502357a..d2d0fe3`, avance rápido, sin force).
- `git ls-remote origin refs/heads/main`: `d2d0fe3dcc75f8ddbea4b21d4bd1959eba881e18 refs/heads/main`.
- Rama remota `feat/t-001-reintento-copy`: no se borró; queda como testigo.
- No se borró nada, no se reescribió historia y no se tocó `.env`.

## Cierre de infraestructura

**Grafo (graphify): CONFIRMADO**
- La reconstrucción en segundo plano terminó sin errores. El log no tiene `error` ni `traceback`.
- `graphify-out/graph.json` se regeneró a las 12:12:35Z. Estado final: 3127 nodos, 5024 aristas, 204 comunidades.
- `graphify explain "generateCopy"` devuelve el nodo `agent.ts` L277 con sus 11 conexiones.
- `graphify query "reintento de copy"` devuelve 89 nodos, incluido `copy.ts` y ADR 0002. Se muestran 10 por el presupuesto de tokens.
- Los 3127 nodos superan la referencia de ~3086, así que el grafo no ha caído.
- Aviso sin efecto en el resultado: 22 archivos `.sql` no se extraen porque falta `tree_sitter_sql`.

**Memoria (claude-mem): NO RESUELTA**
- `npx claude-mem doctor` (12:13 UTC) termina con 1 check obligatorio fallando: `Hook launcher`. El launcher no reporta protocolo. Remedio que indica doctor: `npx claude-mem install`.
- Otros avisos del doctor: `Last install error` (`unknown-install-error`, PID 46225) y la actualización automática a 16.1.1 falló en `installer-exit` el 24/11 a las 02:01.
- El visor responde en `http://localhost:37700/` con HTTP 200. Worker sano en `127.0.0.1:37700`.
- Causa del 400, según el log: `OpenRouter bad request (status 400)` con cuerpo `<!DOCTYPE HTML>` y el mensaje `Bad request syntax ('{"model":"gpt-6-luna","messages":[{"role":"system"...`. Es decir, el JSON de la petición llega como línea de petición HTTP mal formada. El primer fallo fue a las 11:45:10.945 (sesión 19). El último, a las 12:12:39.372 (sesión 24), después de un reinicio del worker. El reinicio no lo arregló.
- Proveedor: `CLAUDE_MEM_OPENROUTER_BASE_URL = http://127.0.0.1:37778/v1`, modelo `gpt-6-luna`. Ese endpoint es un shim local. Hoy responde 502 `{"error":{"message":"shim has no upstream key: PATEWAY2GPT_API_KEY"}}`. Es decir, el shim no tiene la clave de su upstream configurada. Es el dato a revisar. No lo he tocado.
- No he reiniciado el worker ni cambiado la configuración de proveedor ni claves, porque el aviso pide que lo reinicie el usuario.

**Pendiente para desbloquear la memoria (requiere al humano):**
1. Configurar `PATEWAY2GPT_API_KEY` en el shim de `127.0.0.1:37778` (el proceso no lo pudo resolver desde aquí: `ps` y `pgrep` no están instalados).
2. Ejecutar `npx claude-mem install` para corregir el launcher y el último error de instalación. Antes, `npx claude-mem stop` o `kill 46225`, si ese PID sigue vivo.
3. Reiniciar el worker (`http://localhost:37700/restart`) y comprobar que la siguiente observación se guarda sin 400.

## Cierre

- Fecha: 2026-11-24 (13:15 UTC aprox.)
- Resultado: **DONE**
- `origin/main` antes de este commit: `711a7d8`. El commit de publicación es su hijo
  (`docs(reports): cierra T-001 con grafo, memoria y shim verificados`); su SHA exacto se
  comprueba con `git ls-remote origin refs/heads/main`, porque un archivo no puede contener
  el SHA del commit que lo introduce.

**Grafo: CONFIRMADO**
- `graphify explain "generateCopy"` responde correctamente.
- `graphify-out/graph.json`: 2026-11-24T13:02:53Z. Posterior al commit de código `d9c8295` (12:00:16Z).
- Estado final: 3138 nodos, 5034 aristas, 199 comunidades. Antes se verificó 3128 nodos; la reconstrucción de las 13:02 subió el número.

**Memoria: ACTIVA (criterio del brief: observador guarda y no hay 400 en la ruta del proveedor)**
- Desde las 13:05 no hay ningún `status 400` ni `bad request` en `claude-mem-2026-11-24.log`.
- Desde las 13:05 hay 50 líneas `STORED` o `CHROMA_SYNC`.
- `observer-health.json`: `consecutiveFailures: 0`, `lastSuccessAt` 1795526043776. El último error registrado, `unrecoverable`, es el 400 de `temperature` de las 12:46, ya corregido en el shim.
- Pendiente conocido, no bloqueante: `Missing last_assistant_message in session for summary prompt` (último a las 12:52:34). Lo emite el worker porque el adaptador de DSH no envía ese campo opcional. No se pierde ninguna observación: los resúmenes 17 y 21 se guardaron después del error. El arreglo identificado es `deploy/patch-claude-mem-adapter.js`, fuera de T-001.

**Reporte de infra:** [infra-shim.md](docs/reports/T-001/infra-shim.md) revisado otra vez antes de commitear. Escaneo de patrones de secretos (`sk-`, `ghp_`, `github_pat_`, claves privadas, cadenas de 32+ caracteres) sin hallazgos. Solo aparecen nombres de variables, no valores.

**Pendientes:** commit y redeploy de `deploy-work/entrypoint.sh` (fuera de git); parche del adaptador para `last_assistant_message`; `Hook launcher` en rojo en `doctor`.
