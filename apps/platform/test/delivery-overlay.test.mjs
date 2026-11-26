/**
 * T-015: lógica de apertura del overlay de entrega.
 *
 * Lo que se puede probar sin navegador:
 *   1. Tras un run que acaba de terminar (justFinished=true) → debe abrirse.
 *   2. Al abrir un sitio ya diseñado (justFinished=false) → no debe abrirse.
 *   3. Tras cerrarlo una vez (dismissed=true) → no debe volver a abrirse.
 */
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Extrae la lógica pura del overlay sin importar React.
 * shouldOpenDelivery replica el guard de `openDelivery()` en panel.tsx.
 *
 * @param {boolean} justFinished  - ¿Acaba de terminar un run en esta sesión?
 * @param {boolean} dismissed     - ¿Lo cerró ya el dueño antes?
 * @returns {boolean}
 */
function shouldOpenDelivery(justFinished, dismissed) {
  if (dismissed) return false;
  if (!justFinished) return false;
  return true;
}

test("abre el overlay cuando un run acaba de terminar y no fue cerrado antes", () => {
  assert.equal(shouldOpenDelivery(true, false), true);
});

test("no abre el overlay al cargar un sitio ya diseñado (justFinished=false)", () => {
  assert.equal(shouldOpenDelivery(false, false), false);
});

test("no abre el overlay si el dueño ya lo cerró en esta sesión (dismissed=true)", () => {
  assert.equal(shouldOpenDelivery(true, true), false);
});

test("no abre el overlay si dismissed=true incluso con justFinished=false", () => {
  assert.equal(shouldOpenDelivery(false, true), false);
});

// Simula la secuencia completa de una sesión de diseño:
// diseña → overlay se abre → dueño lo cierra → diseña de nuevo → overlay no vuelve.
test("una vez cerrado no vuelve a abrirse aunque termine otro run", () => {
  let dismissed = false;

  // Primera apertura: run termina, no hay dismissed aún.
  const primera = shouldOpenDelivery(true, dismissed);
  assert.equal(primera, true, "debe abrir en el primer run");

  // El dueño lo cierra.
  dismissed = true;

  // Segundo run en la misma sesión: dismissed sigue siendo true.
  const segunda = shouldOpenDelivery(true, dismissed);
  assert.equal(segunda, false, "no debe reabrir tras cerrarlo");
});
