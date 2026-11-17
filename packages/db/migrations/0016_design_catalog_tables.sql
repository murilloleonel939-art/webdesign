-- Fase 4: catalogo de diseno curado (spec 7.5).
--
-- Que es y que no es: 7.5 es el catalogo que la plataforma CONSULTA para
-- recomendar. 7.7.6 (crawler, Playwright, variantes automaticas) es la Fase 5b
-- y no aparece aqui. Este archivo no crea `design_origins` ni `design_pages`.
--
-- Sin RLS: son datos globales de producto, igual que `design_styles`. La
-- escritura es del rol de migracion y del panel de operador, nunca de un dueno.
--
-- Cada fila guarda `source`, `license`, `license_url` y `verified_at` porque la
-- spec 7.7.1 exige poder responder de donde salio cada dato y con que permiso.
-- Una fila sin procedencia no es verificable, y sin verificacion no se puede
-- defender el catalogo.

-- La procedencia se anade a la tabla que ya existia (0009) en vez de recrearla:
-- las 8 filas escritas a mano siguen siendo validas y son `platform`.
ALTER TABLE design_styles ADD COLUMN IF NOT EXISTS license_url text;
ALTER TABLE design_styles ADD COLUMN IF NOT EXISTS origin_ref text;
-- Fecha de la ultima importacion: el importador es idempotente y vuelve a
-- correr sin duplicar; el operador ve cuando se refresco cada fila.
ALTER TABLE design_styles ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- `kind` separa dos cosas que hasta ahora vivian mezcladas en la misma tabla:
--   preset    = tema completo y aplicable. Es lo que el dueno puede elegir.
--   reference = descriptor de estilo con nombre y para-que-sirve, SIN tema.
-- El catalogo importado trae 51 estilos con prosa en vez de hex: pueden entrar
-- como `reference` (el agente los cita al recomendar) pero NO como presets, para
-- no ofrecer al dueno un preset que al aplicarse deja el sitio sin colores.
-- El defecto es `preset` para que las 8 filas de 0009 sigan siendo validas.
ALTER TABLE design_styles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'preset';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_styles_kind_check'
  ) THEN
    ALTER TABLE design_styles ADD CONSTRAINT design_styles_kind_check
      CHECK (kind IN ('preset', 'reference'));
  END IF;
END $$;

-- Tipos de negocio. Es la primera pregunta del brief (spec 9.1, paso 1): sabiendo
-- que el negocio es una panaderia, el catalogo puede proponer estilos que encajan.
CREATE TABLE IF NOT EXISTS design_product_types (
  id text PRIMARY KEY,
  name text NOT NULL,
  summary text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  -- Estilos que este tipo de negocio admite, por id de `design_styles`.
  -- Se guarda como array y no como tabla puente porque el uso es "dame los
  -- estilos de una panaderia", una lectura, y no hay integridad que proteger
  -- mas alla de que el importador escriba ids existentes.
  style_ids text[] NOT NULL DEFAULT '{}',
  -- Lo que NO usar para este tipo, con el motivo. Es tan util como lo anterior.
  avoid text NOT NULL DEFAULT '',
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Paletas. Van aparte de los estilos para poder cambiar el color sin cambiar el
-- estilo: el dueno dice "me gusta esta forma pero no ese verde".
CREATE TABLE IF NOT EXISTS design_palettes (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- Los tres tokens del tema. El esquema no admite mas (ver site-schema).
  colors jsonb NOT NULL,
  -- Contraste medido ground/ink y ground/accent. Se guarda el numero calculado,
  -- no una promesa: 6.5 solo acepta >= 4.5 en texto.
  contrast_ink numeric(5,2) NOT NULL,
  contrast_accent numeric(5,2) NOT NULL,
  mood text NOT NULL DEFAULT '',
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Parejas tipograficas. Ojo: el documento NO tiene campo `pairing` (theme es
-- { family, scale }); esto es una recomendacion del catalogo que el agente usa
-- para elegir `family`, no un campo que se copie al documento.
-- `family` es siempre una familia que `theme-css.ts` sabe resolver a una pila del
-- sistema: la CSP del sitio no permite fuentes externas.
CREATE TABLE IF NOT EXISTS design_font_pairings (
  id text PRIMARY KEY,
  name text NOT NULL,
  heading_family text NOT NULL,
  body_family text NOT NULL,
  scale text NOT NULL CHECK (scale IN ('compact', 'normal', 'comfortable', 'large', 'xlarge')),
  mood text NOT NULL DEFAULT '',
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Patrones de landing: orden de secciones probado para un objetivo concreto
-- (captar contactos, mostrar carta, reservar). Solo tipos de 6.2 que existen de
-- verdad en ui-components; el importador descarta el resto.
CREATE TABLE IF NOT EXISTS design_landing_patterns (
  id text PRIMARY KEY,
  name text NOT NULL,
  goal text NOT NULL,
  sections jsonb NOT NULL,
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reglas de UX en prosa. Las que se pueden comprobar con codigo viven en
-- lint-visual; aqui quedan las que el agente lee para redactar y `critique_draft`
-- para explicar. `lint_code` enlaza con la regla determinista cuando existe.
CREATE TABLE IF NOT EXISTS design_ux_rules (
  id text PRIMARY KEY,
  category text NOT NULL,
  issue text NOT NULL,
  do_text text NOT NULL,
  dont_text text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  lint_code text,
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Antipatrones: lo que el catalogo sabe que delata una plantilla generica. Es el
-- espejo en prosa de los codigos SLOP_* de 6.5.
CREATE TABLE IF NOT EXISTS design_antipatterns (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  lint_code text,
  source text NOT NULL,
  license text NOT NULL,
  license_url text,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_product_types_active ON design_product_types (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS design_palettes_active ON design_palettes (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS design_font_pairings_active ON design_font_pairings (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS design_landing_patterns_active ON design_landing_patterns (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS design_ux_rules_active ON design_ux_rules (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS design_product_types_keywords ON design_product_types USING gin (keywords);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    -- Solo lectura, igual que design_styles en 0009: el catalogo lo escribe el
    -- rol de migracion o el panel de operador, nunca un dueno.
    EXECUTE 'GRANT SELECT ON design_product_types, design_palettes, design_font_pairings,
      design_landing_patterns, design_ux_rules, design_antipatterns TO app_platform';
  END IF;
END $$;
