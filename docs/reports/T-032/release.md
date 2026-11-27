# T-031 + T-032 — release

**Fecha:** 2026-11-27
**Rama:** `main` (sin PR, sin ramas nuevas)
**Commit:** `2c3ef04` (firmado por `root`, sin GPG como el resto del historial)
**Remoto:** `origin/main` = `2c3ef04` (verificado con `git ls-remote`)
**Grafo:** 3925 nodos (`graphify update`, sin cambios de código tras el push)

## Qué entra

- **T-031:** el banco pasa de 37 a 98 fotos: 6 horizontales y 8 cuadradas en cada uno de los 7 sectores (42 + 56). Procedencia completa en `manifest.json` y `CREDITS.md`. El zip pasa de 8,16 MB a 23 MB.
- **T-032a:** rotación por sitio. `listBankPhotos` ordena por `sha256(siteId + id)`: mismo sitio, mismo orden; sitios distintos, otro orden.
- **T-032b/c:** cliente Unsplash (`apps/platform/src/unsplash.ts`) y caché en disco (`unsplash-cache.ts`). Orden: banco local → Unsplash → Pexels. Si el banco cubre la petición no se llama a Unsplash. La descarga se notifica como pide su API y la procedencia se guarda en `registerAsset`.
- Pruebas del banco corregidas (dependen del manifiesto real) y tres nuevas de cobertura e integridad.

## Verificación (comprobado)

- Claves comprobadas en el repo: `5Xyx7juG…` y `RA7Ti819…` → 0 coincidencias cada una.
- Rama: `main`.
- Tests platform: **121 tests, 118 pass, 0 fail, 3 skipped**.
- Typecheck: limpio (exit 0).
- Zip: 23 MB.
- Fuera del commit: `docs/PLAN-VIABLE.md` (sin seguimiento, excluido) y `apps/platform/ui-dist/` (no añadido).

## Pendientes (no verificados por este release)

1. **Hay que reinstalar el banco en el servidor**: descomprimir `deploy/unsplash-bank.zip` (23 MB) en la raíz de medios. Si no, seguirán saliendo las 37 fotos viejas.
2. **`UNSPLASH_API_KEY` no está configurada en producción**: la caché de Unsplash no se usará hasta definirla.
3. **El gateway sigue en 502.** No se ha comprobado en este release.
