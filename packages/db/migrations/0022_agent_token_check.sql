-- API interna para agentes: comprobar el token de una ejecucion sin sesion.
--
-- El gateway ya valida tokens de agente (apps/llm-gateway/src/server.ts:214-224)
-- leyendo `agent_tokens` con un rol propio y una politica permisiva de solo
-- lectura (0015). La plataforma no puede hacer lo mismo: `agent_tokens` lleva
-- ENABLE + FORCE ROW LEVEL SECURITY y su politica (0014) exige `app.user_id`,
-- que es justo el dato que se quiere averiguar con el token. Sin esto habria que
-- abrir la tabla al rol de la aplicacion, que es lo que 0014 cerro a proposito.
--
-- La solucion es la misma que 0019 para el asset publico: una funcion SECURITY
-- DEFINER, de solo lectura y que devuelve como mucho UNA fila con tres UUID.
-- Al ejecutarse como el rol que migra, la lectura interna no pasa por RLS.
--
-- No se expone ninguna columna sensible: ni scopes, ni fechas, ni el run entero.
-- Tampoco se puede usar para enumerar tokens: sin `jti` exacto no devuelve nada.

CREATE OR REPLACE FUNCTION app_agent_token_check(p_jti uuid, p_scope text)
  RETURNS TABLE (run_id uuid, user_id uuid, site_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
  SELECT t.run_id, r.user_id, t.site_id
  FROM agent_tokens t
  JOIN agent_runs r ON r.id = t.run_id
  WHERE t.jti = p_jti
    AND t.revoked_at IS NULL
    AND t.expires_at > now()
    AND (p_scope = ANY (t.scopes) OR '*' = ANY (t.scopes))
$$;

-- Postgres concede EXECUTE a PUBLIC por defecto: una funcion SECURITY DEFINER
-- abierta a cualquiera seria una puerta. Solo la necesita el rol de plataforma.
REVOKE ALL ON FUNCTION app_agent_token_check(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_agent_token_check(uuid, text) TO app_platform';
  END IF;
END $$;
