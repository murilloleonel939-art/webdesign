# T-015 — Release: al terminar el diseño se enseña la página, no el editor

Fecha: 2026-11-26 (commit y push)

## Qué se publicó

- Commit: `63f7208` — `feat(panel): al terminar el diseño se enseña la página, no el editor`
- Rama: `main` (sin PR)
- Remoto: `63f7208f3a11dee9564a7ef695785187ed96630c refs/heads/main` (verificado con `git ls-remote`)
- Commit anterior: `cf7e481`
- Ficheros: `apps/platform/ui/panel.tsx`, `apps/platform/ui/builder.css`, `apps/platform/test/delivery-overlay.test.mjs`, `apps/platform/package.json` (solo para enganchar el test nuevo al script `test`)
- Fuera del commit a propósito: `docs/PLAN-VIABLE.md` y `apps/platform/ui-dist/` (no trazados)

## Problema

Al terminar de diseñar, el usuario aterrizaba en el editor de Puck y tenía que pulsar «Ver resultado» para ver su web.

## Cambios

1. **Overlay tras la ejecución:** al terminar un run, se abre a pantalla completa el overlay de vista previa que ya existía, con las acciones **Publicar** y **Cambiar algo**.
2. **Cuándo se abre:** solo tras una ejecución. No se abre al reabrir un sitio ya diseñado ni al cargar la página.
3. **Cierre:** con Escape. Una vez cerrado, no vuelve a abrirse en esa sesión.
4. **Publicar:** reutiliza el `publish()` existente del panel, sin duplicar su lógica de hallazgos ni bloqueos. Al publicar con éxito muestra «Publicado en `<hostname>`» con enlace al sitio.
5. **Accesibilidad:** `role="dialog"`, `aria-modal`, foco gestionado y fondo sin scroll.

## Verificación (comprobado)

- Rama `main`; árbol con solo los ficheros indicados antes del commit.
- `node build-ui.mjs` en `apps/platform`: «panel construido», exit 0.
- `pnpm typecheck` en `apps/platform`: sin errores, exit 0.
- `pnpm test` en `apps/platform`: **81 tests, 79 pass, 0 fail, 2 skipped**.
  - Desviación respecto al encargo (76 tests): el script `test` no incluía el test nuevo, así que se añadió `test/delivery-overlay.test.mjs` a `package.json`. Eso suma 5 tests (76 + 5 = 81).
  - Los 5 tests del archivo nuevo pasan al ejecutarlos por separado (5 pass, 0 fail).

## Límites de la verificación (lo que NO está comprobado)

- El test de `delivery-overlay.test.mjs` prueba una copia de la función de decisión (`shouldOpenDelivery`), no importa `panel.tsx`. Cubre la lógica de decisión, no el componente real.
- No se han hecho capturas de escritorio ni móvil del overlay. No se ha probado en navegador.

## Grafo

- `graphify-out/graph.json`: 3466 nodos, 5673 aristas, 228 comunidades (según el log de reconstrucción tras el commit).

## Pendiente

- Captura visual del overlay en escritorio y móvil, y prueba manual de Publicar y Escape en el navegador.
- Los commits están firmados por `root` (identidad local de git, no configurada en este repositorio).
- El banco de fotos sigue pendiente de curación (fuera de este release).
- `docs/PLAN-VIABLE.md` sigue sin seguimiento (no se incluye en el release).
- El gateway queda `unhealthy` en Coolify hasta que se defina `LLM_PROVIDER_API_KEY` (viene de T-033, no de este release).
