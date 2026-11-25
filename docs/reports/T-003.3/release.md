# T-003 — Release

- **Fecha:** 2026-11-25
- **Commit:** `2c022b7` — `feat(design): el agente distingue landing de sitio y construye varias páginas`
- **origin/main:** `2c022b7dbaa978edc18866a91c4a4047e4c85e8f` (coincide con HEAD)
- **Grafo (graphify):** 3328 nodos tras `graphify update .`

## Verificación previa al commit (comprobada)

- Rama: `main`.
- `turbo run build --force`: OK.
- `agents/design`: 140 tests, 140 pass, 0 fail.
- Monorepo `turbo run typecheck test --force`: 67/67 tareas OK.

## Archivos commiteados (17)

- `agents/design/src/classify.ts` (nuevo)
- `agents/design/src/draft.ts`
- `agents/design/src/index.ts`
- `agents/design/src/plan.ts`
- `agents/design/test/classify.test.mjs` (nuevo)
- `agents/design/test/copy.test.mjs`
- `agents/design/test/design.test.mjs`
- `apps/workers/src/design-job.ts`
- `packages/renderer/src/index.ts`
- `packages/renderer/src/theme-css.ts`
- `packages/renderer/test/render.test.mjs`
- `packages/site-schema/src/index.ts`
- `packages/site-schema/test/validate.test.mjs`
- `docs/reports/T-003.1/junior.md`
- `docs/reports/T-003.2/junior.md`
- `docs/reports/T-003.3/junior.md`
- `docs/reports/T-003.3/release.md` (este archivo, en el commit de docs)

## Pendientes

1. **Identidad de commit:** los commits se firman como `root <root@927ff6249af8>`. Conviene configurar una identidad propia del proyecto.
2. **Sin testing independiente:** no hubo revisión independiente de testing para T-003 (agente caído, no sustituido).
3. **Sin seguridad independiente:** no hubo revisión independiente de seguridad para T-003 (agente caído, no sustituido).
4. **Sin commitear fuera del repo:** `entrypoint.sh` y `llm-shim.py` de `/root/deploy-work` siguen sin commitear (no pertenecen a este repositorio).
