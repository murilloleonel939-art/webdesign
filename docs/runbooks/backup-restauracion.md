# Copia de seguridad y restauración — Fase 2

Criterio de aceptación de la fase: **"backup se restaura"**. Este runbook
existe para poder demostrarlo, no para describir una intención.

Un backup que nunca se ha restaurado no es un backup: es una carpeta con fechas.
Lo que se prueba aquí es la restauración completa en una base limpia, y que el
sitio restaurado sirve el mismo contenido que el original.

## Qué hay que salvar

Tres cosas, y las tres a la vez o el resultado no sirve:

| Origen | Qué es | Cómo se pierde |
| --- | --- | --- |
| PostgreSQL | cuentas, sitios, borradores, versiones, assets, leads | disco del contenedor `postgresql` |
| `/data/sites/` | los ficheros de cada sitio: HTML publicado y assets | volumen del contenedor `plataforma` |
| `/deploy/caddy/` | el Caddyfile y, si se usa, la CA interna | volumen de `caddy` |

La base guarda la **ruta** de cada asset; los bytes viven en `/data/sites/`. Un
`pg_dump` sin el volumen restaura una base que apunta a ficheros que no están.

## Copia

En el servidor (`158.69.213.190`), con los contenedores en marcha:

```sh
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /backups/$STAMP

# Base completa, con el rol de aplicación y las políticas RLS incluidas.
docker exec postgresql pg_dump -U postgres -d plataforma -Fc \
  > /backups/$STAMP/plataforma.dump

# Ficheros de los sitios. `-a` conserva propietario y permisos.
docker run --rm -v plataforma_data:/data -v /backups/$STAMP:/out alpine \
  tar czf /out/sites.tgz -C / data

# El Caddyfile, que no está en la base.
cp -a /deploy/caddy/Caddyfile /backups/$STAMP/

sha256sum /backups/$STAMP/* > /backups/$STAMP/SHA256SUMS
```

Comprobar el tamaño antes de darlo por bueno: un `pg_dump` de 0 bytes es el
fallo más común y el más silencioso.

```sh
ls -lh /backups/$STAMP/
```

## Restauración, que es lo que se prueba

**Nunca sobre producción.** Se levanta una base aparte y se restaura ahí.

```sh
# 1. Base limpia. Si ya existe de una prueba anterior, se borra primero.
docker exec postgresql dropdb -U postgres --if-exists plataforma_restore
docker exec postgresql createdb -U postgres plataforma_restore

# 2. Restaurar. `--no-owner` deja que el rol destino mande; si no, falla por
#    roles que no existen en el contenedor nuevo.
docker exec -i postgresql pg_restore -U postgres -d plataforma_restore \
  --no-owner --no-privileges < /backups/$STAMP/plataforma.dump

# 3. Los ficheros, en un volumen de prueba y no en el de producción.
docker run --rm -v restore_data:/data -v /backups/$STAMP:/in alpine \
  tar xzf /in/sites.tgz -C /
```

Comprobar tres cosas, en este orden:

```sql
-- a) Los datos están: los mismos sitios y versiones que el original.
SELECT count(*) FROM sites;
SELECT count(*) FROM site_versions;

-- b) RLS sigue activo. Si el dump se restauró sin las políticas, todo está
--    expuesto y el sitio "funciona" igual: este es el fallo grave.
SELECT tablename, policyname FROM pg_policies ORDER BY tablename;
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname IN ('sites','assets','leads','site_versions');

-- c) El rol de la aplicación sigue siendo NOBYPASSRLS.
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'app_platform';
```

`relrowsecurity` y `relforcerowsecurity` deben ser `true` en **todas** las
tablas de sitio, y `app_platform` debe tener `rolbypassrls = false`. Si falta
una política, la restauración no ha terminado.

Después, apuntar una instancia de `plataforma` a la base restaurada y abrir un
sitio publicado, comprobando que la imagen y el HTML cargan. Comparar el
`sha256` del `index.html` del release con el del original: si coincide, los
ficheros y la base están alineados. Si el HTML carga pero las imágenes no, el
volumen de ficheros no se restauró.

## Frecuencia y retención

Copia diaria, retención de 30 días, que es el plazo de conservación de la
sección 14.1. La copia se hace fuera del horario de publicación y guarda el
`STAMP` en el nombre para poder restaurar un día concreto.

No se ha decidido todavía dónde se almacenan las copias fuera del servidor: es
una decisión abierta de la fase, porque guardar la copia en la misma máquina
protege de un borrado accidental pero no de la pérdida del servidor.

## Lo que este runbook no cubre

- Copias cifradas en reposo. Mientras no se decida el destino, no se cifran.
- Restauración punto en el tiempo (WAL). Se restaura la última copia completa.
- Migración a otra máquina. Es el mismo procedimiento, con el `pg_dump` entre
  servidores en lugar de dentro del contenedor.
