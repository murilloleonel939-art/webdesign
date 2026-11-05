-- Fase 1: resolver una sesion ocurre antes de saber de quien es, y RLS en
-- `user_sessions` exige ya saberlo. Misma solucion que el login: funcion acotada
-- SECURITY DEFINER que solo devuelve la sesion vigente de un hash concreto.

CREATE OR REPLACE FUNCTION auth_lookup_session(p_token_hash text)
RETURNS TABLE (id uuid, user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id
  FROM public.user_sessions s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_lookup_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_session(text) TO app_platform;
