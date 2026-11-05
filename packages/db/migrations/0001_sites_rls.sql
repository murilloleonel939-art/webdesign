-- Fase 0: tabla de sitios con aislamiento por fila forzado.
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_owner ON sites;
CREATE POLICY sites_owner ON sites
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
