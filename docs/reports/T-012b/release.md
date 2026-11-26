# Release T-012b — chat sin datos pendientes y frase del cliente

**Fecha:** 2026-11-26
**Rama:** `main` (sin ramas nuevas, sin PR)
**Commit:** `f829904` (`fix(panel): el chat muestra la frase del cliente y no habla de datos pendientes`)
**Remoto:** `ea9f193..f829904  main -> main`
**Verificación remoto:** `git ls-remote` devuelve `f829904ee397475d2176394f739c9d96c8cedeb4` para `refs/heads/main`, igual que el HEAD local.
**Autoría:** commit firmado por `root`.

## Cambios incluidos (11 archivos, +152 / −92)

- `agents/design/src/draft.ts`: escribe `design.ownerPrompt` con la frase literal del dueño.
- `packages/site-schema/src/index.ts`: campo opcional `ownerPrompt` en `design` (sin migración).
- `apps/workers/src/design-job.ts`: texto de cierre nuevo («Tu web está lista. Revísala cuando quieras y dime qué cambias.»).
- `apps/platform/ui/panel.tsx`: `ownerPrompt()` lee el campo nuevo y cae a `brief` e `idea`; se elimina el aviso de pendientes muerto.
- `apps/platform/ui/DesignChat.tsx`: textos de cierre.
- `apps/platform/ui/design-chat-flow.ts`: comentario.
- `apps/platform/ui/brand.css`: sin selectores `.design-pending`.
- Pruebas: `agents/design/test/design.test.mjs`, `packages/site-schema/test/validate.test.mjs`, `apps/workers/test/design-job.test.mjs`, `apps/platform/test/design-chat-flow.test.mjs`.

Excluidos a propósito: `docs/PLAN-VIABLE.md` (sin versionar) y `apps/platform/ui-dist/`.

## Verificación (ejecutada antes del commit)

| Suite | Resultado |
|---|---|
| agents/design | 170 / 170 pass |
| packages/site-schema | 21 / 21 pass |
| apps/workers | 34 / 34 pass |
| apps/platform (`build-ui.mjs` → «panel construido») | 84 pass / 0 fail / 2 skipped |
| `pnpm typecheck` (raíz) | sin errores (exit 0) |

## Grafo

- `graphify-out/graph.json`: **3474 nodos**, 5681 enlaces (regenerado tras el commit por el hook de graphify).

## Pendientes conocidos (no bloquean el release)

- Commits firmados por `root`.
- El gateway usa ahora `claude-sonnet-5`.
- Banco de fotos por curar.
- `docs/PLAN-VIABLE.md` sin versionar: decidir si se versiona en otro momento.
