# AGENTS.md

Guía para agentes que trabajan en este repositorio. Ver también `README.md` y
`especificacion-construccion-v1.15.md`.

## Skill de seguridad

- Existe una skill de auditoría de seguridad en `.dsh/skills/security-audit/`
  (adaptación local de la skill MIT de Cloudflare; alcance en `PROJECT-SCOPE.md`).
- Úsala para revisar **nuestro propio código** de este repositorio.
- **Nunca** la ejecutes contra producción (`zottaweb.site`) ni contra endpoints
  desplegados. La skill ya lo prohíbe y aquí se reitera.
