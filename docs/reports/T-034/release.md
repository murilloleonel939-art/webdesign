# T-034 — Release: constructor de biblioteca Unsplash en producción

Fecha: 2026-11-27 (commit y push)

## Qué se publicó

- Commit: `9bb5b58` — `feat(fotos): constructor de biblioteca Unsplash en producción (T-034)`
- Rama: `main` (sin PR)
- Remoto: `9bb5b58...` (verificado con `git ls-remote` tras el push)
- Commit anterior: `fa69ec9`
- Ficheros nuevos:
  - `apps/platform/src/bank-builder.ts` (929 líneas, comentado el porqué)
  - `apps/platform/test/bank-builder.test.mjs` (11 pruebas)
  - `apps/platform/test/bank-builder-verify.test.mjs` (25 pruebas adversariales)
  - `apps/platform/test/bank-routes-verify.test.mjs` (9 pruebas de rutas)
- Ficheros modificados:
  - `apps/platform/src/unsplash.ts` (tercer parámetro `crop: "hero"|"gallery"`)
  - `apps/platform/src/server.ts` (tres rutas de operador)
  - `apps/platform/ui/panel.tsx` (sección `BankSection` en `Operator`)
  - `apps/platform/ui/builder.css` (estilos `.bank-*`)
  - `apps/platform/test/unsplash.test.mjs` (caso recorte 1200x1200)
  - `apps/platform/package.json` (registro de las nuevas suites)
- Fuera del commit a propósito: `docs/PLAN-VIABLE.md` (sin trazar; confirmado con `git diff --cached --name-only` antes del commit)

## Problema

El banco de fotos (98 imágenes curadas a mano) no crece: si el dueño quiere más fotos, alguien tiene que mirarlas y subirlas. El gateway solo acepta texto, así que un job no puede evaluar imágenes. Hace falta un proceso que se lance en producción, use la clave de Unsplash que ya tiene la plataforma, busque por sector, descargue solo lo que falte, filtre con criterios objetivos y deje el manifiesto actualizado — todo sin intervención humana.

## Cambios

1. **`bank-builder.ts`** — constructor completo:
   - Estado en memoria, una ejecución a la vez (`active` + `latest` + `BankBuildBusyError`).
   - Opciones validadas: `sectors` (subconjunto de `SECTORS`, 400 si hay inválido), `hero` (0–12, defecto 6), `gallery` (0–12, defecto 8), `maxRequests` (1–200, defecto 40) para no agotar la cuota horaria.
   - Por sector y tipo: consultas en inglés específicas del negocio (2–3 por sector), `searchUnsplash` con `perPage: 30`, orientación correcta.
   - **Filtra con el `alt` CRUDO en inglés** (`filterPhoto`), guarda el `alt` en castellano (`altFor`) — cumple el punto pendiente de T-033a.
   - Caché antes que red: `readFromUnsplashCache` / `saveToUnsplashCache` / `notifyUnsplashDownload` una sola vez.
   - Escritura append-only: `wx` + índice libre, extensión por MIME real, manifiesto `.tmp` + `rename` tras **cada** foto, `CREDITS.md` regenerado con el mismo formato, `_resetBankCache()`.
   - Presupuesto: al agotarse → `done` + `budget_exhausted` + `missing` correcto. Tiempo: 10 min por defecto → `timeout`.
   - Estado JSON serializable, sin la clave: `{ run, last }` con `run` en curso y `last` la última lanzada.

2. **`unsplash.ts`** — recorte por enum interno:
   - `downloadUnsplash(photo, fetch, crop: "hero"|"gallery")` fuerza `w=1600&h=900` o `w=1200&h=1200`. Nunca se acepta la query por body: la decide el constructor según hero/gallery.

