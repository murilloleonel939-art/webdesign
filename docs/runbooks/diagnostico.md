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

Los `error`/`note` del informe son **códigos fijos**, nunca el mensaje del driver: este
último puede arrastrar host, usuario o SQL. El detalle real se registra solo en el servidor.

## Códigos de estado

- **200** — conecta y no falta ninguna migración esperada.
- **503** — conecta pero falta alguna migración, o no hay base configurada.
- **401** — token incorrecto.
- **404** — diagnóstico desactivado, o cualquier otro motivo.

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
