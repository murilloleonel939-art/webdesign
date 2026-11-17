-- Fase 4: ejecuciones del agente, llamadas a herramientas, tokens temporales y
-- consumo de IA. Forward-only. Todo en una transaccion (el runner la abre).
--
-- Spec 7.3 y 14.1: `agent_runs` y `agent_tool_calls` guardan metadatos y hashes,
-- nunca el prompt completo, y se purgan a los 90 dias. `usage_events` dura 12
-- meses. `audit_log` (3 anos) ya existe desde la Fase 1.

-- Una ejecucion del agente: quien, sobre que sitio, con que modelo y por que paro.
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  agent_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'ok', 'budget_exhausted', 'error', 'cancelled')),
  model text,
  -- Tope de tokens fijado al arrancar: si cambia la configuracion a mitad de
  -- ejecucion, la que manda es esta. Es lo que hace el presupuesto auditable.
  prompt_tokens_max integer NOT NULL CHECK (prompt_tokens_max >= 0),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  -- Motivo del final en texto legible para el dueno, no un codigo interno.
  stop_reason text,
  trace_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

-- Cada llamada a herramienta. `input_hash` en vez del input: el hash basta para
-- correlacionar y no guarda datos del dueno.
CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool text NOT NULL,
  input_hash text NOT NULL,
  ok boolean NOT NULL,
  error_code text,
  ms integer NOT NULL CHECK (ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Tokens temporales con presupuesto. El `jti` es la clave: permite revocar uno
-- sin tocar los demas. `scopes` es el array de permisos concedidos.
CREATE TABLE IF NOT EXISTS agent_tokens (
  jti uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Consumo de proveedores de LLM. Sin claves: solo el hecho del consumo.
CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  -- Referencias opcionales: un evento puede no venir de una ejecucion de agente
  -- (por ejemplo, una generacion suelta desde el panel).
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  -- Resultado tal como lo clasifica `llm-gateway`, no como lo narra el modelo.
  outcome text NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'refused', 'timeout', 'invalid_tool', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Checkpoints del borrador: el agente puede crear y revertir (spec 9.1), y sin
-- ellos una edicion larga no tiene vuelta atras.
CREATE TABLE IF NOT EXISTS draft_checkpoints (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  label text NOT NULL,
  doc jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indices por lo que se consulta de verdad: ejecuciones por sitio, llamadas por
-- ejecucion, tokens vigentes y consumo por usuario y mes.
CREATE INDEX IF NOT EXISTS agent_runs_site_idx ON agent_runs (site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_user_idx ON agent_runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_tool_calls_run_idx ON agent_tool_calls (run_id, created_at);
CREATE INDEX IF NOT EXISTS agent_tokens_run_idx ON agent_tokens (run_id);
CREATE INDEX IF NOT EXISTS agent_tokens_expiry_idx ON agent_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS usage_events_user_month_idx ON usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draft_checkpoints_site_idx ON draft_checkpoints (site_id, created_at DESC);

-- RLS forzado: el agente escribe en nombre del dueno, con `withUser`.
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE draft_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_checkpoints FORCE ROW LEVEL SECURITY;

-- Una ejecucion pertenece a su usuario.
DROP POLICY IF EXISTS agent_runs_owner ON agent_runs;
CREATE POLICY agent_runs_owner ON agent_runs
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Las llamadas heredan el dueno de su ejecucion: no tienen columna propia.
DROP POLICY IF EXISTS agent_tool_calls_owner ON agent_tool_calls;
CREATE POLICY agent_tool_calls_owner ON agent_tool_calls
  USING (EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = agent_tool_calls.run_id
                 AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = agent_tool_calls.run_id
                 AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

DROP POLICY IF EXISTS agent_tokens_owner ON agent_tokens;
CREATE POLICY agent_tokens_owner ON agent_tokens
  USING (EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = agent_tokens.run_id
                 AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = agent_tokens.run_id
                 AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

-- El consumo puede no tener usuario (evento del sistema): esas filas solo las
-- ve el rol de migracion, que es lo correcto.
DROP POLICY IF EXISTS usage_events_owner ON usage_events;
CREATE POLICY usage_events_owner ON usage_events
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id IS NULL OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS draft_checkpoints_owner ON draft_checkpoints;
CREATE POLICY draft_checkpoints_owner ON draft_checkpoints
  USING (EXISTS (SELECT 1 FROM sites s WHERE s.id = draft_checkpoints.site_id
                 AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sites s WHERE s.id = draft_checkpoints.site_id
                 AND s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
