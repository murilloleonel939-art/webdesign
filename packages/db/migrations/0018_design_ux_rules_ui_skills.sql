-- Catalogo en prosa: reglas de UX y antipatrones inspirados en ibelick/ui-skills
-- (MIT, https://github.com/ibelick/ui-skills), skills `baseline-ui` y
-- `fixing-accessibility`.
--
-- Las ideas se reimplementan; no se copia codigo ni se anade dependencia. Sus
-- reglas de Tailwind, `motion/react`, `cn`, `will-change`, `backdrop-filter`,
-- `h-dvh` y `safe-area` describen un stack que esta plataforma no usa (CSS
-- propio, CSP sin fuentes externas, sin transiciones): se descartan a proposito
-- y no entran ni como fila de catalogo.
--
-- Ocho filas en `design_ux_rules`, una por categoria, y tres antipatrones: entre
-- las dos tablas quedan enlazados los seis codigos nuevos de `lint-visual`
-- (A11Y_CONTROL_NO_ACCESSIBLE_NAME, A11Y_FIELD_UNLABELED, A11Y_LINK_VAGUE_TEXT,
-- A11Y_LIST_NOT_SEMANTIC, SLOP_MULTIPLE_ACCENTS, SLOP_Z_INDEX_ARBITRARY) y los
-- ya existentes que cubren el mismo tema (A11Y_NO_VISIBLE_FOCUS,
-- SLOP_HEADING_SKIP, SLOP_LOW_CONTRAST_TEXT_ON_COLOR).
--
-- Idempotente, mismo estilo que 0009: `INSERT ... ON CONFLICT DO NOTHING`.

INSERT INTO design_ux_rules
  (id, category, issue, do_text, dont_text, severity, lint_code, source, license, license_url, verified_at, status) VALUES

  ('ux-accessible-names-controls', 'accessible-names',
   'Un botón o enlace que solo lleva un icono se anuncia como "botón" y nada más: quien no ve la pantalla no sabe qué hace.',
   'Dar nombre al control: texto visible, aria-label en el botón, o aria-labelledby apuntando a un texto que ya existe. El dibujo va con aria-hidden.',
   'Dejar un botón con un svg dentro y confiar en que se entiende por el icono.',
   'error', 'A11Y_CONTROL_NO_ACCESSIBLE_NAME',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-keyboard-native-controls', 'keyboard',
   'Un div o un span con aspecto de botón no recibe el foco, no responde a Enter ni a Espacio y ningún lector lo anuncia como control.',
   'Usar button, a con href, input o select; para un widget complejo, partir de uno accesible antes que rehacer el teclado a mano.',
   'Pintar un div como botón y añadirle onclick sin soporte de teclado.',
   'error', NULL,
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-focus-visible-ring', 'focus',
   'Quien navega con teclado necesita ver dónde está; quitar el anillo sin reponerlo deja el foco en ninguna parte.',
   'Quitar el outline solo si se pinta un sustituto en :focus-visible, con contraste suficiente sobre el fondo.',
   'Poner outline:none en enlaces y botones porque el anillo del navegador parece feo.',
   'error', 'A11Y_NO_VISIBLE_FOCUS',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-semantics-heading-levels', 'semantics',
   'Saltar de h1 a h3 rompe el índice que construye el lector: quien navega por encabezados no encuentra el nivel que falta.',
   'Bajar un nivel cada vez y usar el tamaño de letra para lo visual, no el nivel del encabezado.',
   'Elegir h3 porque queda mejor de tamaño justo después de un h1.',
   'error', 'SLOP_HEADING_SKIP',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-forms-field-labels', 'forms',
   'Un campo sin etiqueta asociada es un hueco en blanco: el placeholder desaparece al escribir y el lector no lo anuncia.',
   'Asociar cada input, select y textarea con un label mediante for/id o envolviéndolo; si no cabe etiqueta visible, usar aria-label.',
   'Usar el placeholder como única etiqueta del campo.',
   'error', 'A11Y_FIELD_UNLABELED',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-contrast-single-accent', 'contrast',
   'Con dos o tres acentos compitiendo ninguno destaca: cada llamada a la acción grita y el ojo no sabe dónde ir.',
   'Un solo acento por vista, tomado del tema; el resto, variantes del mismo tono o del color base, y 4.5:1 de contraste en el texto.',
   'Botón azul, enlace morado y CTA verde en la misma sección.',
   'info', 'SLOP_MULTIPLE_ACCENTS',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-typography-line-length', 'typography',
   'Una línea de 150 caracteres hace que el ojo pierda el renglón al volver a la izquierda.',
   'Limitar la medida del párrafo a 55-75 caracteres y equilibrar los titulares en varias líneas en vez de forzar una sola.',
   'Dejar el párrafo a todo el ancho de la pantalla en escritorio.',
   'info', NULL,
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('ux-layout-z-index-scale', 'layout',
   'Números sueltos de z-index se acumulan hasta que nadie sabe quién tapa a quién y un aviso aparece bajo la cabecera fija.',
   'Usar una escala corta y documentada (0, 10, 20, 30, 40, 50 y sus negativos) y asignar cada capa a un rol.',
   'Escribir z-index: 9999 para que quede encima de lo que sea.',
   'warning', 'SLOP_Z_INDEX_ARBITRARY',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active')

ON CONFLICT (id) DO NOTHING;

INSERT INTO design_antipatterns
  (id, name, description, lint_code, source, license, license_url, verified_at, status) VALUES

  ('antipattern-vague-link-text', 'Enlace que no dice a dónde va',
   'El texto del enlace es "click here", "leer más", "aquí" o directamente está vacío, así que el destino solo se entiende viendo la página. Se reconoce normalizando el texto accesible del enlace; una imagen con alt útil dentro del enlace cuenta como texto y no es vago.',
   'A11Y_LINK_VAGUE_TEXT',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('antipattern-fake-list', 'Lista falsa',
   'Un conjunto de elementos que se lee como lista pero está hecho de divs con guiones o viñetas en el texto. Se reconoce porque hay li fuera de ul/ol/menu, o dos o más líneas que empiezan por guion. Se pierden el conteo de elementos y la navegación entre ellos.',
   'A11Y_LIST_NOT_SEMANTIC',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active'),

  ('antipattern-accent-soup', 'Sopa de acentos',
   'Cada llamada a la acción usa un color distinto: el botón de un tono, el enlace de otro y el CTA de un tercero. Se reconoce contando los colores de fondo de botones y de texto de enlaces de la misma página, ignorando transparent, inherit y currentcolor. Con varios acentos, ninguno guía la mirada.',
   'SLOP_MULTIPLE_ACCENTS',
   'ibelick/ui-skills', 'MIT', 'https://github.com/ibelick/ui-skills', now(), 'active')

ON CONFLICT (id) DO NOTHING;

-- Sin GRANT aqui: 0016 ya da SELECT a app_platform sobre design_ux_rules y
-- design_antipatterns, y el catalogo lo sigue escribiendo el rol de migracion.
