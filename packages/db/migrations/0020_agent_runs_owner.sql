-- Hueco de privilegios, no de politicas.
--
-- 0014 ya define las politicas `agent_runs_owner` y `agent_tokens_owner`, y las
-- cinco tablas llevan ENABLE + FORCE ROW LEVEL SECURITY. Pero ninguna migracion
-- concedia privilegios sobre ellas al rol de la aplicacion. Postgres comprueba
-- el privilegio de tabla ANTES de evaluar RLS: sin GRANT, el INSERT del dueno
-- fallaba con "permission denied" y la politica nunca llegaba a mirarse.
--
-- Esta migracion NO relaja nada: no crea politicas, no toca las de 0014, no usa
-- SECURITY DEFINER y no concede DELETE ni un UPDATE de columna que el flujo del
-- agente rapido necesite fuera de `status`, `stop_reason`, `ended_at` y los
-- contadores de tokens. El resto de columnas se escriben al INSERT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    -- La ejecucion: se crea 'running' y se cierra con su estado y su motivo.
    EXECUTE 'GRANT SELECT, INSERT ON agent_runs TO app_platform';
    EXECUTE 'GRANT UPDATE (status, stop_reason, ended_at, tokens_in, tokens_out) ON agent_runs TO app_platform';

    -- El token temporal: se emite y se revoca. Nada mas se actualiza.
    EXECUTE 'GRANT SELECT, INSERT ON agent_tokens TO app_platform';
    EXECUTE 'GRANT UPDATE (revoked_at) ON agent_tokens TO app_platform';

    -- El dueno mira el estado de su ejecucion desde el panel: solo lectura.
    EXECUTE 'GRANT SELECT ON agent_tool_calls TO app_platform';
    EXECUTE 'GRANT SELECT ON usage_events TO app_platform';

    -- El punto de vuelta atras (9.1): antes de que el agente toque nada se
    -- guarda el borrador tal como estaba, y el boton "deshacer todo" del panel
    -- lo recupera. Solo SELECT e INSERT: el checkpoint es historico, no se
    -- reescribe ni se borra. La politica `draft_checkpoints_owner` de 0014 ya
    -- limita las filas al dueno del sitio.
    EXECUTE 'GRANT SELECT, INSERT ON draft_checkpoints TO app_platform';
  END IF;
END $$;
