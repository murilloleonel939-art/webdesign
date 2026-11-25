# Reporte T-009 — testing, revisión 1 (gpt-6.2-sol)

- Fecha: 2026-11-24 UTC
- Resultado: PASS
- Diff congelado: 2.169 líneas, base `5d8af75cf564b34b47792cba5510915cea74cb99`.
- Criterios verificados: siete suites de Postgres explícitamente `skipped`. El manifiesto de publicación incorpora `test/publish-db.test.mjs` al script `test` como único cambio. Se comparó el manifiesto byte por byte tras esa sustitución exacta y cada suite mediante los tokens del AST de TypeScript, conservando el texto de los literales. Los siete cuerpos coincidieron por completo, incluidas aserciones, consultas y literales SQL. En cada archivo la rama sin variables contiene únicamente un `test` marcado `skip`; las inicializaciones, pools, servidores y hooks quedan en `else`.
- Reproducción: `node /tmp/t2d-structure.cjs`. Para cada ruta de la tabla, `env -u DB_TEST_URL -u DB_TEST_CONFIRM node --test RUTA`.

| Suite | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| [migrate](/root/proyectos/webdesign/packages/db/test/migrate.test.mjs) | 0 | 0 | 1 |
| [rls](/root/proyectos/webdesign/packages/db/test/rls.test.mjs) | 0 | 0 | 1 |
| [assets-db](/root/proyectos/webdesign/packages/assets/test/assets-db.test.mjs) | 0 | 0 | 1 |
| [save](/root/proyectos/webdesign/packages/editor/test/save.test.mjs) | 0 | 0 | 1 |
| [publish-db](/root/proyectos/webdesign/packages/publish/test/publish-db.test.mjs) | 0 | 0 | 1 |
| [another-active de platform](/root/proyectos/webdesign/apps/platform/test/another-active.test.mjs) | 0 | 0 | 1 |
| [cycle](/root/proyectos/webdesign/apps/platform/test/cycle.test.mjs) | 0 | 0 | 1 |

- Fallos reproducibles: ninguno en el alcance de T-009. En la primera suite global se registraron 430 pass, 1 fail y 7 skipped. La prueba de carga de platform obtuvo p95 de 320 ms con límite de 250 ms. El caso está fuera de los archivos modificados por T-009. La repetición completa cerró con 431 pass, 0 fail, 7 skipped y 67/67 tareas exitosas.
- Workers, resultado informativo: 4 de 5 ejecuciones pasaron con `PATH=/root/.npm-global/bin:$PATH pnpm --filter @webdesign/workers test`. Primera ejecución 32 pass y 2 fail, en «el proceso termina: ni el temporizador ni la conexion lo retienen» y «un Redis que acepta y corta el socket tampoco mata el proceso». Las siguientes cuatro dieron 34 pass cada una.
- No verificado: la rama con Postgres de las siete suites queda «no verificada aquí, va a CI».
- Riesgos residuales: la ejecución con infraestructura y la prueba de carga dependen de las condiciones de CI.
