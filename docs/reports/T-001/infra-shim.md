# Reporte T-001 — infra: shim de claude-mem (claude-opus-5-5)

- Fecha: 2026-11-24T13:14Z
- Resultado: DONE (shim y corrección de temperature; quedan pendientes no bloqueantes, ver abajo)
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

## Corrección de temperature

Objetivo: que el shim no reenvíe parámetros que el upstream rechaza, para que el observador no pierda observaciones sueltas.

### Qué archivo manda

- Las dos copias eran idénticas al empezar (mismo sha256, `7b83eafa…`): `/app/deploy/llm-shim.py` y `/root/deploy-work/deploy/llm-shim.py`.
- **Hoy manda `/app/deploy/llm-shim.py`:** es la que ejecuta el proceso (PID 89133, `python3 /app/deploy/llm-shim.py`).
- **A futuro manda `/root/deploy-work/deploy/llm-shim.py`:** es la fuente del repo, y el `Dockerfile` (línea 34, `COPY deploy/ /app/deploy/`) la copia a `/app` en cada build. Un cambio solo en `/app` se perdería en el próximo deploy.
- Edité la fuente y copié con `cp -p` a `/app`. Las dos quedan en `02a2216b…`, verificadas con sha256. Así no divergen ni ahora ni en el próximo deploy.
- Copias de seguridad: `/app/deploy/llm-shim.py.bak-20261124b` y `/root/deploy-work/deploy/llm-shim.py.bak-20261124b`.

### Qué cambié (tres puntos, nada más del dialecto)

1. **`deploy/llm-shim.py:63-75`** — constante y función nuevas, junto al resto de configuración:

   ```python
   DEFAULT_ONLY_SAMPLING = ("gpt-6.1-sol",)
   SAMPLING_PARAMS = ("temperature", "top_p")

   def forwards_sampling(model: str) -> bool:
       name = (model or "").strip().lower()
       return not any(name == m or name.startswith(m + "-") for m in DEFAULT_ONLY_SAMPLING)
   ```

   Compara en minúsculas y acepta sufijos de versión (`gpt-6.1-sol-2026…`), pero no confunde otros modelos (`gpt-6-luna` y `gpt-6.1-solar` siguen reenviando). Comprobado con esos cinco nombres.

2. **`deploy/llm-shim.py:282-284`** (camino OpenAI, `_openai`, que es el que corre hoy): después de fijar `payload["model"] = MODEL` y de quitar `stream`, se descartan los dos parámetros antes de serializar.

   ```python
   if not forwards_sampling(MODEL):
       for name in SAMPLING_PARAMS:
           payload.pop(name, None)
   ```

   Va sobre una copia del payload (`payload = dict(payload)`), así que no muta la petición original. No toca `stream`, ni `messages`, ni `max_tokens`.

3. **`deploy/llm-shim.py:160-163`** (camino Anthropic, `to_anthropic`): el mismo criterio, envolviendo el `for` que copiaba `temperature` y `top_p` al cuerpo. Sin esto, los dos caminos divergirían en cuanto se cambie `SHIM_UPSTREAM_API`.

- Se decide por el **modelo destino** (`MODEL`, el que se envía al upstream), no por el que pide el cliente. Es lo correcto: el shim fuerza siempre `MODEL` y es el upstream quien rechaza.
- Streaming: no se toca. El shim ya quitaba `stream` del cuerpo hacia el upstream y respondía él mismo; con `temperature` fuera del cuerpo, los dos caminos siguen igual.
- Se descarta, no se reescribe a 1: pedir el valor por defecto no aporta nada y omitirlo es lo que el upstream documenta como válido.

### Pruebas

| Prueba | Resultado |
| --- | --- |
| `POST /v1/chat/completions` sin streaming | **200** |
| `POST /v1/chat/completions` con `stream: true` | **200** |
| **Diez peticiones seguidas** con `temperature: 0.3` y `top_p: 0.9` explícitos | **10/10 → 200** |
| Tres ciclos reales del observador (sesiones `t001-tempshim-1..3`) | 6 llamadas OK, 6 `STORED` |
| Errores en el shim desde el reinicio (13:05) | 18 peticiones reenviadas, **0** errores, 19 respuestas 200 |
| `400` nuevos en el log de claude-mem desde las 13:05 | **0** (vigilado hasta las 13:11) |
| `observer-health.json` | `consecutiveFailures: 0` |

Los dos `upstream HTTP 400` de `temperature` que quedan en `/root/.llm-shim/shim.log` están en las líneas 307 y 325, **antes** del arranque de las 13:05 (línea 338). No hay ninguno posterior.

Matiz honesto sobre la causa: el rechazo es intermitente y del lado del upstream. Antes del cambio, 3 peticiones idénticas dieron 200, 200 y 400. Una prueba de control con 6 peticiones **directas** al upstream (sin shim, misma clave y `temperature: 0.3`) dio 6/6 en 200, o sea que no se reprodujo a voluntad. No puedo afirmar qué decide el upstream; sí puedo afirmar que ahora no se le manda el campo, así que ese 400 ya no puede darse por esa causa.