3. **`server.ts`** — tres rutas con sesión + rol `operator` (tras `resolveSession`):
   - `GET /api/operator/bank` → `{ inventory: { total, sectors } }` (lee manifiesto, 500 `inventory_unreadable` si está roto, **proceso no muere**).
   - `GET /api/operator/bank/build` → `{ run, last }` (síncrono, no lanza).
   - `POST /api/operator/bank/build` → valida body → 503 si no hay `UNSPLASH_API_KEY` → 409 si ya corre → 202 `{ run }`. Códigos: 401/403/400/503/409/202/500 controlados.

4. **Panel de operador** — sección "Biblioteca de fotos" dentro de `Operator`: recuento por sector, botón "Construir banco de fotos" (deshabilitado mientras corre), progreso legible con `aria-live="polite"`. Sin frameworks nuevos, sin `eval`, CSP intacta.

## Verificación (comprobado)

- Rama `main`; `git status --short` limpio salvo `docs/PLAN-VIABLE.md` (sin trazar).
- Búsqueda de las dos claves indicadas en todo el árbol (sin `node_modules` ni `.git`): cero coincidencias.
- `pnpm --filter @webdesign/platform typecheck`: 41/41 tareas, exit 0.
- `pnpm --filter @webdesign/platform build`: `tsc` + `build-ui.mjs` → "css sin terceros / panel construido".
- `pnpm --filter @webdesign/platform test`: **212 tests, 209 pass, 0 fail, 3 skipped** (los 3 skip son previos: requieren DB de pruebas).
- Push verificado con `git ls-remote` (coincide con el SHA local).
- No se usó `pnpm turbo run build --force`, ni `--force`, ni `git reset --hard`, ni borrado de ramas.

## Auditoría de seguridad

Nemotron Ultra (openrouter) + revisión manual + fallback (claude-opus-5-5): **sin hallazgos críticos/altos sin mitigar**. Veredicto: se puede publicar tal cual.

| Categoría | Hallazgo |
| --- | --- |
| Autorización | Sin hallazgo: 3 rutas detrás de sesión + `isOperator` exacto; `owner` recibe 403. |
| Travesía | Sin hallazgo: sector allowlist, nombre por índice+MIME, `isSafeUnsplashId` regex allowlist. |
| Fuga de clave | Sin fuga: clave solo en `Authorization` saliente; no en logs, manifiesto, CREDITS, estado HTTP. |
| SSRF | Sin hallazgo: host exacto, `redirect: "error"`, tope 6 MB, tipo por bytes, `crop` enum interno. |
| DoS | Presupuesto ≤200, timeout 10 min, 1 ejecución a la vez, límites por sector, 409 atómico. |
| Integridad | ✅ Corregido R8: `GET /api/operator/bank` 500 controlado. Manifiesto `.tmp`+`rename` por foto, `CREDITS.md` igual, `wx` evita pisar. Nota: `.tmp` nombre fijo → riesgo si multi-réplica sobre mismo volumen (arreglo: `${abs}.${run.id}.tmp`, una línea antes de despliegue). |
| Panel / CSP | Sin `innerHTML`/`eval`/terceros; React escapa; enlaces externos con `rel="noreferrer"`. |
| Secretos / PII | Manifiesto solo ids, metadatos, alts propios, perfiles fotógrafo con UTM. Logs truncados a 120 chars. |

## Grafo

- `graphify-out/graph.json`: **3975 nodos**, 6583 aristas, 270 comunidades (reconstruido tras el commit).

## Pendiente

- **El `.tmp` de nombre fijo**: si se escala `platform` a >1 réplica sobre el mismo volumen `/data/biblioteca`, dos ejecuciones simultáneas podrían pisarse el `manifest.json.tmp`. Arreglo barato antes de desplegar en multi-réplica: `${abs}.${run.id}.tmp` (una línea en `writeManifestDoc` y otra en `writeCredits`).
- Los commits están firmados por `root` (identidad local de git, no configurada en este repositorio).
- El gateway sigue en 502 (pendiente de `LLM_PROVIDER_API_KEY`, ver T-033).
