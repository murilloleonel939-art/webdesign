# Runbook · Contenido de explotación infantil (CSAM)

**Estado:** plantilla operativa. **No es válida hasta que un abogado la revise** y confirme autoridades y canales por jurisdicción.

## Principio

Ante cualquier coincidencia o denuncia de CSAM, se actúa de inmediato, sin mostrar el contenido a nadie del equipo más allá de lo imprescindible, y se preserva la evidencia.

## Pasos

1. **Bloqueo inmediato:** suspender la cuenta y retirar el sitio de la red (`/data/hosts/` y purga de caché) en menos de un minuto.
2. **Preservación:** copiar el asset y los metadatos a almacenamiento de evidencias de acceso restringido y registrar en `audit_log` quién y cuándo. No borrar nada del sistema de origen hasta que lo indique el abogado.
3. **No visualizar ni reenviar:** nadie abre el archivo para revisarlo. La decisión se toma con el hash y el resultado del clasificador.
4. **Reporte:** dentro de la hora, a la autoridad competente y al proveedor de moderación, según la jurisdicción del cliente. La tabla de destinos se mantiene en `docs/legal/csam-jurisdicciones.md` y la confirma el abogado.
5. **Registro:** número de reporte, fecha y acuse en `audit_log`.
6. **Escalado:** informar al responsable legal de la plataforma el mismo día.

## Lo que no hace la plataforma

- No notifica al dueño del sitio sobre el reporte.
- No borra la evidencia por iniciativa propia.
- No intenta investigar al usuario.

## Pendiente antes de activar

- [ ] Revisión legal de este runbook.
- [ ] Tabla de autoridades y canales por jurisdicción (`docs/legal/csam-jurisdicciones.md`).
- [ ] Proveedor de moderación con detección por hash elegido (14.2).
