-- Admin RBAC: staff roles + permissions (Round 1)

CREATE TABLE IF NOT EXISTS admin_roles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_key ON role_permissions(permission_key);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS staff_role_id TEXT REFERENCES admin_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_staff_role_id ON users(staff_role_id);
