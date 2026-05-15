-- Script Hub：脚本与版本（与 users 表同库；由 script-hub-api 启动时 IF NOT EXISTS 对齐或手工执行）

CREATE TABLE IF NOT EXISTS script_hub_scripts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL CHECK (target_type IN ('maya', 'unreal')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public', 'unlisted')),
  current_revision_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, slug)
);

CREATE TABLE IF NOT EXISTS script_hub_revisions (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  entrypoint TEXT NOT NULL DEFAULT 'run',
  schema_json JSONB NOT NULL,
  content_body TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content_byte_size INT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (script_id, version)
);

CREATE INDEX IF NOT EXISTS idx_script_hub_scripts_owner ON script_hub_scripts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_script_hub_revisions_script ON script_hub_revisions(script_id);
