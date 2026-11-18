-- Fase 2/3: dos comprobaciones publicas que necesitan leer tablas con RLS
-- forzado sin tener usuario fijado en la transaccion. Forward-only; el runner
-- abre la transaccion.
--
-- Se hace con funciones SECURITY DEFINER, no abriendo politicas: el envio
-- publico (`app.public_resolve` en 0008) obliga a una marca de transaccion por
-- cada consulta, y aqui hay dos casos que no tienen sesion ni la tendran:
--   * el limite de envios por IP, que corre antes de decidir si se guarda;
--   * el asset publico, que pide un visitante anonimo.
-- Al ejecutarse como el dueno de la funcion (el rol que migra, superusuario) la
-- lectura interna no pasa por RLS, asi que no hace falta ninguna politica nueva
-- ni tocar las existentes. Ambas son de solo lectura y devuelven una sola cosa:
-- un numero y un booleano. Nada de filas: la plataforma no aprende datos del
-- sitio que no le correspondan.
--
-- `SET search_path = pg_catalog, public`: una funcion SECURITY DEFINER no debe
-- heredar el search_path de quien la llama, o un esquema antepuesto en la sesion
-- podria redirigir las tablas que consulta. STABLE y no VOLATILE: dentro de una
-- misma transaccion el resultado no cambia y el planner puede reutilizarlo.
--
-- Idempotente: CREATE OR REPLACE permite reaplicar sin efecto, y REVOKE/GRANT se
-- repiten sin error.

-- Envios de un sitio desde una IP hasheada dentro de una ventana de tiempo.
-- La IP no se guarda: la plataforma pasa el hash que ella misma calcula y que es
-- distinto por sitio (lleva el id del sitio como sal), asi que dos sitios del
-- mismo duenno no comparten cubo. Una ventana negativa se trata como 0 (solo lo
-- del instante exacto) en vez de sumar minutos hacia el futuro, que contaria
-- envios que aun no existen.
CREATE OR REPLACE FUNCTION app_lead_recent_count(p_site uuid, p_ip_hash text, p_minutes int)
  RETURNS int
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
  SELECT count(*)::int
  FROM leads l
  WHERE l.site_id = p_site
    AND l.source_ip_hash = p_ip_hash
    AND l.created_at > now() - make_interval(mins => GREATEST(p_minutes, 0))
$$;

-- Un asset solo se sirve publicamente si su sitio esta publicado (status
-- `active`) y el asset no ha sido retirado por una reclamacion. Se compara
-- `assets.path`, que es la ruta relativa real que guarda la plataforma
-- (`<kind>/<id>-<hash>.<ext>`), no una ruta inventada por el cliente.
-- Un sitio `draft`, `dark`, `suspended` o `deleted` devuelve false: la ruta
-- sigue en disco pero no es publica.
CREATE OR REPLACE FUNCTION app_public_asset_visible(p_site uuid, p_path text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM assets a
    JOIN sites s ON s.id = a.site_id
    WHERE a.site_id = p_site
      AND a.path = p_path
      AND a.takedown_status = 'active'
      AND s.status = 'active'
  )
$$;

-- Una funcion SECURITY DEFINER ejecutable por cualquiera seria una puerta:
-- Postgres concede EXECUTE a PUBLIC por defecto y hay que quitarselo a mano.
-- Solo el rol de la plataforma las necesita; el navegador nunca las llama.
REVOKE ALL ON FUNCTION app_lead_recent_count(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_public_asset_visible(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_lead_recent_count(uuid, text, int) TO app_platform';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_public_asset_visible(uuid, text) TO app_platform';
  END IF;
END $$;
