# Reporte T-011 — release (claude-haiku-5-5)

- Fecha: 2026-11-26T16:50Z
- Resultado: DONE

- Qué hice:
  - Comprobé en `main` que el commit `ec97181` contiene exactamente los 5 archivos previstos (`agents/design/src/brief.ts`, `agents/design/src/describe.ts`, `agents/design/src/index.ts`, `agents/design/test/describe.test.mjs`, `agents/design/test/generic-copy.test.mjs`).
  - Verifiqué que `docs/PLAN-VIABLE.md` sigue sin seguimiento y no está en el commit.
  - Verifiqué que `origin/main` (`git ls-remote`) apunta a `ec97181`, igual que el HEAD local. Push sin `--force`, sin ramas nuevas.
  - Verifiqué que el grafo (`graphify-out/graph.json`) tiene 3423 nodos.

- Verificación previa (del encargo, ejecutada antes del commit):
  - Build de `agents/design` con `tsc`: exit 0.
  - Tests de `agents/design`: 167 pasan, 0 fallan.

- Commits publicados (de más reciente a más antiguo):
  - `ec97181` feat(design): el sitio se construye con lo que el cliente escribió
  - `b08a81b` docs(reports): release del P0 de chat y editor
  - `7aa9675` fix(panel): el chat muestra la frase del cliente y el editor espera al documento

- Qué cambia en producto:
  - `describeFromText` extrae tipo de negocio y ciudad del texto libre, sin modelo. Ejemplo: «quiero una pagina web para un buffet de abogados en barranquilla» → `businessType = "buffet de abogados"`, `city = "barranquilla"`.
  - `normalizeBrief` lo aplica solo si el campo está vacío; nunca sobrescribe datos dados aparte.
  - Campos pendientes bajan de 5 a 3. El titular del copy de emergencia pasa de «negocio local» a «buffet de abogados en barranquilla».

- Pendientes y riesgos (tomados del encargo; no re-verificados en esta ejecución):
  - Los commits están firmados por `root`.
  - El gateway sigue con 502 `transport_provider_error`.
  - Pexels responde 401; su banco local de fotos está por construir.
  - `docs/PLAN-VIABLE.md` queda sin seguimiento a propósito; va en un commit aparte.

- Entrego a: lead (siguiente paso según el plan de T-011 y los pendientes de arriba).
