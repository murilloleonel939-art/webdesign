-- Reparacion: permisos de tabla que se perdieron por un fallo de diseno.
--
-- Las migraciones anteriores conceden los privilegios del rol `app_platform`
-- dentro de bloques `DO ... IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname =
-- 'app_platform')` (0003, 0004, 0011 y compania). Si el rol no existia en el
-- instante de aplicar la migracion -- base restaurada desde un volcado, un
-- entorno nuevo donde 0002 se aplico despues, un `pg_restore` que no trae
-- roles -- el bloque se salta EN SILENCIO y `schema_migrations` queda marcada
-- como aplicada (packages/db/src/migrate.ts solo mira el nombre del archivo).
-- El permiso no se vuelve a pedir nunca y los workers fallan con
-- "permission denied for table site_drafts" en cada job de diseno.
--
-- Esta migracion no relaja RLS ni toca politicas: solo repite los GRANT. Es
-- idempotente y FALLA EN VOZ ALTA si el rol no existe, para que el error diga
-- que falta 0002 en vez de dejar otra vez un permiso ausente sin avisar.
--
-- No aparecen aqui `agent_runs`, `agent_tokens`, `agent_tool_calls`,
-- `usage_events` ni `draft_checkpoints`: se rigen por 0020_agent_runs_owner.sql,
-- que concede columnas concretas a proposito. Un GRANT de tabla completa ahi
-- ampliaria lo que 0020 decidio no ampliar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    RAISE EXCEPTION 'falta el rol app_platform: aplica 0002 antes';
  END IF;
END $$;

-- Sin condicional: si llegamos aqui el rol existe y el GRANT tiene que ocurrir.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, site_members, site_drafts, site_versions, assets TO app_platform;
GRANT SELECT, INSERT ON audit_log TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON sites TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO app_platform;

-- Comprobacion explicita. Sin esto, un GRANT que no surte efecto (tabla
-- renombrada, esquema distinto en search_path) pasaria inadvertido otra vez.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'site_members', 'site_drafts', 'site_versions', 'assets', 'sites', 'user_sessions'] LOOP
    IF NOT has_table_privilege('app_platform', t, 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION 'app_platform sigue sin SELECT,INSERT,UPDATE sobre la tabla %', t;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('app_platform', 'audit_log', 'SELECT,INSERT') THEN
    RAISE EXCEPTION 'app_platform sigue sin SELECT,INSERT sobre la tabla audit_log';
  END IF;
END $$;
