-- Fase 1: credencial de acceso. `hashPassword` guarda scrypt con sal, nunca la
-- contrasena. Forward-only: 0004 ya puede estar aplicada en produccion.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
