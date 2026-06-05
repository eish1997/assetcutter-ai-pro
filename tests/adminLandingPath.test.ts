import { describe, expect, it } from 'vitest';
import { PERMISSIONS, resolveAdminLandingPath } from '../services/adminPermissions';

describe('resolveAdminLandingPath', () => {
  it('有 dashboard.read 时落在 /admin', () => {
    expect(resolveAdminLandingPath([PERMISSIONS.DASHBOARD_READ, PERMISSIONS.AUDIT_READ])).toBe('/admin');
  });

  it('auditor 仅有 users.read + audit.read 时落在首个可访问页（用户管理）', () => {
    expect(resolveAdminLandingPath([PERMISSIONS.USERS_READ, PERMISSIONS.AUDIT_READ])).toBe('/admin/users');
  });

  it('仅有 users.read 时落在用户页', () => {
    expect(resolveAdminLandingPath([PERMISSIONS.USERS_READ])).toBe('/admin/users');
  });
});
