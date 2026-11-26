# Reporte P0-copy — security (gpt-6.2-astra)

- Fecha: 2026-11-25
- Resultado: CLEAR
- Integridad del contenido: comprobada; con `copy === undefined`, `draftSite` usa `genericCopy(brief)`, `assertDeliverable` vuelve a validar esquema y marcador, y el documento pasa por la red final de `draft.ts`; `design.idea` procede del preset y `meta.name` conserva solo el nombre escrito por el dueño según ADR 0004.
- Datos inventados: comprobado; todas las interpolaciones de `genericCopy` pasan por `publishable` → `briefValueOk` → `hasInvention`, y el fallback no evita `guardCopy` ni la validación final.
- Fuga en los avisos: comprobado; `copy_fallback` solo recibe motivos cerrados (`json_parse`, `truncated`, `empty_text`, `schema:<hasta cinco rutas>`, `empty_services`, `transport_<kind>`), mientras `copy_guard` solo enumera nombres de campos y el log añade `runId`.
- Nuevas llamadas al modelo: comprobado; hay como máximo dos llamadas de copy, una inicial y un único reintento para fallos de lectura o `empty_services`; `transport_*` corta el reintento y el resumen conserva su llamada presupuestada mediante el mismo `tracker`.
- Aislamiento: comprobado en el diff revisado; no hay cambios en tokens, RLS, cuentas ni límites de autorización, y `design-job.ts` solo elimina la captura inalcanzable de `CopyUnavailableError`.
- Hallazgos (severidad, archivo:línea, escenario, fix): ninguno.
- No revisado: comportamiento de infraestructura externa, despliegue y configuración del proveedor LLM fuera de estos archivos.
- Entrego a: release

REPORTE | P0-copy | security | CLEAR | docs/reports/P0-copy/security.md
