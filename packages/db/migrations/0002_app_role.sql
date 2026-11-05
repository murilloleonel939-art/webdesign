-- Rol de la aplicación: sin superusuario, sujeto a RLS.
-- La contraseña NO va aquí: se fija a mano en Coolify con ALTER ROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_platform', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_platform;
