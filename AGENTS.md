# AGENTS.md

Guía para agentes que trabajan en este repositorio. Ver también `README.md` y
`especificacion-construccion-v1.15.md`.

## Cadena de roles (obligatoria)

Lee `WORK_STATE.md`, sección «Forma de trabajo», antes de tocar nada. En resumen:

Lector (Haiku 5.5) → Arquitecto (Fable 5.2) → Constructor (Sonnet 5.5) →
Constructor Senior (Opus 5.5, solo para errores no resueltos) → Testing (GPT 6.1 Sol) →
Security (GPT 6.2 Sol) → aprobación del Arquitecto → GitHub (Haiku 5.5).

- El Arquitecto decide la ruta y es el único que la cambia. No escribe código, no commitea.
- Testing y Security devuelven los fallos al Constructor; nada se publica con uno de los dos en rojo.
- Los commits y el push los hace el rol GitHub, con **ficheros explícitos**: nunca `git add -A`.
- Si un agente falla, se para, se avisa al usuario con el formato de `WORK_STATE.md` y **el
  relevo lo decide el usuario**. Nadie elige el modelo sustituto por su cuenta.

## Skill de seguridad

- Existe una skill de auditoría de seguridad en `.dsh/skills/security-audit/`
  (adaptación local de la skill MIT de Cloudflare; alcance en `PROJECT-SCOPE.md`).
- Úsala para revisar **nuestro propio código** de este repositorio.
- **Nunca** la ejecutes contra producción (`zottaweb.site`) ni contra endpoints
  desplegados. La skill ya lo prohíbe y aquí se reitera.
