-- El gateway tumbaba el proceso al actualizar tokens de una ejecución en marcha.
--
-- CAUSA: `agent_runs_gateway_update` (0015) exige `status IN ('ok',
-- 'budget_exhausted', 'error', 'cancelled')` en el `WITH CHECK`, pensando solo
-- en el cierre de la ejecución. Pero el gateway suma tokens DURANTE la
-- ejecución, mientras la fila sigue en `'running'` (la pone `app_platform` al
-- crearla): ese UPDATE no cambia `status`, pero el `WITH CHECK` se evalúa sobre
-- la fila resultante igual, así que una fila que sigue en `'running'` viola la
-- política con "new row violates row-level security policy". La excepción no se
-- capturaba y tumbaba el proceso del gateway (ver fix en
-- `apps/llm-gateway/src/server.ts`).
--
-- ARREGLO: el `WITH CHECK` admite también `'running'`, y el `USING` pasa de
-- `true` a `status = 'running'`.
--
-- POR QUÉ EL `USING` NO PUEDE SER `true`: sin él, un gateway comprometido podría
-- hacer `UPDATE agent_runs SET status = 'running'` sobre una ejecución ya
-- cerrada y reabrirla, saltándose el presupuesto; 0015 lo prohibía a propósito
-- («nunca puede reabrirla»). Con `USING (status = 'running')` el gateway solo
-- alcanza ejecuciones VIVAS: sumar tokens mientras corren y cerrarlas. Una
-- cerrada queda fuera del `USING`, así que el UPDATE no toca ninguna fila.
-- (Recorrido de `apps/llm-gateway/src/server.ts`: sus dos únicos UPDATE sobre
-- `agent_runs` —tokens y cierre por presupuesto— se ejecutan después de
-- comprobar que la fila está en `'running'`; ninguno escribe sobre una cerrada.)
--
-- El GRANT de columnas de 0015 tampoco cambia: el gateway sigue sin poder tocar
-- `user_id` ni `site_id` (0015 solo concede UPDATE de `tokens_in, tokens_out,
-- status, stop_reason, ended_at`; ninguna migración posterior amplía esas
-- columnas para `app_llm_gateway`). No se toca ninguna otra política ni se
-- concede ningún privilegio nuevo.
DROP POLICY IF EXISTS agent_runs_gateway_update ON agent_runs;
CREATE POLICY agent_runs_gateway_update ON agent_runs
  FOR UPDATE TO app_llm_gateway
  USING (status = 'running')
  WITH CHECK (
  -- Coherencia de la fila, no solo el estado: una ejecución viva no puede
  -- llevar ya un motivo de parada ni fecha de cierre, y una cerrada tiene que
  -- llevar su fecha. Sin esto, el rol del gateway podía dejar una fila
  -- 'running' con `ended_at` puesto (o al revés) y el estado dejaba de decir la
  -- verdad a cualquiera que lo leyera.
  (status = 'running' AND stop_reason IS NULL AND ended_at IS NULL)
  OR (status <> 'running' AND ended_at IS NOT NULL)
);
