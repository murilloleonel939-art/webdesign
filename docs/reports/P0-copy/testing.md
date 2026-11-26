# Reporte P0-copy — testing (gpt-6.2-sol)

- Fecha: 2026-11-25
- Resultado: PASS
- Caso 1 (JSON roto): lanza no · válido sí · marcador no · copy_fallback sí (`json_parse`)
- Caso 2 (servicios inventados): lanza no · válido sí · marcador no · copy_fallback sí (`schema:businessType,heroSubline,heroCta,servicesHeading,services`) · «500» presente no · «15 años» presente no
- Caso 3 (caso de producción): 4 páginas · slugs `/`, `/servicios`, `/sobre-nosotros`, `/contacto` · válido sí · copy_fallback sí (`empty_text`)
- Caso 4 (throw alcanzable): 0
- Caso 5 (mensaje eliminado): 0
- Fallos reproducibles: ninguno
- No verificado: suites que requieren Postgres, según el entorno indicado
- Entrego a: seguridad

Las tres ejecuciones usaron `runFastDesign` compilado y un transporte LLM falso sin red. `validateSiteDocument` devolvió válido en los tres casos. La compilación requerida terminó correctamente con `pnpm turbo run build --force`.

REPORTE | P0-copy | testing | PASS | docs/reports/P0-copy/testing.md
