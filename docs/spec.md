# Spec — que el producto construya páginas de verdad

Estado: vigente. Arquitecto: Fable 5.2. Fecha: 2026-11-24.
Deriva de `docs/PLAN-ACCION-PRODUCTO.md` (producto) y de la especificación técnica
`especificacion-construccion-v1.15.md` (fuente de verdad del sistema).

## 1. Objetivo

Que un usuario escriba una frase y reciba **una página web terminada**, publicable, en
menos de tres minutos, sin preguntas obligatorias y sin marcadores visibles. El cliente
decide después qué cambiar. Hoy el sistema entrega un esqueleto con
`pendiente de confirmar` y dice «Tu web está lista».

## 2. Alcance

Dentro:

- Fases A a F del plan de producto.
- `agents/design` (textos, plan, borrador), `apps/workers` (ejecución y estado),
  `apps/platform` (API y panel), `packages/lint-visual` (reglas), `packages/catalog-import`
  (catálogo) y una migración nueva si hace falta.

Fuera (no lo hace ningún agente):

- Redesplegar contenedores en Coolify y definir variables de entorno: es acción humana.
- Dominios propios, cobros, registro de usuarios. Van después, según el plan.
- Tocar `hosting.ts`, Caddy, Traefik o el esquema de dominios.

## 3. Estado de partida (comprobado, no supuesto)

- Suite completa: **369 pasan, 2 fallan**, ambos en `@webdesign/agent-design`.
- `pnpm turbo run typecheck` 41/41 limpio; `build` 22/22.
- Producción corre un commit anterior al repo (`15c4637`): el `workers` desplegado no
  emite `design_copy_fallback`. No se puede arreglar desde el código.
- Sin Postgres local, las suites gateadas por `DB_TEST_URL` se saltan y no prueban nada.

## 4. Equipo real disponible

Modelos comprobados con `list_subagent_models`, proveedor incluido. No se escribe un rol
sin verificar que su modelo responde.

| Rol del brief | Proveedor / modelo | Estado |
| --- | --- | --- |
| Arquitecto | `claude-fable-5-2` / `claude-fable-5-2` | disponible |
| Dev senior | `pateway1` / `claude-opus-5-5` | disponible |
| Dev junior | `constructor` / `claude-sonnet-5` | disponible (el nombre `claude-sonnet-5-5` **no** responde) |
| Testing | `constructor-openai` / `gpt-6.2-sol` | disponible |
| Seguridad | `security` / `gpt-6.2-astra` | disponible |
| Release | `testypruebas` / `claude-haiku-5-5` | disponible |

Ninguno de los dos modelos GPT anuncia esfuerzos de razonamiento: se invocan sin ese
parámetro.

Testing y Seguridad **no** corren en Claude Code, así que claude-mem no los captura:
escriben su reporte en `docs/reports/<ID>/` y el senior repite su línea `REPORTE` en su
sesión, que es el puente obligatorio del brief. Testing y Seguridad reciben solo el diff y
la spec, nunca el razonamiento del desarrollador.

Puertos y herramientas reales: visor de claude-mem en `http://localhost:37700` (el brief
dice 37777). graphify en `/root/.venvs/graphify/bin`. El hook `post-commit` de graphify
quedó instalado el 2026-11-24 junto con `post-checkout`, `post-merge`, `post-rewrite` y el
merge driver.

## 5. Arquitectura y contratos que no cambian

- `site-schema` sigue siendo el contrato del documento. Toda mutación valida el
  `SiteDocument` completo antes de confirmar.
- El agente **no publica**: no existe herramienta de publicar y no se añade.
- `RunContext` lleva token, no pool. Las herramientas reciben datos, no abren red ni base.
- Un `error` del linter 6.4 no aplica nada; uno de `lint-visual` 6.5 **nunca bloquea**:
  se entrega con aviso y confirmación del dueño.
- Nada del catálogo entra como prompt de sistema: solo filas de catálogo o reglas
  deterministas. Lo que no pasa `lint-visual` entra como `supplemental`, nunca `active`.

Contratos que esta spec sí toca:

1. `finishCopy` (`agents/design/src/agent.ts`) deja de cortar el flujo: devuelve el
   `CopyOutcome` y el bucle de `generateCopy` decide si reintenta.
2. `PENDING_MARKER` deja de aparecer en texto visible del sitio. Sigue existiendo como
   valor interno del brief.
3. `initialDoc` (`apps/platform/src/api.ts`) deja de sembrar `family: "Inter"` y
   `accent: "#3b82f6"`.
4. El plan del sitio pasa a distinguir `landing` (una página) de `site` (varias páginas).

## 6. Modelo de datos

Sin cambios de esquema previstos para A–D. Si `T-007` necesita filas nuevas del catálogo,
va en migración `0024` (la secuencia tiene un hueco en `0013`; se respeta y no se rellena).

## 7. Criterios de aceptación medibles

Cada uno se comprueba con un comando o una prueba, no con una opinión.

