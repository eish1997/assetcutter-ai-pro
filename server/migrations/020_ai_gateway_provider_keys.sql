-- AI Gateway provider key pool for server-side worker adapters.

CREATE TABLE IF NOT EXISTS ai_gateway_provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100,
  rpm INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_user_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_gateway_provider_keys_provider
  ON ai_gateway_provider_keys(provider, enabled, priority);

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'ai_gateway_keys.read'
FROM admin_roles
WHERE slug IN ('super', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'ai_gateway_keys.write'
FROM admin_roles
WHERE slug IN ('super', 'admin')
ON CONFLICT DO NOTHING;
