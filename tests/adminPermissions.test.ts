import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLE_SLUG,
  AUDITOR_ROLE_SLUG,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  SUPER_ONLY_PERMISSIONS,
  SUPER_ROLE_SLUG,
  filterPermissionsForRoleSlug,
  hasPermission,
} from '../server/admin-permissions.js';
import { matrixToPermissions } from '../server/admin-matrix.js';

describe('admin-permissions', () => {
  it('super 默认包含全部权限', () => {
    expect(DEFAULT_ROLE_PERMISSIONS[SUPER_ROLE_SLUG]).toContain(PERMISSIONS.USERS_ROLE_WRITE);
    expect(DEFAULT_ROLE_PERMISSIONS[SUPER_ROLE_SLUG]).toContain(PERMISSIONS.ROLES_WRITE);
    expect(DEFAULT_ROLE_PERMISSIONS[SUPER_ROLE_SLUG]).toContain(PERMISSIONS.PRESETS_PUBLISH);
  });

  it('admin 默认不含 super-only 权限', () => {
    const adminPerms = DEFAULT_ROLE_PERMISSIONS[ADMIN_ROLE_SLUG];
    for (const key of SUPER_ONLY_PERMISSIONS) {
      expect(adminPerms).not.toContain(key);
    }
    expect(adminPerms).toContain(PERMISSIONS.USERS_WRITE);
    expect(adminPerms).toContain(PERMISSIONS.COMPANION_DELETE);
    expect(adminPerms).toContain(PERMISSIONS.AI_GATEWAY_OPS_READ);
    expect(adminPerms).toContain(PERMISSIONS.AI_GATEWAY_OPS_WRITE);
    expect(DEFAULT_ROLE_PERMISSIONS[AUDITOR_ROLE_SLUG]).toContain(PERMISSIONS.AI_GATEWAY_OPS_READ);
    expect(DEFAULT_ROLE_PERMISSIONS[AUDITOR_ROLE_SLUG]).not.toContain(PERMISSIONS.AI_GATEWAY_OPS_WRITE);
  });

  it('filterPermissionsForRoleSlug 会剥离非 super 的 super-only 键', () => {
    const raw = [...DEFAULT_ROLE_PERMISSIONS[ADMIN_ROLE_SLUG], PERMISSIONS.USERS_ROLE_WRITE];
    const filtered = filterPermissionsForRoleSlug(ADMIN_ROLE_SLUG, raw);
    expect(filtered).not.toContain(PERMISSIONS.USERS_ROLE_WRITE);
    expect(filtered).toContain(PERMISSIONS.USERS_READ);
  });

  it('hasPermission 按 key 判断', () => {
    expect(hasPermission([PERMISSIONS.AUDIT_READ], PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(hasPermission([PERMISSIONS.AUDIT_READ], PERMISSIONS.USERS_WRITE)).toBe(false);
  });

  it('matrixToPermissions 会剔除 admin 角色的 super-only 列', () => {
    const perms = matrixToPermissions(
      {
        usersRole: 'yes',
        geminiStrict: 'yes',
        presetsPublish: 'yes',
        roles: 'write',
      },
      ADMIN_ROLE_SLUG
    );
    for (const key of SUPER_ONLY_PERMISSIONS) {
      expect(perms).not.toContain(key);
    }
    expect(perms).toContain(PERMISSIONS.USERS_READ);
  });
});
