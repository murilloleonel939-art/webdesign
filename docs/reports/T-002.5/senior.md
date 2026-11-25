# Reporte T-002.5 — senior (claude-opus-5-5)

- Fecha: 2026-11-24T14:52Z
- Resultado: DONE
- Qué hice (3 a 5 líneas):
  - Añadí `liderazgo` a `CLAIM`, siguiendo la política fijada por el lead: la guardia poda **afirmaciones de estado** y conserva **actividades**.
  - Saqué `contact` del corpus numérico del dueño: un teléfono o un correo ya no autorizan cifras de plazo, cantidad ni año. Cierra el hallazgo 1 de seguridad.
  - Añadí 4 pruebas y ajusté 2 que afirmaban la política anterior, con la justificación en un comentario dentro de cada una.
  - Una sola desviación del encargo, a favor de su propia prueba: el patrón enviado no podaba «liderazgos» (ver Decisiones).
- Archivos tocados: `agents/design/src/copy.ts` (`CLAIM`, `ownerNumbers`) y `agents/design/test/copy.test.mjs`. Nada más.

## Decisiones y por qué

1. **`azgos?` en lugar de `azgo`: una `s` más que el patrón enviado.** Antes de escribirlo probé el patrón tal cual: **no podaba «liderazgos»**, y la prueba del propio encargo exige podarlo. Por el `\b` final, `l[íi]der(azgo|es)?` casa con «liderazgo» y se detiene ante la `s`.

   | Forma | Patrón enviado | Patrón aplicado |
   | --- | --- | --- |
   | liderazgo | poda | poda |
   | **liderazgos** | **conserva** ✗ | poda |
   | líder / líderes | poda | poda |
   | liderar / coliderar / liderando equipos | conserva | conserva |

   Es el mismo criterio de las demás familias, que ya cubren el plural (`premiad[oa]s?`, `certificad[oa]s?`). Con el patrón aplicado comprobé de nuevo el resto de la tabla (premiados, certificaciones, garantizado, nº1, clientes satisfechos, años de experiencia) y las mayúsculas (`Liderazgo`, `LIDERAZGOS`). Todo da lo esperado.
   Patrón final:
   ```
   \b(clientes satisfechos|años de experiencia|anos de experiencia|premiad[oa]s?|certificad[oa]s?|certificaci[oó]n(es)?|garantizad[oa]s?|l[íi]der(azgos?|es)?|n[ºo°]\s*1)\b
   ```

2. **`contact` fuera de `ownerNumbers`.** El corpus queda en `description`, `name`, `businessType`, `city` y `service`. No le doy un trato especial al contacto: simplemente no aporta cifras al corpus. Sigue publicándose tal cual en la sección de contacto (lo afirma una prueba), y como sigue en el brief, `briefValueOk` y el resto de capas no cambian.

## Pruebas

**Nuevas (4):**
1. Podan «Nuestro liderazgo», «Tres liderazgos», «Somos el líder» y «Somos líderes»; conservan «liderar», «coliderar» y «liderando equipos».
2. `contact: "600 24 24 24"` + «Entrega en 24 horas» → **se poda**.
3. `description: "entrega en 24 horas"` (con el mismo contacto) + «Entrega en 24 horas» → **se conserva**. Es el control de la anterior.
4. El contacto `600 24 24 24` sigue llegando a `props.phone` de la sección de contacto.

**Ajustadas (2), por el cambio de política, no para que pasen:**

| Prueba | Antes afirmaba | Ahora |
| --- | --- | --- |
| `Fix C: NO se podan…` | «Taller de liderazgo…» se conservaba | Esa línea sale: `liderazgo` se poda por decisión del lead. Entra «Estamos liderando el cambio», que es una actividad. |
| `guardia: el corpus son todos los campos…` | `contact` también avalaba cifras | Recorre los cinco campos que quedan en el corpus. El contacto tiene su propia prueba (la 2 de arriba). |

## Script de testing

`node --test /tmp/t002-independent.mjs` sigue en **9 pass / 1 fail**. El que falla es su tabla de `CLAIM`, que se detiene en la primera discrepancia, `certificaciones`. La política del lead ya ha resuelto las tres formas en disputa: `certificaciones` se **poda**, `liderar` se **conserva** y `liderazgo` se **poda**. Con esa política, el script tiene mal dos de las tres expectativas (`certificaciones` y `liderar`); `liderazgo` coincide ahora con lo que el script esperaba. Al estar fuera del repo y pertenecer a testing, no lo modifiqué: le corresponde a testing actualizarlo en su revisión desde cero.

## Verificación (después del último cambio)

- `pnpm turbo run build --force` → 22/22 tareas correctas.
- `cd agents/design && pnpm test` → **100 tests, 100 pass, 0 fail** (96 + 4).
- `pnpm turbo run typecheck test --force` → 67/67 tareas correctas, **424 tests, 424 pass, 0 fail** (420 + 4).
- Sin verificar en esta máquina: los 6 archivos de integración con Postgres (spec §7, ADR 0003). Ninguno toca este paquete.

## Pendientes y riesgos (aceptados por el lead, no cambian)

- `meta.name` y `design.brief` conservan el nombre del dueño tal cual, aunque lleve un reclamo. Es un dato identificativo, está afirmado en las pruebas y el lead lo documentará en un ADR.
- El **contexto** de una cifra no se comprueba: una cifra que el dueño escribió en `service` puede reaparecer en otra frase con otro sentido. El token completo ya impide que «2019» valide «19». Atarla a la semántica del campo es otro trabajo, aceptado como riesgo residual.
- No hice commit.

- Entrego a: testing (revisión desde cero; seguridad solo si testing da PASS)
- Referencias:
  - `docs/reports/T-002.4/senior.md` (sección «T-002.5»)
  - `docs/reports/T-002/security.md` (hallazgo 1)
  - `agents/design/src/copy.ts` (`CLAIM`, `ownerNumbers`)
  - `agents/design/test/copy.test.mjs` (bloque «T-002.5» al final)
  - `/tmp/t25-build.log`, `/tmp/t25-pkg.log`, `/tmp/t25-test.log` (efímeros)
