# Runbook · Diagnóstico de plataforma y base de datos

## Para qué sirve

Responder, sin entrar al contenedor, estas preguntas:

- ¿`platform` habla con Postgres?
- ¿Qué migraciones están aplicadas y cuáles faltan?
- ¿Cuántas filas hay en cada tabla del ciclo del sitio?
- ¿Qué carpetas existen en `/data/sites`?

Nunca devuelve datos personales (correos, teléfonos, nombres) ni secretos: solo recuentos,
estados y nombres de migración. El código que lo garantiza está en
`apps/platform/src/diagnose.ts` y la prueba lo comprueba buscando un `@` y claves tipo
`password` en la respuesta.

## Activación

El endpoint **no existe** si `DIAGNOSTIC_TOKEN` no está definida o tiene menos de 16
caracteres. No hay ruta, no hay 401: la petición cae en el 404 normal.

En Coolify, recurso `plataforma` → Environment Variables:

```
DIAGNOSTIC_TOKEN=<valor largo y aleatorio>
```

Generarlo con algo como `openssl rand -hex 32`. Después, **redeploy** del recurso.

## Uso

```bash
curl -s https://zottaweb.site/app/diagnose \
  -H "x-diagnostic-token: TU_TOKEN" | python3 -m json.tool
```

Salida esperada, resumida:

```json
{
  "ok": true,
  "database": { "reachable": true, "version": "PostgreSQL 18", "role": "app_platform" },
  "migrations": { "applied": 7, "missing": [] },
  "counts": { "users": 1, "sites": 1, "assets": 4, "domains": null, "leads": null },
  "storage": { "sitesRoot": "/data/sites", "sitesOnDisk": ["<uuid>"] }
}
```

## Cómo leer el resultado

| Síntoma | Qué significa | Qué hacer |
| --- | --- | --- |
| HTTP 404 | `DIAGNOSTIC_TOKEN` no está definida o tiene menos de 16 caracteres | Definir la variable y redeploy |
| HTTP 401 | Token mal escrito o ausente en la cabecera | Revisar el valor exacto |
| `database.error: "db_unreachable"` | `platform` no alcanza Postgres | Revisar `DATABASE_URL`, credenciales y que `postgresql` esté `Running`; el mensaje real del driver queda en el log de `plataforma` con `console.error("diagnose", …)` |
| `database.reachable: false` | `platform` no alcanza Postgres | Revisar `DATABASE_URL` y que `postgresql` esté `Running` |
| `migrations.note: "migrations_unreadable"` | El rol de la app no puede leer `schema_migrations` | Es lo esperado con `app_platform`: el informe se apoya en las tablas. El error real está en el log |
| `storage.error: "storage_unreadable"` | No se pudo listar `/data/sites` | Revisar el volumen montado y sus permisos; el error real está en el log |
| `migrations.missing` con entradas | Migración no aplicada | Revisar los logs de arranque de `plataforma` |
| `counts.domains: null` | La migración `0008` no está aplicada | Normal hoy; llega con Fase 2 |
| `ok: false` con base alcanzable | Conecta pero falta una migración | Es el caso anterior |
| `storage.sitesOnDisk: []` | No hay ningún sitio en disco | Coherente: todavía no se publicó ninguno |
| `llm-gateway` responde `{"error":"error"}` con `missing provider key` en el log | Falta `LLM_PROVIDER_API_KEY` en el entorno del gateway | Definir `LLM_PROVIDER_API_KEY` (y `LLM_PROVIDER_BASE_URL` si el endpoint no es el de por defecto) y redeploy. La clave solo vive en `llm-gateway`, nunca en `platform` ni en `workers` |

Los `error`/`note` del informe son **códigos fijos**, nunca el mensaje del driver: este
último puede arrastrar host, usuario o SQL. El detalle real se registra solo en el servidor.

## Cambiar el modelo del agente de diseño sin tocar código

El alias interno `design` (catálogo en `packages/llm/src/index.ts:90`, id
`claude-sonnet-5`) no cambia: todo el sistema sigue pidiendo `design`. Lo que se cambia es a qué
id real lo traduce **`llm-gateway`**, con variables de entorno del contenedor. No hace falta
desplegar ni editar código; basta redeploy del recurso para que el contenedor tome el valor.

| Variable | Efecto | Validación | Si no es válida |
| --- | --- | --- | --- |
| `LLM_DESIGN_MODEL` | Id real que se envía al proveedor en `body.model` para el alias `design` | Recortada, solo `[A-Za-z0-9._:/-]`, máximo 100 caracteres | Aviso en el log al arrancar y se usa `claude-sonnet-5` del catálogo |
| `LLM_DESIGN_USD_IN_PER_M` | Precio de **entrada** por millón de tokens, para el coste de `design` | Número > 0 | Aviso y se usan los dos precios del catálogo |
| `LLM_DESIGN_USD_OUT_PER_M` | Precio de **salida** por millón de tokens, para el coste de `design` | Número > 0 | Aviso y se usan los dos precios del catálogo |

