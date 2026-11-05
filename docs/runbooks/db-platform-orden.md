# Runbook · Base de datos y `platform` en Coolify (orden fijo)

Proyecto Coolify: `webdesing`. Base: recurso *Database* PostgreSQL 18 con pgvector (`postgres`). App: `platform`.

## Regla
Un paso solo se hace cuando el anterior está verificado en los logs. Nunca se cambia una variable antes de que la migración que la necesita esté aplicada.

## Pasos

1. **Commit desplegado.** En `platform`, confirmar que el commit es `dd6add6` o posterior.
2. **Redeploy de `platform`** con `MIGRATION_DATABASE_URL` y `DATABASE_URL` con la URL del usuario `postgres` (dueño).
   - Verificar en el log: `migrations applied: 0001_sites_rls.sql, 0002_app_role.sql` y `platform on :3000`.
3. **Fijar contraseña del rol de la app** en la base (contraseña generada, nunca la de `postgres`):
   `ALTER ROLE app_platform PASSWORD '<contraseña-nueva>';`
4. **Cambiar `DATABASE_URL`** a:
   `postgres://app_platform:<CONTRASEÑA>@eiguwt7aym9kp8dhxnemqn9d:5432/postgres`
   (codificar `@ : /` en la contraseña). `MIGRATION_DATABASE_URL` se queda con `postgres`.
5. **Redeploy** y verificar en el log: `platform on :3000` sin errores de conexión.
6. **Verificar RLS:** conectar como `app_platform` y comprobar `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_platform';` → `false`.

## Qué no hacer
- No cambiar variables antes de que el commit correcto esté desplegado.
- No pegar contraseñas en el chat. Si ya se pegaron, rotarlas.
- No ejecutar las pruebas de `packages/db` contra la base de Coolify (exigen `DB_TEST_CONFIRM`).

## Pendiente
- Rotar la contraseña de `postgres` (quedó expuesta en el chat).
