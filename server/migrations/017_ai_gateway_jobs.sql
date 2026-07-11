-- AI Gateway jobs: durable task plan records before worker execution.

CREATE TABLE IF NOT EXISTS ai_gateway_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  modality TEXT NOT NULL,
  capability TEXT NOT NULL,
  provider TEXT NULL,
  model TEXT NULL,
  correlation_id TEXT NOT NULL,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  adapter_request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_user_created ON ai_gateway_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_status_updated ON ai_gateway_jobs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_jobs_correlation ON ai_gateway_jobs(correlation_id);
