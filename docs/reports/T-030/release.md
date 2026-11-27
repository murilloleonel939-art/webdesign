# T-029 + T-030 Release Report

**Date:** 2026-11-27 04:41 UTC  
**Task:** T-029 (Business-specific visual themes) + T-030 (Local-served typography)  
**Status:** RELEASED  

## Deployment Details

**Repository:** `/root/proyectos/webdesign` (main)  
**Commit SHA:** `7afe755` (full: `7afe7559ffc0208ff0ddd1c251cacd94ee3dcd51`)  
**Graph Nodes:** 3767  

## Verification Summary

All required test suites passed:
- **renderer:** 38/38 ✓
- **releases:** 9/9 ✓
- **publish:** 11 pass + 1 skipped ✓
- **agent-design:** 212/212 ✓
- **typecheck:** clean ✓

**Credential Check:** 0 matches for forbidden token (security verified).

## Font Assets

**Directory:** `packages/renderer/fonts/`  
**Total Size:** 1.2 MB  
**TTF Files:** 11  
**OFL License Files:** 7 (Gloock, Crimson Pro, Instrument Sans, Libre Baskerville, Lora, Outfit, Young Serif)

All fonts verified as SIL Open Font License 1.1 (OFL).

### Font Families by Theme Direction

| Theme | Font Families | Approx Size |
|-------|---------------|-------------|
| editorial | Gloock + Crimson Pro | 302 KB |
| moderna | Instrument Sans | 133 KB |
| clásica | Libre Baskerville + Instrument Sans | (bundled) |
| cálida | Lora + Instrument Sans | (bundled) |
| rotunda | Young Serif + Outfit | (bundled) |
| Legacy themes | None | 0 KB |

## Implementation Details

**T-029 — Business-specific visual themes:**
- 194 product palettes from business type classification
- 89 style variables (radius, spacing, shadow)
- 158 distinct themes derived from 194 products
- All palettes meet AA contrast (corrected 69, accent in 71)

**T-030 — Local-served typography:**
- 11 OFL font faces
- 5 typography directions (editorial, clásica, cálida, moderna, rotunda)
- Each release includes only theme-specific fonts
- Verified with Playwright: `document.fonts.size` and `getComputedStyle` correct across all 5 directions

## Staged Changes

Included (excluding `docs/PLAN-VIABLE.md` and `apps/platform/ui-dist/`):
- agents/design: design-intelligence.json, theme.ts (new), data, scripts, tests
- packages/renderer: fonts/ (11 TTF + 7 OFL), theme-css.ts, test updates
- packages/publish: fonts.test.mjs (new), test suite additions
- packages/releases: test coverage
- packages/linter: index.ts (design system integration)

## Known Limitations

1. **Database Test Coverage:** 1 publish test skipped due to missing `DB_TEST_URL`; full publication→database→release flow not exercised.
2. **Visual Composition:** Only colors, typography, radius, and rhythm vary. Card and hero layouts remain single design; no style-specific composition yet.
3. **Font Cache Control:** `Cache-Control` long headers not applied to `/fonts/*` (Caddyfile limits to `/assets/*` only).
4. **Gateway Status:** Upstream 502 persists (unrelated to this release).

## Commit Message

```
feat(design): el estilo sale del catálogo y las fuentes se cargan de verdad

El aspecto visual salía de ocho presets con tres colores cada uno, así que dos negocios
distintos se veían casi igual. Ahora sale de los datos del catálogo: las 194 paletas por
tipo de negocio y las variables de los 89 estilos, con su radio, su espaciado y su sombra.
Sobre los 194 productos salen 158 temas distintos. Todas las paletas cumplen AA en texto y
acento, corrigiendo 69 y usando el acento en 71 donde el primario no llegaba.

Y la tipografía por fin llega. `theme-css.ts` declaraba familias sin un solo `@font-face`,
así que todo caía en la serif del sistema y el catálogo entero se pintaba igual. Ahora hay
once caras OFL servidas desde el dominio del propio sitio en cinco direcciones: editorial,
clásica, cálida, moderna y rotunda. Cada release incluye solo las fuentes de su tema, entre
133 y 394 KB, y los temas antiguos no llevan ninguna.

Verificado con Playwright: `document.fonts` devuelve once caras y la familia calculada del
titular es la correcta en las cinco direcciones. renderer 38, releases 9, publish 11,
agent-design 212, typecheck limpio.
```

## Sign-Off

- **Author:** root
- **Commits signed:** No (unsigned)
- **Remote state:** ✓ Synced (7afe755 on origin/main)
- **Branch:** main (no PR, direct deployment)
