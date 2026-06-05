-- 工作流任务执行审计（客户端 append-only 上报，管理端只读）
CREATE TABLE IF NOT EXISTS workflow_task_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts BIGINT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  asset_id TEXT,
  task_id TEXT,
  display_key TEXT,
  detail_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_task_events_user_ts ON workflow_task_events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_task_events_ts ON workflow_task_events(ts DESC, id DESC);
