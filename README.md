# webdesign · Fase 1 — agente de diseño

Plataforma multi-sitio para crear, previsualizar y publicar páginas informativas mediante
editor visual y agente de diseño conversacional. La especificación vigente es
`especificacion-construccion-v1.15.md`; `archivo/` es histórico y no se modifica.

## Objetivo

El agente convierte una conversación breve en un borrador estructurado: entiende el brief,
redacta copy sujeto a guardas deterministas, recomienda un estilo, busca fotos licenciadas,
genera el documento del sitio y lo deja pendiente de revisión humana. El dueño conserva el
control de edición, preview y publicación.

## Stack

- TypeScript estricto, pnpm y Turborepo.
- `apps/platform` para panel, API, preview y publicación.
- `apps/workers` para jobs de diseño y persistencia de checkpoints.
- PostgreSQL con pgvector, Drizzle y Redis/BullMQ.
- Puck como editor, `site-schema` como contrato JSON, `renderer` para HTML estático.
- `llm-gateway` como único servicio con claves de proveedores de modelos.
- Pexels como fuente de fotos y vídeos, con caché compartida y trazabilidad.

## Comandos

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm i18n:check
pnpm turbo run typecheck test --force
```

## Documentos de referencia

- `especificacion-construccion-v1.15.md`: fuente de verdad y criterios de aceptación.
- `NOTICE`: atribuciones, licencias de `impeccable`, catálogo y Pexels.
- `WORK_STATE.md`: cortes de estado, decisiones, verificaciones y pendientes.
- `docs/runbooks/despliegue.md`: migraciones, orden y variables de despliegue.
- `docs/runbooks/diagnostico.md`: códigos operativos y diagnóstico sin secretos.
- `docs/README-fase-1-agente-diseno.md`: alcance y contratos de esta entrega.

## Hecho en disco

- Editor conversacional: prompt inicial, preguntas mínimas, reanudación y deshacer; el
  borrador queda para confirmar y el agente no publica.
- Copy: contrato validado, guardas contra datos inventados, reintento único de lectura y
  `CopyUnavailableError` cuando había descripción del dueño y no se obtuvo copy utilizable.
- Renderer visual: documento estructurado, HTML estático, lint de contenido y reglas visuales
  deterministas antes de escribir el release.
- Fotos: búsqueda inyectada desde la plataforma, activos con licencia, Pexels y caché en
  `MEDIA_LIBRARY_ROOT`; cada sitio mantiene `FUENTES.md` con autor, enlace, licencia y fecha.
- Migraciones, jobs, checkpoints y API conectan el flujo prompt → copy → fotos → draft →
  preview → publicación bajo revisión del dueño.

No se hizo commit, push ni deploy en esta actualización.

## Pendientes bloqueantes antes de vender

Faltan una E2E real del recorrido completo, dominios, pagos y suscripciones, backups
restaurados, revisión de seguridad, legal/licencias, observabilidad y un operador con
procedimientos de soporte. El hecho de que typecheck o pruebas unitarias pasen no sustituye
la aceptación de producción.
