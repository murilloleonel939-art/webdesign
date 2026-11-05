-- Fase 1: sesiones de usuario. Sin esto no hay "crear" en el ciclo del editor:
-- toda operacion se ejecuta con un usuario concreto para RLS.

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Solo el hash del token; el token en claro nunca se guarda.
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_sessions_own ON user_sessions;
CREATE POLICY user_sessions_own ON user_sessions
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO app_platform;
