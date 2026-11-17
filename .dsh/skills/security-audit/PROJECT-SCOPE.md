# Alcance del proyecto (adaptación local)

Este archivo es local de zottaweb y NO forma parte del upstream de Cloudflare.
Adapta la skill de auditoría a nuestro stack. En caso de conflicto, manda SKILL.md
del upstream salvo en lo que aquí se restringe o se excluye.

## Producto

Producto multi-inquilino de sitios web generados por IA. La base de datos es
Postgres 18 con **RLS FORZADO** (FORCE ROW LEVEL SECURITY). La aplicación se conecta
con el rol `app_platform`, que es **NOBYPASSRLS**: no puede saltarse las políticas.
Cualquier acceso que dependa de RLS debe auditarse asumiendo ese rol, no un superusuario.

## Clases de ataque relevantes

Solo estas cinco se aplican a nuestro código:

- `DATA-ISOLATION-AND-LIFECYCLE.md` — aislamiento entre cuentas y entre propietarios,
  borrado de datos y exportación.
- `WEB-PROTOCOL-AND-AUTH.md` — sesiones, cookies, CSRF y caché.
- `CLIENT-SIDE.md` — XSS en el HTML que emitimos, tabnabbing, CSP.
- `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` — cuotas, coste de modelo y colas.
- `SUPPLY-CHAIN-AND-RELEASE.md` — dependencias y el pipeline de publicación.

## Clases que NO aplican

- `MEMORY-SAFETY-AND-BINARY.md` — no hay código nativo.
- `DESKTOP-MOBILE-AND-LOCAL-IPC.md` — no hay apps de escritorio ni IPC local.

Se conservan por fidelidad al upstream, pero no se ejecutan en nuestras auditorías.

## Superficie de entrada prioritaria

1. El documento JSON del sitio — `packages/site-schema`.
2. El HTML emitido — `packages/renderer`.
3. Las rutas HTTP — `apps/platform/src/server.ts`.
4. Las políticas RLS — `packages/db/migrations`.
5. Los assets — `packages/storage`.

## Límites de prueba

- El HTML publicado se sirve con CSP `script-src 'none'`
  (`packages/renderer/src/index.ts:49`). Esa política es el contrato: no se asume
  que haya JS en la página publicada.
- **NUNCA** se prueba contra producción (`zottaweb.site`) ni contra endpoints
  desplegados. La skill ya lo prohíbe; aquí se reitera. Todo análisis es estático
  sobre el checkout local y, si acaso, contra un entorno local propio.
