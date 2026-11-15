# ADR 0001 · Reordenar las fases: el producto antes que la infraestructura

- **Fecha:** 2026-11-15
- **Estado:** aceptado
- **Afecta a:** §13 (fases) de `especificacion-construccion-v1.15.md`

## Contexto

La especificación ordenó las fases por dependencia técnica: primero el
hosting multiusuario, después los pagos, después la política de contenido,
y al final lo que hace que el producto sirva para algo — el agente de diseño
(Fase 4) y la biblioteca de estilos (Fase 5b).

Ese orden presupone una plataforma con demanda: muchos dueños llegando a la
vez, que necesitan cuotas, cobros y moderación antes de abrir la puerta.

La realidad del proyecto es la contraria. A 15 de noviembre de 2026:

- La Fase 0 está cerrada y la Fase 1 completa en código (15 paquetes con
  pruebas, `tsc` limpio, publicación y rollback verificados).
- **No hay ningún sitio publicado.** `https://zottaweb.site/` devuelve el 404
  JSON de `platform`: Caddy no sirve todavía ninguna carpeta de `/data/hosts`.
- No hay conexión con Cloudflare, ni dominio del pool dado de alta.
- El editor funciona pero arranca en un lienzo vacío: `presetId` es texto
  libre (`"editorial"`) que no lee nadie. No existe catálogo, ni tokens de
  diseño, ni presets aplicables.

Construir las Fases 2, 2b, 2c, 3 y 4 antes que el catálogo produce
infraestructura sin producto: se paga el coste de mantener colas, cuotas y
cobros para un sistema que todavía no genera nada que publicar.

## Decisión

Se adelanta una parte acotada de las Fases 4 y 5b a una **Fase 1b**, sin
esperar al resto de esas fases.

**Fase 1b · Catálogo inicial y punto de partida (nueva)**

- Tablas de catálogo de §7.5 reducidas a lo necesario: `design_styles`,
  `design_palettes`, `design_font_pairings`. Con `source`, `license`,
  `verified_at` y `status`, como pide §7.5.
- **8 presets escritos a mano**, con tokens verificados (contraste AA) y
  orden de secciones. Autoría propia: `source = 'platform'`,
  `license = 'platform-generated'`.
- `POST /api/sites/:id/apply-preset`: aplica tokens y estructura a un
  borrador, con revisión optimista y `audit_log`, igual que cualquier otro
  cambio.
- Pantalla de inicio del editor: elegir estilo, no lienzo en blanco.
- `presetId` deja de ser texto libre: referencia una fila del catálogo.

**Lo que NO entra en Fase 1b** (queda donde estaba, en 5b): los jobs
`catalog-discover`, `catalog-crawler` y `catalog-generate-variants`, la
verificación automática de licencias, el crawl mensual sin intervención y la
generación de variantes. Nada de eso hace falta para tener un editor usable.

Las fases siguientes **conservan su contenido y su número**, pero se
reordenan por prioridad de producto:

| Orden nuevo | Fase | Por qué |
| --- | --- | --- |
| 1 | 1b · Catálogo inicial | Convierte el editor vacío en un producto |
| 2 | 2 · Multiusuario y hosting | Publicar de verdad por hostname |
| 3 | 4 · Agente de diseño | Generar sitios, ya con catálogo donde elegir |
| 4 | 3 · Dominios propios | Solo tiene sentido con clientes reales |
| 5 | 2b · Suscripciones y cobros | Solo con clientes que paguen |
| 6 | 2c · Política de contenido | Obligatoria antes de abrir al público |
| 7 | 5b · Biblioteca dinámica | Automatizar el catálogo que ya existe a mano |

Las Fases 5 a 11 mantienen su orden relativo.

## Alternativas descartadas

- **Mantener el orden y hacer 5b completa.** Requiere crawl, robots.txt,
  verificación de licencias y generación de variantes antes de tener un solo
  preset usable. Semanas de trabajo sin nada que enseñar al dueño.
- **Presets en código, sin tablas.** Más rápido, pero `presetId` seguiría
  siendo texto libre y el agente de diseño (Fase 4) no tendría catálogo que
  consultar. Se descarta por deuda inmediata.
- **Saltarse la Fase 2 y publicar el sitio a mano por SSH.** Funciona una vez
  y no escala ni deja rastro. Se descarta.

## Consecuencias

- **A favor:** el editor pasa a tener un punto de partida real. La Fase 4
  encuentra catálogo donde elegir. Se puede publicar un sitio de punta a punta
  en cuanto entre la Fase 2.
- **En contra:** las Fases 2, 2b y 2c se retrasan. Aceptable: no hay clientes
  esperando, y las tres dependen de decisiones que aún no se han tomado
  (proveedor de cobros, umbrales de moderación).
- **Riesgo:** el catálogo escrito a mano puede no encajar con lo que piden los
  dueños reales. Mitigación: son 8 filas en base de datos, no código; se
  editan o se sustituyen sin desplegar.
- **Deuda:** al llegar a 5b, los presets manuales deben migrarse al esquema
  completo de §7.7.6. La tabla nace con las columnas de §7.5 justamente para
  que esa migración sea aditiva.

## Evidencia que sostiene el diagnóstico

El 15 de noviembre se comprobó por HTTP contra producción:

- `/healthz` → 200, `/app` → 200, `/app/panel.js` y `/app/panel.css` → 200.
- El CSS servido contiene `.asset-popover` y ya no `.asset-drawer`: el
  despliegue del rediseño llegó.
- `/` → 404 con `content-type: application/json`, servido por `platform`, no
  por Caddy.

La conclusión es que el sistema funciona de abajo arriba y no tiene nada que
servir por arriba. Este ADR ataca esa brecha.
