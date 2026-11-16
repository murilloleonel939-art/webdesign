-- Panel de operador (Fase 2).
--
-- El operador necesita ver las cuentas y el estado de todos los sitios para
-- atender a los clientes. Las politicas de 0003/0008 solo miran `owner_id`, y
-- abrirlas por rol dejaria el aislamiento en manos del SQL de cada consulta.
-- Se usa el mismo mecanismo que `app.public_resolve` en 0008: una marca de
-- transaccion que la plataforma pone con SET LOCAL y que el navegador no puede
-- activar, y que ademas exige que el usuario sea `operator` en `users`.
--
-- Solo lectura. El operador mira, no edita el contenido de nadie: para eso esta
-- el dueno. Tampoco ve los mensajes de los formularios, que son datos
-- personales de terceros.

-- Quien es operador, segun la propia fila del usuario. Se usa en cada
-- politica para que retirar el rol cierre el acceso al instante.
--
-- SECURITY DEFINER no es un adorno: esta funcion se llama desde la politica de
-- `users` y lee `users`. Sin ejecutarse como su dueno (el rol que migra, que es
-- superusuario) la lectura dispararia la misma politica otra vez y Postgres
-- abortaria con "infinite recursion detected in policy for relation users".
-- Al ejecutarse como superusuario, la lectura interna no pasa por RLS.
CREATE OR REPLACE FUNCTION app_is_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp AS $$
  SELECT current_setting('app.operator_view', true) = 'on'
     AND EXISTS (
       SELECT 1 FROM users u
       WHERE u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND u.role = 'operator'
     )
$$;

-- El JOIN con `users` para saber de quien es cada sitio choca con `users_self`,
-- que solo deja ver la propia fila: sin esta politica el INNER JOIN no devuelve
-- nada y el panel sale vacio sin dar ningun error.
-- Una funcion SECURITY DEFINER ejecutable por cualquiera seria una puerta: se
-- limita a los roles que de verdad la necesitan. `PUBLIC` viene con EXECUTE por
-- defecto en Postgres y hay que quitarselo explicitamente.
REVOKE ALL ON FUNCTION app_is_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_operator() TO app_platform;

DROP POLICY IF EXISTS users_operator_view ON users;
CREATE POLICY users_operator_view ON users FOR SELECT
  USING (app_is_operator());

DROP POLICY IF EXISTS sites_operator_view ON sites;
CREATE POLICY sites_operator_view ON sites FOR SELECT
  USING (app_is_operator());

DROP POLICY IF EXISTS site_versions_operator_view ON site_versions;
CREATE POLICY site_versions_operator_view ON site_versions FOR SELECT
  USING (app_is_operator());

DROP POLICY IF EXISTS domains_operator_view ON domains;
CREATE POLICY domains_operator_view ON domains FOR SELECT
  USING (app_is_operator());
