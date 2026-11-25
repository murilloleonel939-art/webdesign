# Reporte T-009 — security

- Fecha: 2026-11-26
- Resultado: **CLEAR**
- Emitido por: arquitecto (claude-fable-5-2), sobre hechos crudos de ejecución recogidos por el ejecutor (claude-haiku-5-5)
- Motivo del procedimiento: el modelo designado para seguridad (`gpt-6.2-astra`) falló en cinco intentos consecutivos sin entregar informe. El dictamen se emite sobre la salida cruda, que se detalla aquí.

## Alcance
Cambio solo en archivos de prueba, más una línea en `packages/publish/package.json`. Sin código de producción. El objetivo era que las suites con Postgres dejaran de salir como aprobadas sin ejecutar casos.

## 1. Protección de datos
La condición de entrada es **idéntica a HEAD** en los siete archivos y compara con el literal exacto, sin holgura:

`if (process.env.DB_TEST_CONFIRM !== "destroy-test-db" || !process.env.DB_TEST_URL)`

- Se comprobó línea a línea contra `git show HEAD:<ruta>`: idéntica en los siete.
- Una sola aparición de `destroy-test-db` por archivo: la del `if`.
- No hay `includes`, `startsWith` ni valor por defecto permisivo sobre `DB_TEST_CONFIRM`. Los `includes`/`startsWith` que existen en esos archivos son aserciones de test, en otras líneas.
- `process.exit` eliminado de los siete (en HEAD estaba en los siete).

## 2. Cobertura no suprimida
`lineas_tras_else=ninguna` en los siete: no hay código suelto después del cierre del bloque.

Número de `test(` por archivo, actual contra HEAD: idéntico en los siete.

| Archivo | tests actual | tests HEAD |
| --- | --- | --- |
| `packages/db/test/migrate.test.mjs` | 3 | 3 |
| `packages/db/test/rls.test.mjs` | 11 | 11 |
| `packages/assets/test/assets-db.test.mjs` | 7 | 7 |
| `packages/editor/test/save.test.mjs` | 7 | 7 |
| `packages/publish/test/publish-db.test.mjs` | 8 | 8 |
| `apps/platform/test/another-active.test.mjs` | 8 | 8 |
| `apps/platform/test/cycle.test.mjs` | 28 | 28 |

Sintaxis validada con `node --check` en los siete: correcta.

## 3. Literales SQL intactos
Comparación de literales de plantilla contra `git show HEAD:<ruta>`, posición a posición:

- Totales idénticos en orden en los siete archivos.
- Único literal añadido: el backtick de `` `process.exit` `` dentro del comentario nuevo del `if`, presente en los siete. No es SQL ni afecta a ninguna consulta.
- Literales con forma de SQL, comparados aparte: 13/13, 8/8, 4/4, 2/2, 4/4, 11/11 y 28/28, idénticos en orden.
- Nada eliminado del original en ningún archivo (`quitados_del_original=[]`).

## 4. `packages/publish/package.json`
Una sola línea modificada, dentro de `scripts.test`, añadiendo `test/publish-db.test.mjs` a la lista. Sin cambios en `dependencies`, `devDependencies` ni otros campos.

## Hallazgos
Ninguno en las cuatro comprobaciones.

## No revisado
- El interior de `ensureTestDatabase`, que no se ha tocado en este cambio y sigue como estaba en HEAD.
- La ejecución contra un Postgres real: no hay base de datos en esta máquina. Las siete suites salen `skipped` y se validan en CI.
- El despliegue y la configuración externa, fuera del alcance de esta tarea.

## Entrego a
release
