-- AI Gateway job lifecycle fields for status write-back and later settlement.

ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS output_json JSONB NULL;
ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS artifacts_json JSONB NULL;
ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL;
ALTER TABLE ai_gateway_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;