Notas que importan al operar:

- Las dos variables de precio van **juntas**. Con una sola definida se avisa y se usan las del
  catálogo: mezclar un precio del dueño con uno del catálogo daría un coste que no corresponde a
  ningún modelo.
- Sin ninguna de las tres variables, el comportamiento es el de siempre (catálogo). Ninguna
  variable mal puesta tumba el proceso: siempre hay un valor efectivo.
- El coste se cuenta **solo** en `llm-gateway` (es quien escribe el coste persistido en
  `usage_events`) y `usage_events.model` guarda el **id real enviado**, no el alias.
- Nunca se registra `LLM_PROVIDER_API_KEY` ni el valor crudo de estas variables: el aviso nombra
  la variable, no su contenido.

Al arrancar, una línea dice qué modelo se está usando y de dónde salió:

```
llm-gateway: modelo design = claude-sonnet-5 (catalogo)
llm-gateway: modelo design = claude-opus-x (variable)
```

Comprobar que el cambio tomó efecto:

```bash
docker logs <contenedor-llm-gateway> 2>&1 | grep "modelo design"
```

Si aparece `(catalogo)` cuando esperabas `(variable)`, el valor no pasó la validación: busca en el
mismo log la línea `llm-gateway: aviso: LLM_DESIGN_MODEL no es un id valido; ...`.

## Códigos de estado

- **200** — conecta y no falta ninguna migración esperada.
- **503** — conecta pero falta alguna migración, o no hay base configurada.
- **401** — token incorrecto.
- **404** — diagnóstico desactivado, o cualquier otro motivo.

## `permission denied for table site_drafts`

**Síntoma.** Los jobs de diseño acaban en `design_job_failed` con
`permission denied for table site_drafts` en el log de workers, y el sitio no cambia: el
agente no llega a escribir nada. RLS no tiene culpa — Postgres comprueba el privilegio de
tabla antes de evaluar la política, así que el error es de GRANT, no de política.

Causa habitual: las migraciones conceden los permisos a `app_platform` dentro de bloques
`DO` condicionados a `IF EXISTS (... pg_roles ...)`. Si el rol no existía al aplicar (base
restaurada, entorno nuevo), el bloque se salta en silencio y `schema_migrations` queda
marcada como aplicada.

**Comprobación de privilegios** (con `psql`, como superusuario):

```sql
SELECT has_table_privilege('app_platform','site_drafts','SELECT');
```

`false` confirma el diagnóstico.

**Qué rol usan de verdad los workers:**

```sql
SELECT current_user;
```

Ejecutado desde la conexión de workers, no desde `psql` de administración. Si devuelve algo
distinto de `app_platform`, el GRANT correcto no es el que falta: revisa el rol de conexión.

**Qué migraciones están aplicadas:**

```sql
SELECT name FROM schema_migrations ORDER BY name;
```

**Arreglo.** Aplicar `packages/db/migrations/0021_regrant_app_tables.sql`. Reaplica los
GRANT sin condicional y falla en voz alta con
`falta el rol app_platform: aplica 0002 antes` si el rol no existe. Es idempotente: se puede
aplicar dos veces. Al final verifica con `has_table_privilege` y lanza excepción nombrando la
tabla que siga sin permiso.

## Retirar el diagnóstico

Borrar `DIAGNOSTIC_TOKEN` del entorno y redeploy. La ruta vuelve a dar 404. No hay nada
que limpiar en base de datos ni en disco.

## Comprobado

- Lógica del token: ocho casos, incluidos vacío, ausente, longitud distinta, mayúsculas
  distintas y sin variable configurada. Todos correctos.
- `runDiagnostics` con pool simulado en tres escenarios: sano, migración ausente y base
  caída. El informe se forma bien y no lanza excepciones.
- Pruebas HTTP en `apps/platform/test/cycle.test.mjs`: ruta invisible sin token (404),
  rechazo con token incorrecto (401), informe correcto con token válido (200), y
  ausencia de datos personales en el cuerpo.

**No comprobado:** contra un Postgres real. En el entorno de construcción no hay ninguno
accesible (5432 cerrado en loopback, puerta de enlace y `host.docker.internal`).

## Modo abierto (solo depuración, retirar)

`DIAGNOSTIC_OPEN=1` habilita el endpoint **sin autenticación**. Existe únicamente para una
ventana de depuración en la que no se puede generar un token. Cuando está activo, la respuesta
incluye `warning` recordándolo.

Riesgo mientras esté puesto: cualquiera que conozca la URL ve nombres de tabla, recuentos,
versión de Postgres y rutas de `/data/sites`. No hay datos personales ni secretos, pero es
información interna.

**Retirar:** borrar `DIAGNOSTIC_OPEN` del entorno y redeploy. La condición de "cerrado" es la
ausencia de las dos variables; no hay valor que dejar por descuido.