## Aviso: `Missing last_assistant_message in session for summary prompt`

Lo identifiqué sin tocar nada.

- **Lo emite el worker de claude-mem**, en `worker-service.cjs` (`function FV`): `t.last_assistant_message || (g.error("SDK", "Missing last_assistant_message in session for summary prompt"), …)`. Es un `error` de log, no una excepción: el resumen sigue adelante con ese campo vacío. Tras el error de las 12:52:34 (`session-19`) se guardó el resumen 17 a las 12:52:41, y tras los de las 13:03 (`session-24`) el resumen 21 a las 13:03:10.
- **La causa está en el cliente.** El adaptador de DSH, `/root/.npm-global/lib/node_modules/claude-mem/dsh/lib/index.js`, en `sessionSummarize()` arma el cuerpo así: `{contentSessionId, project?, platformSource?}`. **Nunca** incluye `last_assistant_message`; la cadena no aparece en todo el archivo.
- El endpoint del worker sí lo acepta (`summarizeByClaudeIdSchema` lo declara opcional), y el SDK de Claude Code lo manda. Por eso no falla con Claude Code y sí con DSH.
- Comprobado en la práctica: mis ciclos sintéticos, que sí envían `last_assistant_message`, no generaron el error; las sesiones reales de DSH (`session-19`, `session-24`) lo generan todas.
- Efecto: ruido en el log y resúmenes peor informados (sin el último mensaje del asistente). **No se pierde ninguna observación ni ningún resumen.** Arreglarlo es añadir el campo en `sessionSummarize()` del adaptador, y ese archivo lo reescribe el entrypoint con `patch-claude-mem-adapter.js`: habría que tocar el parche, no el archivo. Fuera del encargo, no lo toqué.

## Pendientes y riesgos

1. ~~**Nuevo 400 intermitente por `temperature`.**~~ Resuelto en la sección «Corrección de temperature».
2. `Hook launcher` en rojo (paso 6). Necesita una ventana para `npx claude-mem stop` y después `npx claude-mem install`.
3. Persistencia: hacer commit y redeploy de `deploy-work/entrypoint.sh` y `deploy-work/deploy/llm-shim.py` (rama `main`; los dos aparecen como `M`). No lo hice: el commit no estaba en el encargo. Las copias `.bak-*` aparecen como sin seguimiento: no deben entrar en el commit.
4. `/root/.claude-mem/settings.json` todavía dice `CLAUDE_MEM_OPENROUTER_MODEL=gpt-6-luna` y `CLAUDE_MEM_MODEL=gpt-6-luna`.
   - No afecta: el shim fuerza siempre `SHIM_MODEL` (en el log: `asked 'gpt-6-luna', using 'gpt-6.1-sol'`).
   - El entrypoint no reescribe ese archivo si ya existe. Lo dejé igual porque no estaba en el encargo.
5. Los PID 19 y 87145 (shims anteriores) son zombis colgados de PID 1. No ocupan el puerto y desaparecen con el próximo reinicio del contenedor.
6. Sigue en pie lo que dijo el lead: la clave de 43 caracteres que dio el dueño no se usó ni se escribió en ningún sitio.
7. **Aviso `Missing last_assistant_message`:** viene del adaptador DSH (`sessionSummarize()` no envía el campo). No se pierde nada, pero ensucia el log y empobrece los resúmenes. Se corrige en `deploy/patch-claude-mem-adapter.js`. No lo toqué.
8. Rechazos del upstream distintos de `temperature`: **no vi ninguno.** Si aparecieran (por ejemplo `top_p`, `presence_penalty` o `frequency_penalty`), habría que añadirlos a `SAMPLING_PARAMS` solo cuando el log lo demuestre. `top_p` ya se descarta por precaución, porque el mensaje de error dice que el modelo solo admite los valores por defecto de muestreo; esto último es una inferencia, no lo he visto rechazado.

## Referencias

- `/root/deploy-work/entrypoint.sh:30-31` (copia: `entrypoint.sh.bak-20261124`)
- `/app/entrypoint.sh:30-31` (copia: `/app/entrypoint.sh.bak-20261124`)
- `/app/deploy/llm-shim.py` y `/root/deploy-work/deploy/llm-shim.py` (idénticos, sha256 `02a2216b…`): líneas 63-75 (`forwards_sampling`), 160-163 (`to_anthropic`) y 282-284 (`_openai`). Copias: `*.bak-20261124b`.
- `/root/deploy-work/Dockerfile:34-35`
- `/root/.npm-global/lib/node_modules/claude-mem/dsh/lib/index.js` (`sessionSummarize`)
- `/root/.llm-shim/shim.log`, `/root/.claude-mem/logs/claude-mem-2026-11-24.log`, `/root/.claude-mem/observer-health.json`
- `/root/.claude-mem/backups/pre-install-20261124/`
