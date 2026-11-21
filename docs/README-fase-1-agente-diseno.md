# Fase 1 · Agente de diseño

## Alcance

El agente convierte un prompt y un brief breve en un borrador estructurado de sitio. Incluye
editor conversacional, copy con guardas, recomendación de estilo, fotos licenciadas, preview,
checkpoints y publicación únicamente tras confirmación del dueño.

## Flujo

`prompt -> brief -> copy -> fotos -> preset -> draft -> lint -> checkpoint -> preview -> publish`.
El copy se valida antes de recomendar el estilo. Las fotos llegan por una dependencia inyectada;
el agente no conoce proveedores ni contiene claves. El worker guarda un checkpoint antes de
sobrescribir el borrador. El dueño puede revisar, editar, deshacer y publicar.

## Contratos

- `site-schema`: documento JSON, páginas, secciones, tema y assets.
- `SiteCopy`: textos y consultas de foto; `guardCopy` elimina datos no sustentados.
- `CopyUnavailableError`: fallo cerrado cuando había descripción del dueño y no hay copy usable
  tras un único reintento de lectura.
- `PhotoRef`/`SitePhotos`: referencias a assets registrados con licencia, autor y URL.
- Eventos operativos: `design_copy_ok`, `design_copy_fallback` y `design_photos`; nunca contienen
  prompts, copy, secretos ni respuestas completas.

## Seguridad

Las claves de modelos viven solo en `llm-gateway`. `platform` resuelve Pexels y mantiene la
caché `MEDIA_LIBRARY_ROOT`; el sitio conserva `FUENTES.md`, que no se publica. Los errores son
códigos cerrados. Un fallo de checkpoint impide escribir el borrador. El agente no publica ni
recibe acceso directo a base de datos o disco.

## Pruebas

Conocido: typecheck limpio, `agent-design` 40/40, `workers` 15/15 y global 66/67 por scopes.
Una prueba real previa dejó un marcador visible. `workflow-3` no tiene informe disponible.
Falta una E2E reproducible y autenticada de prompt a publicación.

## Hecho en disco

Están implementados el editor conversacional, el copy con reintento y `CopyUnavailableError`,
el renderer visual, el flujo Pexels con caché y `FUENTES.md`, los assets licenciados,
checkpoints, API interna y jobs de workers.

## Pendientes

E2E real, validación de migraciones `0021/0022/0023` en el entorno objetivo, despliegue ordenado
`platform -> workers`, dominios, pagos, backups restaurados, seguridad, legal, observabilidad y
operador. Workers necesita `DATABASE_URL=app_platform`, `PEXELS_API_KEY` y `MEDIA_LIBRARY_ROOT`.

## Criterio comercial

No vender hasta demostrar el flujo completo con datos reales y rollback, confirmar dominios y
suscripciones, restaurar un backup, cerrar revisión legal y de seguridad, disponer de métricas y
alertas, y asignar un operador capaz de atender fallos sin exponer datos.
