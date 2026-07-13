-- AI Gateway provider/model operations control shared config

CREATE TABLE IF NOT EXISTS ai_gateway_ops_control (
  id TEXT PRIMARY KEY DEFAULT 'default',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_user_id TEXT NULL
);

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'ai_gateway_ops.read'
FROM admin_roles
WHERE slug IN ('super', 'admin', 'auditor')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT id, 'ai_gateway_ops.write'
FROM admin_roles
WHERE slug IN ('super', 'admin')
ON CONFLICT DO NOTHING;
