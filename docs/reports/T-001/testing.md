# Reporte T-001 — testing (gpt-6.2-sol)

- Fecha: 2026-11-24T11:54:51Z
- Resultado: PASS
- Criterios verificados (uno por línea, con el comando o la prueba que lo demuestra):
  - A1 local, conforme al ADR 0003: `PATH=/root/.npm-global/bin:$PATH pnpm turbo run build --force` completó 22/22 tareas. `PATH=/root/.npm-global/bin:$PATH pnpm turbo run typecheck test --force` completó 67/67 tareas, con 365 casos ejecutados y aprobados y 0 fallos. El recuento nominal de 371 incluye seis archivos sin casos ejecutados. Con la excepción del ADR 0003, los seis se registran como no verificados y quedan fuera de los aprobados. La suite de diseño obtuvo 47/47.
  - A2: `node --test agents/design/test/copy.test.mjs` pasó el caso `runFastDesign: sin ningun servicio valido el copy no sirve (empty_services)`, incluida su aserción `transport.calls === 2`.
  - A3: `node --test agents/design/test/copy.test.mjs` ejecutó los 19 casos del archivo, incluidos los de guardia, con 19 pass, 0 fail y 0 skip.
  - Pruebas independientes: `node --test agents/design/test/copy.test.mjs /tmp/t001-testing-extra.mjs` obtuvo 25 pass, 0 fail y 0 skip. Verifiqué la recuperación tras `empty_services` con dos llamadas de copy y una de resumen, el corte de presupuesto real tras una sola solicitud al cliente, el límite de dos intentos de copy en los casos de doble fallo y los motivos finales `empty_services`, `json_parse` y `transport_budget`. Para el presupuesto en el segundo intento simulé la respuesta del cliente. Verifiqué que el SEO válido se conserva y que el SEO podado usa el subtitular.
- Fallos reproducibles (comando exacto + salida esperada vs obtenida): Ningún fallo en los casos ejecutados. El falso verde del runner queda registrado en T-009.
- No verificado (y por qué): 6 archivos quedan «no verificados»: `packages/db/test/migrate.test.mjs`, `packages/db/test/rls.test.mjs`, `packages/assets/test/assets-db.test.mjs`, `packages/editor/test/save.test.mjs`, `apps/platform/test/another-active.test.mjs` y `apps/platform/test/cycle.test.mjs`. Sus casos quedan pendientes de ejecución en CI con `pgvector/pgvector:pg18`. En este entorno faltan `DB_TEST_URL` y `DB_TEST_CONFIRM`. La integración PostgreSQL de publicación tampoco fue invocada por el comando del paquete.
- Riesgos que veo en el diff: Los avisos `copy_guard` pueden incluir descartes del primer intento aunque el segundo recupere el copy. Un éxito después del reintento consume dos llamadas de copy y luego la llamada de resumen, con cargo al mismo presupuesto.
- Entrego a: senior
- Referencias: docs/reports/T-001/diff.patch, docs/spec.md
