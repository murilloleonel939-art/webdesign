# Reporte T-001 — infra: shim de claude-mem (claude-opus-5-5)

- Fecha: 2026-11-24T12:52Z
- Resultado: DONE (con un pendiente de riesgo, ver abajo)
- Alcance: infraestructura fuera del producto. No se tocó código de `webdesign`; solo se añade este reporte.

## Qué comprobé (antes de cambiar nada)

Todo lo siguiente está comprobado, no deducido:

- `/root/deploy-work/entrypoint.sh` líneas 30-31: `SHIM_MODEL=gpt-6-luna` y `SHIM_UPSTREAM_KEY_ENV=PATEWAY2GPT_API_KEY`.
- En `/root/.dsh/.credentials.yaml`, dentro de `refs:`, **no existe** `PATEWAY2GPT_API_KEY`. `GPT_6_1SOL_API_KEY` sí existe, con 44 caracteres. Solo leí nombres y longitudes; ningún valor se imprimió.
- El shim (PID 19, `python3 /app/deploy/llm-shim.py`) lee la clave de `SHIM_UPSTREAM_API_KEY` o del almacén de credenciales con el nombre de `SHIM_UPSTREAM_KEY_ENV`.
- **Credencial guardada contra el upstream** (paso 1): la clave se leyó dentro de un script de Python, sin imprimirla ni pasarla por la línea de comandos. `POST https://api.pateway.ai/v1/chat/completions` con el modelo `gpt-6.1-sol` devolvió **HTTP 200**.

## Códigos HTTP: antes y después

| Comprobación | Antes | Después |
| --- | --- | --- |
| Shim `GET /` | 200 | 200 |
| Shim `GET /health` | — | 200, `model: gpt-6.1-sol` |
| Shim `POST /v1/chat/completions` | **502** `shim has no upstream key: PATEWAY2GPT_API_KEY` | **200** (sin streaming, con streaming y 3 seguidas con keep-alive) |
| Visor `http://localhost:37700/` | 200 | 200 |
| Observador (`observer-health.json`) | `consecutiveFailures: 15`, último éxito el 21-nov | `consecutiveFailures: 0`, `lastSuccessAt` 12:49:26Z |

Sobre el 400 de las 11:45 que aparecía en el log: era el propio shim respondiendo `Bad request syntax`, con el JSON metido en la línea de la petición. Después de cada 502 la conexión keep-alive quedaba desincronizada. Con el shim respondiendo 200 no se ha vuelto a ver ese 400 de sintaxis.

## Qué cambié (sin secretos)

1. **`/root/deploy-work/entrypoint.sh`**, líneas 30-31. Copia previa en `entrypoint.sh.bak-20261124`.
   - `SHIM_MODEL=gpt-6.1-sol`
   - `SHIM_UPSTREAM_KEY_ENV=GPT_6_1SOL_API_KEY`
2. **`/app/entrypoint.sh`**, las mismas dos líneas. Copia previa en `/app/entrypoint.sh.bak-20261124`.
   - Motivo: el `Dockerfile` copia el entrypoint a `/app/entrypoint.sh` y es esa copia la que se ejecuta al arrancar el contenedor. Es otro inodo, no el mismo archivo. Si solo se cambiaba `deploy-work`, al reiniciar el contenedor el shim habría vuelto a la clave inexistente.
   - Ojo: `/app` es la capa de la imagen y se regenera en cada deploy. El cambio que perdura es el de `deploy-work` cuando se haga commit y redeploy.
3. El shim se reinició con el entorno nuevo, leído del propio entrypoint editado. El proceso viejo (PID 19) no salió con SIGTERM; se mató con SIGKILL y quedó como zombi colgado de PID 1. El nuevo es el PID 87145, con `SHIM_MODEL=gpt-6.1-sol` y `SHIM_UPSTREAM_KEY_ENV=GPT_6_1SOL_API_KEY` en su entorno.
4. Worker de claude-mem:
   - `npx claude-mem restart` terminó bien (PID 87418).
   - Después `npx claude-mem install` abortó y dejó el worker parado (detalle en el paso 6).
   - Lo volví a levantar con `npx claude-mem start` (PID 88156); visor en 200.
5. Ningún otro archivo cambió. `settings.json` y el adaptador de DSH tienen el mismo sha256 que antes; quedan copias en `/root/.claude-mem/backups/pre-install-20261124/`.

