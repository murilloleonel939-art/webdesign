# Reporte T-002 — testing, veredicto consolidado

- Fecha: 2026-11-26
- Resultado: **PASS**
- Emitido por: arquitecto (claude-fable-5-2), sobre evidencia de ejecución recogida por el ejecutor ([REDACTED])
- Motivo del procedimiento: los modelos designados para testing (`gpt-6.2-sol` y `gpt-6.1-sol`) fallaron de forma consecutiva sin entregar informe. El veredicto se emite sobre la salida cruda de ejecución, que se conserva en este documento.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| Build | 22/22 tareas, exit 0 |
| Paquete `agents/design` | 128 tests, 128 pass, 0 fail |
| Raíz `typecheck test --force` | 67/67 tareas, 0 fail, 7 `skipped` de Postgres |
| B1 (marcador) | 208 documentos generados, 0 contienen `pendiente de confirmar` |
| B1 control positivo del detector | detecta las 4 variantes (minúsculas, mayúsculas, capitalizada, doble espacio); no da falso positivo con texto normal |
| B1 control positivo del flujo | copy con `aboutBody: "Horario pendiente de confirmar."` → la guardia lo vacía y el documento **no** contiene el marcador |
| B2 (completitud) | 8 presets × con y sin copy = 16 documentos: 3 servicios, about no vacío, faq 3, pasos 3 |
| Orden global | `hero` primero y `contact`+`cta` al final en los 16; sin `pricing` ni `testimonial` |
| `origin` (P1-A) | hero con CTA propio → `copy_del_dueno`; features con encabezado propio → `copy_del_dueno`; servicios íntegramente genéricos → `copy_generico` |
| `origin` contacto (P1-A) | por dato del brief, no por preset: `contacto_del_dueno` con email, `contacto_generico` sin él; no cambia al cambiar de preset |
| Números parciales (P1-B) | con `businessType: "Empresa 2019"` y ciudad de 80, `aboutBody` (273/700) y `seoDescription` (145/155) quedan íntegros, sin fragmentos |
| `businessName` (P1-B) | con nombre de 80 caracteres la clave se **omite** (no se recorta) y `siteCopySchema` pasa |
| Guardia (17 formas) | 12 reclamos podados (premiado, premiados, certificado, certificaciones, garantizado, líder, líderes, liderazgo, liderazgos, nº1, clientes satisfechos, años de experiencia); 5 actividades conservadas (liderar, coliderar, certificar, «Ana se encarga de liderar las reuniones», «Cafetería artesanal del barrio») |
| Sin mezcla | copy con 1 servicio válido → documento sin fragmentos del modelo y servicios idénticos al genérico |

## Orden propio de cada preset

Comprobación con los 8 presets reales de `packages/db/migrations/0009_design_catalog.sql`. Una sección puede faltar por diseño: `gallery` sin fotos, `pricing` y `testimonial` siempre.

| Preset | Preset (descontando omitibles) | Documento | Respeta |
| --- | --- | --- | --- |
| editorial | hero>text>features>cta | hero>text>features>features>faq>contact>cta | sí |
| minimal | hero>text>features>contact | hero>text>features>features>faq>contact>cta | sí |
| warm | hero>text>contact | hero>text>features>features>faq>contact>cta | sí |
| tech | hero>features>faq>cta | hero>features>features>faq>text>contact>cta | sí |
| studio | hero>text>contact | hero>text>features>features>faq>contact>cta | sí |
| trust | hero>features>contact | hero>features>features>text>faq>contact>cta | sí |
| fresh | hero>text>contact | hero>text>features>features>faq>contact>cta | sí |
| bold | hero>features>cta>contact | hero>features>features>text>faq>contact>cta | **no, por diseño** |

- `warm`, `studio` y `fresh` daban «no» en una comprobación previa porque el preset incluye `gallery` y el documento no la tiene al no haber fotos. Descontada esa sección —omitible por diseño— la subsecuencia se respeta.
- `bold` invierte `contact` y `cta` respecto al preset. Es la aplicación de la regla de cierre del proyecto: `contact` y luego `cta`, siempre las dos últimas. Anulación deliberada, documentada en la spec.

## No verificado
- La rama con Postgres: 7 suites salen `skipped` en esta máquina y se validan en CI.
- El punto 11 del checklist (la ronda de resumen no muta el sitio) se apoya en pruebas del repo y en lectura de código, no en una ejecución con modelo real.

## Entrego a
seguridad
