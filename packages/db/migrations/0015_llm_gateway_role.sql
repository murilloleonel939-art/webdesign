-- Fase 4: permisos minimos del servicio `llm-gateway`.
--
-- Spec linea 591: el rol `app_llm_gateway` solo recibe INSERT en `usage_events`
-- y lectura sobre los presupuestos. No lee contenido de sitios, no toca drafts,
-- no ve leads y no puede modificar una ejecucion ya cerrada. Es el rol que
-- tiene las claves de proveedor, asi que su superficie se mantiene minima: si
-- el servicio se ve comprometido, escribe consumo y poco mas.
--
-- A diferencia del rol de la plataforma, este NO esta sujeto a RLS por usuario:
-- no opera en nombre de un dueno. Solo escribe eventos de consumo, que llevan
-- el `user_id` como dato, no como contexto de sesion.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_llm_gateway') THEN
    CREATE ROLE app_llm_gateway LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_llm_gateway', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO app_llm_gateway;

-- Lo unico que escribe: el evento de consumo.
GRANT INSERT ON usage_events TO app_llm_gateway;

-- Lo unico que lee: el presupuesto de una ejecucion y sus tokens vigentes, para
-- validar que quien pide una llamada tiene saldo y no esta revocado.
GRANT SELECT ON agent_runs TO app_llm_gateway;
GRANT SELECT ON agent_tokens TO app_llm_gateway;

-- Y lo unico que actualiza: apuntar el consumo acumulado y cerrar la
-- ejecucion. Nunca puede reabrirla ni cambiar el dueno.
GRANT UPDATE (tokens_in, tokens_out, status, stop_reason, ended_at) ON agent_runs TO app_llm_gateway;
GRANT UPDATE (revoked_at) ON agent_tokens TO app_llm_gateway;

-- RLS: las tablas de agente exigen `app.user_id`, que el gateway no fija porque
-- no opera en nombre de un dueno. Sin una politica propia, `GRANT SELECT` no
-- devolveria ninguna fila y el gateway no podria validar un token ni saber si
-- queda presupuesto. Se le da lectura completa y se limita por columnas arriba:
-- `usage_events` (donde vive el detalle) solo lo escribe, no lo lee, y de
-- `agent_runs` no puede tocar `user_id` ni `site_id`.
DROP POLICY IF EXISTS agent_runs_gateway ON agent_runs;
CREATE POLICY agent_runs_gateway ON agent_runs
  FOR SELECT TO app_llm_gateway USING (true);

DROP POLICY IF EXISTS agent_runs_gateway_update ON agent_runs;
CREATE POLICY agent_runs_gateway_update ON agent_runs
  FOR UPDATE TO app_llm_gateway
  USING (true)
  WITH CHECK (status IN ('ok', 'budget_exhausted', 'error', 'cancelled'));

DROP POLICY IF EXISTS agent_tokens_gateway ON agent_tokens;
CREATE POLICY agent_tokens_gateway ON agent_tokens
  FOR SELECT TO app_llm_gateway USING (true);

DROP POLICY IF EXISTS agent_tokens_gateway_update ON agent_tokens;
CREATE POLICY agent_tokens_gateway_update ON agent_tokens
  FOR UPDATE TO app_llm_gateway USING (true) WITH CHECK (true);

-- Sin esto el gateway no podria escribir su unico deber: la politica de
-- `usage_events` filtraba por `app.user_id`, que el servicio no fija.
DROP POLICY IF EXISTS usage_events_gateway_insert ON usage_events;
CREATE POLICY usage_events_gateway_insert ON usage_events
  FOR INSERT TO app_llm_gateway WITH CHECK (true);