## ¿Volvió a capturar? Sí, comprobado

Hice dos ciclos reales del observador con la API del worker, usando sesiones sintéticas marcadas `t001-infra-shim-*` en el proyecto `webdesign`:

- 12:45:15Z: `OpenRouter API usage {model=gpt-6.1-sol}`, después `STORED … summaryId=18`.
- 12:49:18Z, ya con el worker definitivo: `STORED obsCount=1 obsIds=[802]` y `summaryId=19`.

Desde que arrancó el worker definitivo (12:48) hay **0** entradas `status 400` / `Bad request` en el log de claude-mem.

Aviso: esas dos sesiones de prueba quedan guardadas en la memoria de `webdesign`. Se pueden borrar si molestan.

## Paso 6: `doctor` / `Hook launcher` — NO resuelto

- `npx claude-mem doctor` sigue en `✗ Hook launcher`: `/root/.npm-global/bin/claude-mem` responde `16.0.2` a `--version`, y doctor espera un número de protocolo (3).
- Hice el `npx claude-mem install` que pedía el encargo, sin interacción. Abortó antes de sobrescribir nada: `worker-shutdown failed during pre-overwrite: The claude-mem worker (PID 87418) did not stop within 10 seconds`.
  - Efecto secundario: el worker quedó parado. Lo levanté de inmediato (ver arriba).
- No lo reintenté. Hacerlo de forma fiable exige parar el worker a mano antes del `install`, y eso deja la captura caída durante la instalación. Con la captura ya funcionando, esa decisión es del lead.
- El `Hook launcher` no impide la captura: lo demuestran los `STORED` de arriba. La línea `! Last install error … end PID 46225` del doctor es antigua; el PID 46225 es un zombi.

## Pendientes y riesgos

1. **Nuevo 400 intermitente por `temperature` (riesgo real).**
   - El upstream `gpt-6.1-sol` rechaza a veces `temperature: 0.3` con `"'temperature' does not support 0.3 with this model. Only the default (1) value is supported."`.
   - Reproducido a través del shim: 3 peticiones idénticas dieron 200, 200 y **400**.
   - El worker de claude-mem envía `temperature: .3` fijo en su código. Pasó una vez en el log, a las 12:46:38Z, en `session-19`. El observador lo marcó como `unrecoverable`, aunque el siguiente intento guardó bien (`summaryId=17`).
   - No lo arreglé porque exige cambiar `/app/deploy/llm-shim.py` (quitar o forzar `temperature` en `_openai`), y el encargo prohíbe tocar nada más que las dos líneas.
   - Propuesta para quien decida: que el shim descarte `temperature` y `top_p` cuando el modelo de destino es `gpt-6.1-sol`. Si no, de vez en cuando se perderá alguna observación suelta.
2. `Hook launcher` en rojo (paso 6). Necesita una ventana para `npx claude-mem stop` y después `npx claude-mem install`.
3. Persistencia: hacer commit y redeploy de `deploy-work/entrypoint.sh` (está en `main`, aparece como `M entrypoint.sh`). No lo hice: el commit no estaba en el encargo.
4. `/root/.claude-mem/settings.json` todavía dice `CLAUDE_MEM_OPENROUTER_MODEL=gpt-6-luna` y `CLAUDE_MEM_MODEL=gpt-6-luna`.
   - No afecta: el shim fuerza siempre `SHIM_MODEL` (en el log: `asked 'gpt-6-luna', using 'gpt-6.1-sol'`).
   - El entrypoint no reescribe ese archivo si ya existe. Lo dejé igual porque no estaba en el encargo.
5. El PID 19 (el shim viejo) es un zombi colgado de PID 1. No ocupa el puerto y desaparece con el próximo reinicio del contenedor.
6. Sigue en pie lo que dijo el lead: la clave de 43 caracteres que dio el dueño no se usó ni se escribió en ningún sitio.

## Referencias

- `/root/deploy-work/entrypoint.sh:30-31` (copia: `entrypoint.sh.bak-20261124`)
- `/app/entrypoint.sh:30-31` (copia: `/app/entrypoint.sh.bak-20261124`)
- `/app/deploy/llm-shim.py:57,108-109,263-279`
- `/root/.llm-shim/shim.log`, `/root/.claude-mem/logs/claude-mem-2026-11-24.log`, `/root/.claude-mem/observer-health.json`
- `/root/.claude-mem/backups/pre-install-20261124/`
