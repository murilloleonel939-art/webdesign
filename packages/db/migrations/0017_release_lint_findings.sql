-- Fase 4: hallazgos del linter visual (spec 6.5) por release.
--
-- El linter visual corre en `workers` cuando se crea un release, no en la
-- peticion del dueno: asi la publicacion no espera a jsdom. Se guarda un
-- hallazgo por fila, no un JSON: el panel filtra por severidad y por codigo, y
-- `code` es lo que se agrupa para avisar de un defecto repetido.
--
-- 6.5 nunca bloquea: esta tabla informa. Ninguna consulta de publicacion la
-- mira; si el job falla, el release existe igual y sin hallazgos.

CREATE TABLE IF NOT EXISTS release_lint_findings (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  version integer NOT NULL,
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  -- Clave de traduccion, no texto final (mismo contrato que `LintFinding`).
  message text NOT NULL,
  -- Nulo en hallazgos que no son de una pagina concreta.
  page_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Consulta del panel: los hallazgos de un release concreto.
CREATE INDEX IF NOT EXISTS release_lint_findings_site_version_idx
  ON release_lint_findings (site_id, version);

-- Mismo aislamiento que el resto de tablas de sitio (0003): el sitio es del
-- usuario fijado en la transaccion. El worker escribe con el rol de la
-- plataforma y `app.user_id` puesto, igual que el flujo de publicacion.
ALTER TABLE release_lint_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_lint_findings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS release_lint_findings_owner ON release_lint_findings;
CREATE POLICY release_lint_findings_owner ON release_lint_findings
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = release_lint_findings.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = release_lint_findings.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

-- El worker corre en segundo plano y no opera en nombre de un dueno: no tiene
-- `app.user_id` que fijar y, con la politica de arriba, no veria ni una fila.
-- Se usa el mismo mecanismo que el formulario publico (0008): una marca de
-- transaccion que solo pone el servidor y que vive lo que dura esa transaccion.
-- Es de escritura y nada mas: el worker borra y reinserta los hallazgos de un
-- release, y no puede leer ni tocar el resto de la tabla.
DROP POLICY IF EXISTS release_lint_findings_worker ON release_lint_findings;
CREATE POLICY release_lint_findings_worker ON release_lint_findings FOR DELETE
  USING (current_setting('app.release_lint', true) = 'on');

DROP POLICY IF EXISTS release_lint_findings_worker_insert ON release_lint_findings;
CREATE POLICY release_lint_findings_worker_insert ON release_lint_findings FOR INSERT
  WITH CHECK (current_setting('app.release_lint', true) = 'on');

-- El worker necesita leer el documento del release para poder analizarlo. Solo
-- lectura, y solo con la marca puesta en la transaccion propia.
DROP POLICY IF EXISTS site_versions_release_lint ON site_versions;
CREATE POLICY site_versions_release_lint ON site_versions FOR SELECT
  USING (current_setting('app.release_lint', true) = 'on');

-- Permisos del rol de la aplicacion sobre la tabla nueva. Sin DELETE de mas:
-- el worker borra y reinserta los de un release para que el job sea idempotente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON release_lint_findings TO app_platform';
  END IF;
END $$;
