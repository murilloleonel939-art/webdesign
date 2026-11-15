-- Fase 1b: catalogo inicial de diseno (ADR 0001).
-- Datos globales: sin RLS, como pide la spec 7.5. Escritura solo por el rol de
-- migracion. Las columnas de licencia y estado existen ya para que 5b migre
-- de forma aditiva, sin reescribir filas.

CREATE TABLE IF NOT EXISTS design_styles (
  id text PRIMARY KEY,
  name text NOT NULL,
  summary text NOT NULL,
  -- Tokens que se aplican al tema del documento.
  colors jsonb NOT NULL,
  typography jsonb NOT NULL,
  spacing jsonb NOT NULL,
  radius text NOT NULL CHECK (radius IN ('square', 'rounded', 'pill')),
  dials jsonb NOT NULL,
  -- Orden y tipo de secciones con las que arranca la pagina.
  sections jsonb NOT NULL,
  source text NOT NULL DEFAULT 'platform',
  license text NOT NULL DEFAULT 'platform-generated',
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'supplemental', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_styles_active ON design_styles (status) WHERE status = 'active';

-- Los ocho presets. Contrastes calculados con la formula WCAG sobre el par
-- ground/ink y ground/accent; todos superan 4.5:1.
INSERT INTO design_styles (id, name, summary, colors, typography, spacing, radius, dials, sections, verified_at) VALUES
  ('editorial', 'Editorial', 'Periódico clásico: papel cálido, serif de titular, aire entre bloques.',
   '{"ground":"#f7f7f2","ink":"#172033","accent":"#1f4ed8"}',
   '{"family":"Source Serif 4","scale":"large"}', '{"margin":64,"sectionGap":72}', 'rounded',
   '{"variance":4,"motion":2,"density":4}',
   '[{"type":"hero"},{"type":"text"},{"type":"features"},{"type":"testimonial"},{"type":"cta"}]',
   now()),
  ('minimal', 'Minimal', 'Menos es más: blanco puro, una sola tinta, jerarquía por tamaño.',
   '{"ground":"#ffffff","ink":"#111111","accent":"#0b5fff"}',
   '{"family":"Inter","scale":"normal"}', '{"margin":80,"sectionGap":96}', 'square',
   '{"variance":1,"motion":1,"density":2}',
   '[{"type":"hero"},{"type":"text"},{"type":"features"},{"type":"contact"}]',
   now()),
  ('warm', 'Cálido', 'Terracota y crema: cercano, artesanal, sin estridencias.',
   '{"ground":"#fdf6ee","ink":"#2b1d17","accent":"#b8451f"}',
   '{"family":"Fraunces","scale":"large"}', '{"margin":56,"sectionGap":64}', 'pill',
   '{"variance":6,"motion":3,"density":5}',
   '[{"type":"hero"},{"type":"text"},{"type":"gallery"},{"type":"testimonial"},{"type":"contact"}]',
   now()),
  ('tech', 'Tecnología', 'Fondo oscuro, acento menta, ritmo apretado y datos por delante.',
   '{"ground":"#0e1117","ink":"#e8edf5","accent":"#24c8a5"}',
   '{"family":"Inter","scale":"normal"}', '{"margin":48,"sectionGap":56}', 'rounded',
   '{"variance":5,"motion":5,"density":7}',
   '[{"type":"hero"},{"type":"features"},{"type":"pricing"},{"type":"faq"},{"type":"cta"}]',
   now()),
  ('studio', 'Estudio', 'Portafolio sobrio: gris piedra, acento violeta, mucho aire.',
   '{"ground":"#f4f4f6","ink":"#1c1b22","accent":"#5b3df5"}',
   '{"family":"Space Grotesk","scale":"large"}', '{"margin":72,"sectionGap":88}', 'rounded',
   '{"variance":7,"motion":4,"density":3}',
   '[{"type":"hero"},{"type":"gallery"},{"type":"text"},{"type":"testimonial"},{"type":"contact"}]',
   now()),
  ('trust', 'Confianza', 'Servicios profesionales: azul profundo, formulario visible, prueba social.',
   '{"ground":"#f8fafc","ink":"#0f172a","accent":"#1d4ed8"}',
   '{"family":"Merriweather","scale":"normal"}', '{"margin":60,"sectionGap":72}', 'rounded',
   '{"variance":3,"motion":2,"density":5}',
   '[{"type":"hero"},{"type":"features"},{"type":"testimonial"},{"type":"pricing"},{"type":"contact"}]',
   now()),
  ('fresh', 'Fresco', 'Verde y blanco: salud, alimentación, bienestar. Limpio y luminoso.',
   '{"ground":"#ffffff","ink":"#14342b","accent":"#0f7b52"}',
   '{"family":"Nunito","scale":"normal"}', '{"margin":64,"sectionGap":80}', 'pill',
   '{"variance":4,"motion":3,"density":4}',
   '[{"type":"hero"},{"type":"text"},{"type":"gallery"},{"type":"pricing"},{"type":"contact"}]',
   now()),
  ('bold', 'Contundente', 'Contraste alto: negro y ámbar, titulares grandes, llamada directa.',
   '{"ground":"#121212","ink":"#fafafa","accent":"#f5a524"}',
   '{"family":"Archivo","scale":"xlarge"}', '{"margin":52,"sectionGap":64}', 'square',
   '{"variance":8,"motion":6,"density":6}',
   '[{"type":"hero"},{"type":"features"},{"type":"gallery"},{"type":"cta"},{"type":"contact"}]',
   now())
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    -- Solo lectura: el catalogo lo escribe el rol de migracion.
    EXECUTE 'GRANT SELECT ON design_styles TO app_platform';
  END IF;
END $$;
