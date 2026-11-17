# Plan — Fase 4: catálogo de diseño y agente

Objetivo: que la plataforma **sepa** diseñar y lo **compruebe** sin gastar tokens. Las
cuatro fuentes externas entran como **fila de catálogo** o como **regla determinista**,
nunca como prompt de sistema: el modo rápido tiene una ronda y un prompt de diseño se
come el presupuesto antes de que el agente piense.

## Lo que hay hoy

- `design_styles` (0009) con 8 presets escritos a mano.
- `packages/lint-visual` con 15 reglas de 6.5, `lintHtml`, `lintRelease`,
  `needsOwnerConfirmation`. Integrado en `publish`.
- `packages/llm`, `apps/llm-gateway`, `packages/agent-sdk` (contrato, bucle, presupuesto).
- `apps/workers/src/` **vacío**: 6.5 no corre en segundo plano.
- Hueco de numeración: no existe `0013`; nunca existió, no hay migración perdida.

## Restricciones descubiertas (mandan sobre el plan)

1. **Fuentes externas prohibidas en el sitio publicado.** La CSP del renderer no lleva
   `font-src` y `theme-css.ts` solo emite pilas del sistema, a propósito: cargar Google
   Fonts revelaría el sitio del cliente a un tercero. De las 74 parejas y 1934 fuentes de
   *ui-ux-pro-max* **no se importa ni una como webfont**: se traducen a pilas del sistema.
2. **El tema no tiene campo `pairing`.** `typography` es `{ family, scale }`. La pareja
   tipográfica vive en el catálogo como recomendación; el documento guarda una familia.
3. **Los colores de origen no son tokens.** Vienen como prosa («Monochromatic, Black
   #000000…»). El importador extrae hex, elige `ground/ink/accent` y **mide contraste**;
   lo que no llegue a 4.5:1 entra como `supplemental`, no `active`.
4. **7.5 y 7.7.6 son cosas distintas.** 7.5 es el catálogo curado (lo que necesitamos
   ahora). 7.7.6 es el ciclo automático de la Fase 5b: exige dictamen legal (7.7.9.C) y
   Playwright. **Este plan no toca 5b.**

## Cortes

### 1. Migración `0016` — tablas de catálogo de 7.5

Crea `design_product_types`, `design_palettes`, `design_font_pairings`,
`design_landing_patterns`, `design_ux_rules`, `design_antipatterns`. Todas con `source`,
`license`, `license_url`, `verified_at`, `status`. Sin RLS (datos globales, 7.5);
escritura solo por rol de migración.

*Hecho:* las 6 tablas existen y `design_styles` gana `license_url` y `origin_ref` para
poder decir de dónde salió cada fila.

### 2. `packages/catalog-import` — traer datos y adaptarlos

Lee los CSV de *ui-ux-pro-max* (MIT), normaliza a **nuestro** shape y **filtra**:

- colores → `{ground, ink, accent}` con contraste medido;
- `family` → pila del sistema de una lista cerrada y revisada a mano;
- `scale` → `compact|normal|comfortable|large`;
- `margin`/`sectionGap` → enteros en px;
- `radius` → `square|rounded|pill`;
- `sections` → tipos de 6.2 que existan de verdad en `ui-components`.

Reutiliza `contrastRatio` de `lint-visual`. Un estilo que no pase → `supplemental`.

*Hecho:* `node packages/catalog-import/bin/import.mjs --dry-run` informa cuántos entran,
cuántos caen y por qué; nada se escribe sin `--write`.

### 3. Reglas nuevas en `lint-visual`

De *Vercel Web Interface Guidelines*: foco visible, `prefers-reduced-motion`, imágenes con
dimensiones, formularios. De *emilkowalski/skills*: animar solo `transform`/`opacity`,
duración fuera de rango, `will-change` permanente. De *huashu-design*: imagen rota, texto
que desborda su caja. Solo lo que sea **determinista sobre el CSS emitido**; lo que exija
medir píxeles es de la Fase 5.

*Hecho:* una prueba positiva y una negativa por regla nueva, y `NOTICE` actualizado con las
tres atribuciones.

### 4. Herramientas del SDK

`recommend_design_system` (consulta catálogo, devuelve 2–3 presets con motivo),
`run_lint` (6.4), `run_visual_lint` (6.5), `critique_draft` (máximo 3 problemas,
determinista sobre tokens y estructura). Las cuatro son de **lectura**: no mutan, no
necesitan checkpoint y no pueden publicar.

*Hecho:* cada una validada con Zod y probada sin red ni base real.

### 5. `agents/design`

Brief → inventario → recomendación → plan → checkpoint → construcción → validación.
Modo rápido: una ronda. **No existe herramienta de publicar**: el agente no publica por
construcción, no por disciplina.

*Hecho:* briefs de prueba producen borradores válidos contra `site-schema`; ninguna
ejecución puede publicar; un `error` de 6.5 pedido por el dueño se aplica y solo avisa.

### 6. `apps/workers` — el linter en segundo plano

Cola que corre `lintRelease` al crear un release y registra hallazgos. Sin esto, 6.5 solo
existe en la ruta de publicación.

## Orden y por qué

`1 → 2 → 3 → 4 → 5 → 6`. Primero esquema, luego datos, luego reglas: el agente del corte 5
necesita que 1–4 existan para poder consultar y comprobar. El 6 va al final porque no
bloquea al agente.

## Lo que este plan no hace

- No activa el catálogo para clientes reales: 7.7.9.C exige dictamen legal escrito.
- No toca 7.7.6 (crawler, Playwright, variantes automáticas): es Fase 5b.
- No añade webfonts ni cambia la CSP.
- Sin catálogo, el agente sigue funcionando con los 8 presets (7.7.9.D).
