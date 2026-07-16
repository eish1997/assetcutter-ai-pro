-- Gemini fairness numeric overrides (R3 shared config for auth-api + AI Worker Proxy)

CREATE TABLE IF NOT EXISTS gemini_fairness_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_user_id TEXT NULL
);
