-- Fase 1: contenido del sitio, assets y auditoria, con aislamiento por fila forzado.
-- Forward-only. Todo en una transaccion (el runner la abre).

-- Cuentas. El dueno de un sitio es un usuario.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  email_verified_at timestamptz,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'operator')),
  mfa_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columnas de estado del sitio que la Fase 0 no necesitaba.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS subdomain text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS published_page_count integer NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS published_version integer;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS dark_since timestamptz;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS delete_after timestamptz;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_status_check') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_status_check
      CHECK (status IN ('draft', 'active', 'dark', 'suspended', 'deleted'));
  END IF;
END $$;

-- Una cuenta no puede tener dos sitios publicados aunque falle la aplicacion.
CREATE UNIQUE INDEX IF NOT EXISTS sites_one_active_per_owner
  ON sites (owner_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS sites_subdomain_key
  ON sites (subdomain) WHERE subdomain IS NOT NULL;

-- Miembros por sitio (permisos).
CREATE TABLE IF NOT EXISTS site_members (
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (site_id, user_id)
);

-- Borrador vivo: una fila por sitio, revision incremental.
CREATE TABLE IF NOT EXISTS site_drafts (
  site_id uuid PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
  rev bigint NOT NULL DEFAULT 0,
  doc jsonb NOT NULL,
  doc_hash text NOT NULL,
  updated_by_type text NOT NULL CHECK (updated_by_type IN ('user', 'agent')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Versiones publicadas: inmutables.
CREATE TABLE IF NOT EXISTS site_versions (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  version integer NOT NULL,
  schema_version integer NOT NULL,
  doc jsonb NOT NULL,
  doc_hash text NOT NULL,
  created_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);

-- Assets: la ruta fisica vive aqui, nunca en el documento.
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'poster')),
  bytes bigint NOT NULL,
  mime text NOT NULL,
  width integer,
  height integer,
  duration_s numeric,
  source text NOT NULL CHECK (source IN ('own', 'generated', 'open-collection')),
  license text,
  author text,
  source_url text,
  credit_text text,
  takedown_status text NOT NULL DEFAULT 'active' CHECK (takedown_status IN ('active', 'withdrawn_by_claim')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, path)
);

-- Auditoria: solo insercion.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'operator', 'agent', 'system')),
  actor_id uuid,
  site_id uuid REFERENCES sites (id) ON DELETE SET NULL,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

-- Aislamiento por fila forzado en todas las tablas con datos de sitio.
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members FORCE ROW LEVEL SECURITY;
ALTER TABLE site_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE site_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- El usuario ve su propia fila.
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Todas las tablas de sitio comparten la misma regla: el sitio es del usuario.
DROP POLICY IF EXISTS site_members_owner ON site_members;
CREATE POLICY site_members_owner ON site_members
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_members.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_members.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS site_drafts_owner ON site_drafts;
CREATE POLICY site_drafts_owner ON site_drafts
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_drafts.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_drafts.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS site_versions_owner ON site_versions;
CREATE POLICY site_versions_owner ON site_versions
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_versions.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = site_versions.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS assets_owner ON assets;
CREATE POLICY assets_owner ON assets
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = assets.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = assets.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS audit_log_owner ON audit_log;
CREATE POLICY audit_log_owner ON audit_log
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = audit_log.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = audit_log.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

-- La auditoria no se modifica ni se borra nunca desde la aplicacion.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Permisos del rol de la aplicacion sobre las tablas nuevas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON users, site_members, site_drafts, site_versions, assets TO app_platform';
    EXECUTE 'GRANT SELECT, INSERT ON audit_log TO app_platform';
  END IF;
END $$;
