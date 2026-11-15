-- Fase 2: dominios por host, formularios de contacto y antispam.
-- Forward-only. El runner abre la transaccion.

-- Hostname -> sitio. Caddy no consulta esto: sirve /data/hosts/<hostname>.
-- La plataforma lo usa para resolver el sitio de un formulario sin fiarse de
-- ningun parametro del cliente.
CREATE TABLE IF NOT EXISTS domains (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  hostname text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pool', 'custom')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verifying', 'active', 'error', 'removed')),
  -- Solo para dominios propios: token TXT y lo que devuelve DNS.
  verify_token text,
  verified_at timestamptz,
  last_check_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Un hostname sirve a un solo sitio. Se compara en minusculas porque DNS no
-- distingue mayusculas y "Cliente.com" colisionaria con "cliente.com".
CREATE UNIQUE INDEX IF NOT EXISTS domains_hostname_key
  ON domains (lower(hostname)) WHERE status <> 'removed';

-- Un sitio tiene como mucho un hostname del pool.
CREATE UNIQUE INDEX IF NOT EXISTS domains_one_pool_per_site
  ON domains (site_id) WHERE kind = 'pool' AND status <> 'removed';

-- Pool de dominios: cada fila es una zona comodin (sitios-a.com).
CREATE TABLE IF NOT EXISTS site_domain_pool (
  id uuid PRIMARY KEY,
  zone_id text NOT NULL,
  domain text NOT NULL UNIQUE,
  capacity integer NOT NULL DEFAULT 180,
  used integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'full', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Subdominios que nunca se asignan: colisionarian con servicios propios o se
-- prestan a suplantacion (banco, pago, verificacion...).
CREATE TABLE IF NOT EXISTS reserved_subdomains (
  label text PRIMARY KEY,
  reason text
);

INSERT INTO reserved_subdomains (label, reason) VALUES
  ('app', 'panel propio'),
  ('api', 'api propia'),
  ('www', 'alias'),
  ('admin', 'panel propio'),
  ('mail', 'correo'),
  ('status', 'servicio propio'),
  ('support', 'servicio propio'),
  ('login', 'autenticacion propia'),
  ('smtp', 'correo'),
  ('ftp', 'servicio de red'),
  ('ns1', 'DNS'),
  ('ns2', 'DNS'),
  ('cdn', 'infraestructura'),
  ('static', 'infraestructura'),
  ('img', 'infraestructura'),
  ('dev', 'entorno interno'),
  ('staging', 'entorno interno'),
  ('test', 'entorno interno'),
  ('banco', 'termino sensible'),
  ('bank', 'termino sensible'),
  ('pago', 'termino sensible'),
  ('pay', 'termino sensible'),
  ('paypal', 'suplantacion de marca'),
  ('visa', 'suplantacion de marca'),
  ('mastercard', 'suplantacion de marca'),
  ('verificacion', 'termino sensible'),
  ('verification', 'termino sensible'),
  ('seguro', 'termino sensible'),
  ('secure', 'termino sensible'),
  ('gobierno', 'termino sensible'),
  ('government', 'termino sensible'),
  ('soporte', 'termino sensible'),
  ('oficial', 'termino sensible'),
  ('official', 'termino sensible')
ON CONFLICT (label) DO NOTHING;

-- Formularios: el envio publico que llega desde la web del cliente.
-- El telefono y el mensaje son datos personales: se guardan solo con
-- consentimiento, igual que en 9.6.
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  message text,
  type text NOT NULL DEFAULT 'contact' CHECK (type IN ('contact', 'quote', 'appointment')),
  consent boolean NOT NULL DEFAULT false,
  consent_text_version text,
  source_host text NOT NULL,
  source_ip_hash text,
  user_agent text,
  spam_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived', 'spam')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_site_created ON leads (site_id, created_at DESC);
-- Conteo por IP y ventana de tiempo sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS leads_ip_created ON leads (source_ip_hash, created_at DESC);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains FORCE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

-- El dueno ve sus dominios y sus leads.
DROP POLICY IF EXISTS domains_owner ON domains;
CREATE POLICY domains_owner ON domains
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = domains.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = domains.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS leads_owner ON leads;
CREATE POLICY leads_owner ON leads
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = leads.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = leads.site_id AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

-- El envio publico llega sin sesion. Una funcion SECURITY DEFINER NO sirve
-- aqui: las tablas llevan FORCE ROW LEVEL SECURITY, que se aplica tambien al
-- dueno de la tabla, y app_platform es NOBYPASSRLS. En vez de eso, la
-- plataforma abre una transaccion y marca un permiso acotado con SET LOCAL:
-- vive solo en esa transaccion y no se puede activar desde el navegador.
--
-- Resolver host -> sitio: solo lectura, solo sitios activos, solo el id.
-- Resolver un host exige leer `domains` Y `sites`: si solo se abriera
-- `domains`, la comprobacion de que el sitio sigue activo no veria la fila.
-- Ambas politicas exigen la marca y solo dejan ver filas ya publicadas.
DROP POLICY IF EXISTS domains_public_resolve ON domains;
CREATE POLICY domains_public_resolve ON domains FOR SELECT
  USING (current_setting('app.public_resolve', true) = 'on' AND status = 'active');

DROP POLICY IF EXISTS sites_public_resolve ON sites;
CREATE POLICY sites_public_resolve ON sites FOR SELECT
  USING (current_setting('app.public_resolve', true) = 'on' AND status = 'active');

-- Registro del envio: solo insercion, solo con la marca puesta y solo con
-- consentimiento explicito. Un envio sin consentimiento no se guarda: se
-- responde igual al visitante y no se conserva el dato personal.
DROP POLICY IF EXISTS leads_public_insert ON leads;
CREATE POLICY leads_public_insert ON leads FOR INSERT
  WITH CHECK (current_setting('app.public_form', true) = 'on' AND consent = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON domains TO app_platform';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON leads TO app_platform';
    EXECUTE 'GRANT SELECT ON site_domain_pool, reserved_subdomains TO app_platform';
  END IF;
END $$;

-- Una cuenta puede tener varios borradores pero solo un sitio `active`.
-- Es criterio de aceptacion de la Fase 2 y lo impone la base, no la aplicacion.
CREATE UNIQUE INDEX IF NOT EXISTS sites_one_active_per_owner
  ON sites (owner_id) WHERE status = 'active';
