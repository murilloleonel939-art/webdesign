# Reporte T-001 — security (gpt-6.2-astra)

- Fecha: 2026-11-24
- Resultado: CLEAR
- Qué revisé: Las dos rutas de `generateCopy`, el ajuste de la prueba SEO y los contratos de las secciones 5 y 8. Contrasté la lectura y la guardia con los controles de presupuesto del cliente y del gateway.
- Hallazgos (uno por línea: severidad crítica/alta/media/baja, archivo:línea, escenario de explotación, fix sugerido): Ninguno atribuible al diff.
- Lo que comprobé y está bien: `empty_services` puede costar una llamada adicional respecto al comportamiento anterior. El máximo por generación de copy sigue siendo dos llamadas, con el mismo cliente presupuestado y hasta 4096 tokens de salida por petición. `transport_*` finaliza el primer intento. Ambos intentos pasan por `readCopy` y `guardCopy` antes de entregar texto. Un segundo rechazo es definitivo. El nuevo motivo es el literal `empty_services`. Los motivos de esquema preexistentes identifican hasta cinco rutas de campos, sin incluir sus valores. El reintento usa el rol `user`. El diff no introduce interpolación en mensajes de sistema, SQL ni HTML, ni cambios en tokens de sesión, RLS o aislamiento de cuentas. El ajuste SEO solo cambia la prueba.
- No revisado (y por qué): Revisión estática circunscrita al cambio. La eficacia general de las heurísticas contra toda afirmación inventada, el renderizador y la configuración desplegada quedan fuera de T-001. No ejecuté las suites de aceptación.
- Entrego a: senior
- Referencias: docs/reports/T-001/diff.patch, docs/spec.md
