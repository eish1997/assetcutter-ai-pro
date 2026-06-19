-- Usage billing: append-only events + versioned price catalog (Phase 0)

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NULL,
  project_id TEXT NULL,
  workflow_step_id TEXT NULL,
  audit_log_id TEXT NULL,
  provider TEXT NOT NULL,
  registry_id TEXT NULL,
  billing_sku TEXT NOT NULL,
  meter_kind TEXT NOT NULL CHECK (meter_kind IN ('token', 'image', 'second', 'task', 'byte')),
  quantity_in NUMERIC NULL,
  quantity_out NUMERIC NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  cost_usd_est NUMERIC NULL,
  cost_confidence TEXT NOT NULL DEFAULT 'unknown'
    CHECK (cost_confidence IN ('exact', 'estimated', 'unknown')),
  status TEXT NOT NULL DEFAULT 'succeeded'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  upstream_task_id TEXT NULL,
  request_id TEXT NULL,
  job_kind TEXT NULL,
  meta_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_billing_sku_created ON usage_events(billing_sku, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_upstream_task ON usage_events(upstream_task_id) WHERE upstream_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS price_catalog (
  billing_sku TEXT NOT NULL,
  meter_kind TEXT NOT NULL,
  input_per_1m NUMERIC NULL,
  output_per_1m NUMERIC NULL,
  per_unit NUMERIC NULL,
  vendor_sku_ref TEXT NULL,
  display_name TEXT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  markup_pct NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (billing_sku, effective_from)
);