| Nº | Criterio | Cómo se comprueba |
| --- | --- | --- |
| A1 | Suite completa sin rojos **reales** | `pnpm turbo run typecheck test --force` → 0 fallos y **0 archivos en falso verde**. Un archivo que sale `✔` sin haber ejecutado ningún caso no cuenta como pass; se cuenta como «no verificado» y se nombra. Ver ADR 0003 |
| A2 | El reintento de `empty_services` ocurre | `agents/design/test/copy.test.mjs` caso `empty_services` → `transport.calls === 2` |
| A3 | Nada inventado llega al sitio | los 12 casos de guardia de `copy.test.mjs` en verde |
| B1 | Ninguna página entregada lleva el marcador | prueba nueva: 10 briefs → `JSON.stringify(doc)` sin `pendiente de confirmar` |
| B2 | Copy completo en cada página | prueba nueva: cada doc tiene ≥ 3 servicios, `about` no vacío, `faq` ≥ 2 |
| C1 | Landing vs sitio | "vendo un curso de inglés online" → 1 página; "clínica dental en Bogotá" → ≥ 3 páginas con navegación |
| D1 | Un solo campo al entrar | prueba de la UI: `BuilderHome` expone un `<textarea>`/`<input>` y un botón |
| D2 | Página a pantalla completa al terminar | prueba: `.builder-canvas` ocupa el ancho y no hay panel Puck visible |
| D3 | Sin botones de ruido | prueba: no existe el texto «Copiar resumen» |
| E1 | Tokens propios | prueba: `initialDoc` no devuelve `Inter` ni `#3b82f6` |
| E2 | Las 9 señales anti-slop tienen veredicto | `critique_draft` devuelve las 9 con peso |

Ningún criterio se da por bueno con pruebas saltadas. Si una prueba depende de Postgres y
no hay Postgres, el criterio queda **sin verificar** y se dice.

Recuento vigente en esta máquina (sin Postgres): **365 casos reales ejecutados, 0 fallos**,
más **6 archivos de integración con base de datos que no ejecutan nada** (`migrate`, `rls`,
`assets-db`, `save`, `another-active` y `cycle`). Esos 6 se verifican en CI, que levanta
`pgvector/pgvector:pg18`; no aquí.

## 8. Plan de tareas

Orden estricto. Una tarea = un commit. `T-000` es humana y bloquea la verificación en
producción, no el desarrollo.

| ID | Tarea | Fase | Modelo | Depende de |
| --- | --- | --- | --- | --- |
| T-000 | Redesplegar `workers` y `llm-gateway`; revisar variables y el log `design_copy_fallback` | A | humano | — |
| T-001 | Arreglar el reintento de `empty_services` y resolver la prueba de `seoDescription` | A | senior | — |
| T-002 | Quitar el marcador del sitio y escribir copy completo y verosímil | B | senior + junior | T-001 |
| T-003 | Clasificar landing vs sitio y generar varias páginas con navegación | C | senior | T-002 |
| T-004 | Inicio con un solo campo y resultado a pantalla completa | D.1–D.2 | senior | T-003 |
| T-005 | Edición con clic, Puck oculto y limpieza de botones | D.3–D.4 | senior + junior | T-004 |
| T-006 | Tokens propios fuera de Inter y del azul Tailwind; 3 reglas nuevas | E | senior + junior | T-005 |
| T-007 | Importar el catálogo restante y ordenar secciones por patrón de landing | E | senior | T-006 |
| T-008 | `critique_draft` con las 9 señales y su peso | E | junior | T-007 |
| T-009 | Quitar el falso verde de las suites con base de datos y enlazar la prueba de publicación | infra | junior | — |

Detalle de la primera tarea, `T-001`:

- **Objetivo:** un copy cuyos servicios fueron todos podados por la guardia entra en el
  reintento de lectura en vez de fallar a la primera.
- **Archivos que puede tocar:** `agents/design/src/agent.ts`,
  `agents/design/test/copy.test.mjs`.
- **Cambio esperado:** en `agent.ts`, el resultado de `finishCopy` no se devuelve directo;
  si trae `reason`, se usa como motivo de reintento (salvo que empiece por `transport_`),
  igual que ya pasa con los motivos de lectura. En la prueba de `seoDescription`, la
  aserción se corrige para afirmar lo que la guardia hace de verdad: se conserva la
  descripción del modelo si no trae inventos, y solo cae al subtitular cuando se poda.
- **Tests que debe pasar:** `pnpm --filter @webdesign/agent-design test` → 47/47, y
  `pnpm turbo run typecheck test --force` → 371/371.
- **Fuera de alcance:** tocar `guardCopy`, cambiar el esquema del copy, tocar el panel.

## 9. Cierre obligatorio

Una tarea no está hecha hasta que exista `docs/reports/<ID>/` con el reporte de cada rol,
la línea `REPORTE | <ID> | <rol> | <resultado> | <ruta>`, el grafo de graphify al día y la
línea `TAREA COMPLETADA` del release. Se acepta como respaldo verificable
`docs/reports/` aunque falle el hook.

## 10. Deuda conocida abierta por T-001

Ambas las detectó el senior, quedaron fuera de su alcance y **no están arregladas**.

1. **Aviso de poda de un intento descartado.** `finishCopy` añade el aviso
   `copy_guard: …` antes de saber si ese copy se va a usar. Si el primer intento se
   descarta y el segundo lo salva, el panel puede enseñar textos podados de un intento
   que nunca llegó al sitio. Ninguna prueba lo cubre.
   Propuesta: acumular los avisos por intento y publicar solo los del intento que gana.
   Entra en `T-002`, porque es donde se reescribe la política de avisos.
2. **Motivo de reintento engañoso.** `retryLine("empty_services")` le dice al modelo que
   su respuesta «no se pudo leer», cuando el problema real es que la guardia podó todos
   los servicios. El modelo reintenta a ciegas. Vive en `agents/design/src/copy.ts`.
   Propuesta: un texto por familia de motivo. Entra en `T-002`.

Ninguna de las dos afecta a la garantía de que no se publique contenido inventado.
