# Reporte T-002 — security final (gpt-6.2-astra)

- Fecha: 2026-11-25
- Resultado: CLEAR
- Cierre del hallazgo ALTO anterior: CERRADO, `agents/design/src/agent.ts:215-263` toma la instantánea verificada, ejecuta el resumen solo con herramientas `!tool.mutates`, descarta cualquier cambio detectado con `resumen_intento_mutar` y entrega únicamente después de `assertDeliverable`, que valida esquema y marcador en `agents/design/src/agent.ts:285-290`.
- Hallazgos nuevos (severidad, archivo:línea, escenario, fix): Ninguno.
- Lo que comprobé y está bien:
  - `safeCompose` (`agents/design/src/generic-copy.ts:49-55`) solo selecciona variantes completas que caben y lanza si ninguna cabe. `cutProse` (`agents/design/src/generic-copy.ts:30-39`) se usa en prosa fija y corta en frontera de palabra, sin partir pares sustitutos. Los campos con datos del brief llegan por `safeCompose`; `businessName` se omite si supera 60 caracteres (`generic-copy.ts:206-209`).
  - Las interpolaciones del brief en el copy genérico pasan por `publishable` y `briefValueOk` (`generic-copy.ts:121-129`, `134-171`, `194-209`). La caída de variantes termina en texto neutro completo o lanza antes de entregar, sin datos parciales ni vacío.
  - `originFromSet` consulta el conjunto explícito `substituted` construido por `completeCopy` (`agents/design/src/plan.ts:71-108`, `277-297`). No compara textos ni permite que una coincidencia casual cambie el origen. El conjunto solo se construye internamente durante la completitud.
  - La red del marcador se aplica al documento validado antes de devolverlo en `draft.ts:318-323` y vuelve a aplicarse al final del flujo en `agent.ts:285-290`. `docName`, `designBrief` y los atributos SEO usan `safeText`; `assets.alt` se omite si contiene el marcador (`draft.ts:275-315`).
  - El renderer escapa texto y atributos con `escapeHtml` (`packages/renderer/src/index.ts:36-43`, usos en `51-84`), y el contenido de secciones pasa por `renderToStaticMarkup`, que escapa texto React. No encontré una ruta de HTML sin escapar.
  - Los avisos y `reason` son códigos cerrados o mensajes estructurales (`agent.ts:292-307`, `copy.ts:229-275`, `plan.ts:177-181`). No incorporan texto del dueño ni del modelo.
  - No encontré accesos ni mutaciones de tokens, RLS o cuentas en el alcance de T-002.
- No revisado (y por qué): No revisé controles de despliegue externos, configuración de proveedor ni endpoints en producción, porque el encargo limita la auditoría al código local de T-002.
- Entrego a: release

REPORTE | T-002 | security | CLEAR | docs/reports/T-002/security.md
