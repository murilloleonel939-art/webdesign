# T-033 — Release: el gateway registra sus fallos y el healthcheck no miente

Fecha: 2026-11-26 (commit y push)

## Qué se publicó

- Commit: `ea5d46c` — `fix(gateway): el fallo del proveedor se registra y /healthz deja de mentir`
- Rama: `main` (sin PR)
- Remoto: `ea5d46c665169669adfa34953a5eb78d3452a86c refs/heads/main` (verificado con `git ls-remote`)
- Commit anterior: `4296f18`
- Ficheros: `apps/llm-gateway/src/server.ts`, `apps/llm-gateway/package.json`, `apps/llm-gateway/test/server.test.mjs`
- Fuera del commit a propósito: `docs/PLAN-VIABLE.md` (sin trazar)

## Problema

En producción, todas las llamadas al `llm-gateway` devolvían `502 {"error":"error"}` sin escribir ninguna línea de log. Faltaba `LLM_PROVIDER_API_KEY` en el contenedor. Además, `GET /healthz` respondía `200 {"ok":true}` siempre, así que el healthcheck de Coolify daba verde con el servicio inservible.

## Cambios

1. **Log del fallo:** antes de responder el 502, una línea en stderr con `reason`, `code`, `message` (recortado a 200 caracteres y sin saltos de línea), `runId` y `modelId`. Nunca la clave, la URL con credenciales ni el cuerpo de la petición.
2. **`/healthz` que no miente:** comprueba que `LLM_PROVIDER_API_KEY` y `DATABASE_URL` están definidas y no vacías. Si falta alguna, responde `503 { ok: false, missing: [...] }` solo con los nombres. No llama al proveedor.

## Verificación (comprobado)

- Rama `main`, árbol con solo los ficheros indicados.
- `pnpm build` en `apps/llm-gateway`: sin errores (`tsc`, exit 0).
- `pnpm test` en `apps/llm-gateway`: 20 tests, 20 pass, 0 fail.
- Búsqueda de secretos en el diff: sin coincidencias de valores reales (solo los nombres de variables y valores de prueba `sk-prueba-no-real`).
- Push verificado con `git ls-remote`.

## Grafo

- `graphify-out/graph.json`: 3453 nodos (reconstruido tras el commit).

## Pendiente

- **Aviso importante:** al desplegar, el gateway pasará a `unhealthy` en Coolify hasta que se defina `LLM_PROVIDER_API_KEY`. Es el comportamiento buscado: el fallo se ve en el despliegue, no en el primer cliente.
- El despliegue del gateway es un recurso de Coolify, fuera de este repositorio.
- El usuario debe añadir `LLM_PROVIDER_API_KEY` al contenedor del gateway.
- El banco de fotos sigue pendiente de curación (fuera de este release).
- Los commits están firmados por `root` (identidad local de git, no configurada en este repositorio).
