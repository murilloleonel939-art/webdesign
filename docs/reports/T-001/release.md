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
