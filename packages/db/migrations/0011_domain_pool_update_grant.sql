-- El alta de hostname necesita escribir en el pool.
-- 0008 solo daba SELECT sobre site_domain_pool: el INSERT en domains pasaba,
-- pero el UPDATE de `used` fallaba con "permission denied". El error se tragaba
-- en un catch y el sitio publicaba sin direccion ("no queda sitio en el pool").
-- No hay nada que conceder sobre `used`: es un contador, no un dato del cliente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT UPDATE (used) ON site_domain_pool TO app_platform';
  END IF;
END $$;
