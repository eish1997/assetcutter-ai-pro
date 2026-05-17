-- Script Hub：用户级偏好（上次参数、Maya 连接等，按账号云同步）
CREATE TABLE IF NOT EXISTS script_hub_user_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs_json JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
