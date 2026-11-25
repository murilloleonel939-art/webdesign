# ADR 0004 — Qué poda la guardia: afirmaciones sí, actividades no

Fecha: 2026-11-24. Estado: aceptado. Contexto: T-002.

## Contexto

`guardCopy` poda del copy del modelo lo que el dueño no aportó. Al revisar T-002 se
descubrió que el patrón `CLAIM` estaba mal calibrado en los dos sentidos: dejaba pasar
«premiado», «certificaciones» y «líderes» por un `\b` mal puesto, y a la vez podaba
«liderar las reuniones», que es una actividad y no una afirmación.

Testing y el desarrollador no coincidían en tres formas: `certificaciones`, `liderar` y
`liderazgo`.

## Decisión

> La guardia poda **afirmaciones de estado** —sustantivos y participios que presumen algo
> del negocio— y **conserva actividades**: verbos que describen lo que se hace.

Consecuencias concretas:

| Forma | Veredicto | Motivo |
| --- | --- | --- |
| premiado, premiados | podar | presume un premio |
| certificado, certificaciones | podar | presume una certificación |
| garantizado | podar | presume una garantía |
| líder, líderes, liderazgo, liderazgos | podar | presume una posición |
| nº1, clientes satisfechos, años de experiencia | podar | cifras y reclamos |
| liderar, coliderar, liderando equipos | conservar | describe una actividad |

Criterio de desempate cuando una forma admite las dos lecturas: **podar**. Un falso
positivo cuesta el texto del modelo, y la sección cae al copy genérico, que es correcto.
Un falso negativo publica una afirmación falsa en nombre del cliente.

## Decisiones asociadas

1. **`meta.name` y `design.brief` conservan el nombre del dueño tal cual**, aunque contenga
   un reclamo. Es un dato identificativo que el cliente declara sobre sí mismo, no una
   afirmación que redacte la plataforma. No se aplica el predicado ahí; sí en todo texto
   de sección.
2. **`contact` queda fuera del corpus numérico.** Un teléfono o un correo no autorizan
   cifras de plazo, cantidad ni año: antes, un «24» del teléfono validaba «Entrega en 24
   horas».
3. **Riesgo residual aceptado:** una cifra sigue autorizándose por campo, no por
   significado. Un «24» escrito en `description` valida «24 horas» aunque el dueño se
   refiriera a otra cosa. Atarlo a la semántica del campo es otro trabajo y no hay datos
   para hacerlo sin adivinar.
