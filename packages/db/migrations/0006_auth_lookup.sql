-- Fase 1: el login necesita encontrar la cuenta por email antes de saber quien es,
-- pero RLS en `users` solo permite la fila propia. Abrir la tabla seria peor (dejaria
-- leer todos los emails y hashes), asi que la busqueda va por una funcion acotada.

CREATE OR REPLACE FUNCTION auth_lookup_login(p_email text)
RETURNS TABLE (id uuid, password_hash text)
LANGUAGE sql
SECURITY DEFINER
-- Fija el search_path: una funcion SECURITY DEFINER nunca debe heredarlo.
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.password_hash
  FROM public.users u
  WHERE u.email = lower(p_email)
  LIMIT 1
$$;

-- Solo la aplicacion puede ejecutarla, y solo devuelve una fila.
REVOKE ALL ON FUNCTION auth_lookup_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_login(text) TO app_platform;
