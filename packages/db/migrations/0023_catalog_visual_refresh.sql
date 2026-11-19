-- Fase 6 (PIEZA B): modernizacion visual del catalogo de presets (ADR 0001,
-- 0009_design_catalog.sql).
--
-- Que cambia y que no: solo `colors` y `typography` de las 8 filas `platform`
-- sembradas en 0009. No se tocan `spacing`, `radius`, `dials`, `sections`,
-- `source`, `license` ni ninguna columna de 0016/0018/0019. No se crea ni se
-- borra ninguna fila: es un UPDATE aditivo sobre ids existentes, reversible a
-- mano si hiciera falta.
--
-- Por que: la comparacion con Airo (encargo del dueno) señalaba una paleta
-- apagada y una sola familia serif heredada sin acento vivo. Los colores
-- nuevos conservan el caracter de cada preset (editorial sigue siendo papel y
-- tinta; tech sigue siendo oscuro) pero con mas contraste de acento y, en
-- `tech`, un fondo oscuro realmente oscuro en vez de gris azulado.
--
-- Contraste (formula WCAG, misma que packages/linter/src/index.ts): los pares
-- ink/ground y accent/ground de las 8 filas superan 4.5:1 tras este cambio.
-- Verificado con el mismo calculo que usa el linter antes de escribir esta
-- migracion (no se repite aqui para no duplicar logica).
UPDATE design_styles SET
  colors = '{"ground":"#f7f7f2","ink":"#0f172a","accent":"#4f46e5"}',
  typography = '{"family":"Source Serif 4","scale":"large"}'
WHERE id = 'editorial' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#ffffff","ink":"#0b0b0c","accent":"#4f46e5"}',
  typography = '{"family":"Inter","scale":"normal"}'
WHERE id = 'minimal' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#fdf6ee","ink":"#2b1d17","accent":"#c2410c"}',
  typography = '{"family":"Fraunces","scale":"large"}'
WHERE id = 'warm' AND kind = 'preset';

-- `tech` pasa a un negro real (antes #0e1117, gris azulado) y a un acento
-- violeta en vez de menta: es el preset que mas se parecia a un dashboard
-- generico y el que mas necesitaba una identidad propia.
UPDATE design_styles SET
  colors = '{"ground":"#0b0b14","ink":"#f5f5f7","accent":"#8b5cf6"}',
  typography = '{"family":"Inter","scale":"normal"}'
WHERE id = 'tech' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#f4f4f6","ink":"#17161d","accent":"#6d28d9"}',
  typography = '{"family":"Space Grotesk","scale":"large"}'
WHERE id = 'studio' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#f8fafc","ink":"#0b1220","accent":"#1d4ed8"}',
  typography = '{"family":"Merriweather","scale":"normal"}'
WHERE id = 'trust' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#ffffff","ink":"#0d2a22","accent":"#15803d"}',
  typography = '{"family":"Nunito","scale":"normal"}'
WHERE id = 'fresh' AND kind = 'preset';

UPDATE design_styles SET
  colors = '{"ground":"#121212","ink":"#fafafa","accent":"#f5a524"}',
  typography = '{"family":"Archivo","scale":"xlarge"}'
WHERE id = 'bold' AND kind = 'preset';
