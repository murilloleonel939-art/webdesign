# WORK_STATE · webdesign

## Objetivo
Especificación de construcción de la plataforma de sitios web con agentes de IA, en versión que el equipo constructor pueda seguir sin ambigüedad.

## Avances
- v1.1 a v1.13 en `especificacion-construccion-v1.N.md` (históricos, no modificar).
- Revisión externa recibida: 6 puntos (catálogo sin humanos, ancla de borrado, abuso en prueba, moderación operativa, contradicción de vídeos, higiene del documento).
- Decidido: aplicar los 6 puntos en v1.14 y partir el documento en archivos enlazados.

## Decisiones
- Catálogo: descriptores solo numéricos o enumeraciones de esquema; dictamen legal antes de activar; frenos automáticos (reversión, activación gradual, cortacircuitos, apagado); descubrimiento abierto (7.7.8 B) fuera del lanzamiento.
- Borrado: `delete_after` = último pago + 30 días, o fin de prueba + 30 días si nunca pagó. Facturas y evidencias legales se conservan aparte.
- Prueba: límites antiabuso y `X-Robots-Tag: noindex` hasta el primer pago.
- Vídeos propios: 2 por página, 8 MB cada uno.

## Hecho en v1.14
- `especificacion-v1.14/` con 7 archivos enlazados + CHANGELOG; índice en `01-nucleo.md`.
- Los 6 puntos aplicados. Historial fuera del cuerpo y ordenado (v1.1 a v1.14, descendente).
- Grafo actualizado.

## Estado actual (v1.15)
- Documento vigente único: `especificacion-construccion-v1.15.md`.
- Cuentas de prueba por IP: 2 cada 30 días.
- `archivo/`: versiones v1.10 a v1.13 y la carpeta partida de v1.14 (esta última ya incluye el cambio de IP).

## Próximos pasos
1. Revisión del documento partido.
2. Cifras pendientes de confirmar con datos reales (14.1).
3. No hacer commit hasta que se ordene.
