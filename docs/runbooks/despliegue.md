# Runbook · Despliegue y variables de entorno

Qué variables necesita cada servicio, dónde se ponen y qué pasa si faltan.
Todo se configura en Coolify, en el recurso indicado, y **después hace falta
redeploy**: las variables se leen al arrancar el proceso, no en caliente.

## Variables por servicio

### `platform` (apps/platform)

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | conexión con el rol `app_platform` (RLS activo) |
| `SITES_ROOT` | no (default `/data/sites`) | raíz de los ficheros de cada sitio |
| `REDIS_URL` | para el diseño con IA | cola de ejecuciones del agente |
| `PREVIEW_SECRET` | para la vista previa | firma los enlaces de un solo uso |
| `DIAGNOSTIC_TOKEN` | no | activa `/app/diagnose` (ver `diagnostico.md`) |
| `PEXELS_API_KEY` | no | banco de fotos y vídeos de Pexels |
| `MEDIA_LIBRARY_ROOT` | no (default `/data/biblioteca`; en desarrollo `.data/biblioteca`) | caché compartida de imágenes de Pexels |

`PEXELS_API_KEY` va **solo en el servicio `platform`**. Ni el gateway, ni los
workers, ni los agentes la necesitan: la descarga de fotos la hace la plataforma
en la ruta interna y el agente solo recibe el `assetId`. Una clave repartida por
todos los contenedores multiplica los sitios por los que puede salir sin que
haga falta.

Sin `PEXELS_API_KEY` la plataforma arranca igual: la ruta interna de fotos
responde `503 {error:"pexels_not_configured"}` y el resto del producto no se
entera. Nunca se registra el valor de la clave en un log ni se devuelve en una
respuesta.

### `workers` (apps/workers)

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | escribe borradores y checkpoints |
| `REDIS_URL` | sí | consume la cola |

### `llm-gateway` (apps/llm-gateway)

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | presupuesto y tokens de agente |
| clave del proveedor de LLM | sí | llamadas al modelo (solo aquí) |

## Fuentes de las fotos: `FUENTES.md`, no la web

La licencia de Pexels **no exige atribución visible**, así que las páginas
publicadas no llevan créditos de imagen. La trazabilidad no se pierde: cada vez
que se registra una foto de Pexels se escribe una fila en

```
<sitesRoot>/<siteId>/FUENTES.md
```

con el id del asset, el autor, el enlace a la foto, la licencia y la fecha. En
producción eso es `/data/sites/<sitio>/FUENTES.md`; en desarrollo, la carpeta que
apunte `SITES_ROOT`.

Ese archivo **no se publica**: no entra en la release, no se sirve por HTTP y no
se muestra en la web. Es documentación del sitio, para poder responder de dónde
salió cada imagen. Si el archivo no se puede escribir, la subida de la foto no
falla: solo deja un `console.warn("fuentes_write_failed")`.

Para consultarlo en el servidor:

```sh
docker exec plataforma cat /data/sites/<siteId>/FUENTES.md
```

## Biblioteca de imágenes: `MEDIA_LIBRARY_ROOT`

`MEDIA_LIBRARY_ROOT` apunta a la **caché compartida** de fotos de Pexels: se
descarga cada imagen **una sola vez** y se reutiliza para todos los sitios, así
que no se gasta cuota de bajada cuando dos sitios piden la misma foto.

```
<MEDIA_LIBRARY_ROOT>/pexels/<id>/<id>.<ext>
<MEDIA_LIBRARY_ROOT>/pexels/<id>/meta.json
<MEDIA_LIBRARY_ROOT>/pexels/README.md
```

La carpeta se llama `pexels` para que se vea de dónde salió cada archivo. El
`README.md` de esa carpeta lleva la tabla de autor, enlace, licencia, primera
descarga y sitios que usan cada foto.

- **No está bajo `SITES_ROOT`**: es común a todos los sitios y **no se publica
  nunca por HTTP**. La única ruta que sirve ficheros es
  `/assets/<siteId>/<kind>/<fichero>` y lee siempre de `SITES_ROOT`.
- **El volumen debe persistir entre despliegues.** Si se monta en efímero, cada
  redeploy vacía la caché y se vuelve a bajar todo: no se pierde nada, pero se
  gasta cuota otra vez.
- **Se puede borrar sin romper ningún sitio.** Cada sitio guarda su propia copia
  como asset (`/data/sites/<sitio>/assets/...`), así que la biblioteca es solo
  caché. Borrarla obliga a volver a descargar, nada más.

```sh
docker exec plataforma ls /data/biblioteca/pexels | head
docker exec plataforma cat /data/biblioteca/pexels/README.md
```

## Orden de despliegue

1. Migraciones (`MIGRATE_ON_START=1` o el job de migración) antes de arrancar la
   versión nueva: `0022_agent_token_check.sql` crea la función que valida el
   token de agente en la ruta interna de fotos.
2. `platform`, que publica la ruta nueva.
3. `workers` y `llm-gateway`, que no dependen de la ruta nueva.

## Comprobaciones después del redeploy

```sh
curl -sf https://<host>/healthz          # {"status":"ok"}
```

- Si hay `PEXELS_API_KEY`: pedir fotos desde el agente devuelve `{photos:[...]}`
  con `assetId`, y aparece `/data/sites/<sitio>/FUENTES.md`.
- Si no hay clave: `503 pexels_not_configured`. Es el comportamiento esperado, no
  un fallo del despliegue.
