-- Script Hub：本机/云端执行 Run 记录（MVP，与规格 §5.1 script_hub_runs 对齐）

CREATE TABLE IF NOT EXISTS script_hub_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  script_id TEXT NOT NULL REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  params_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  companion_job_id TEXT,
  exit_code INT,
  error_code TEXT,
  error_message TEXT,
  log_excerpt TEXT,
  duration_ms INT,
  client TEXT NOT NULL DEFAULT 'script-hub-web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_script_hub_runs_user_created ON script_hub_runs(user_id, created_at DESC);
