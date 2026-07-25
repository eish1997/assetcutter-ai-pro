import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUP_ORDER,
  ADMIN_NAV_ITEMS,
  PERMISSIONS,
  canAccessAdminNavItem,
  resolveAdminLandingPath,
} from '../services/adminPermissions';

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

  it('仅有 task_events.read 时可落到任务执行页', () => {
    expect(resolveAdminLandingPath([PERMISSIONS.TASK_EVENTS_READ])).toBe('/admin/task-events');
  });

  it('仅有 registration_invites.write 时可落到邀请页', () => {
    expect(resolveAdminLandingPath([PERMISSIONS.REGISTRATION_INVITES_WRITE])).toBe('/admin/invites');
  });
});

describe('admin nav groups', () => {
  it('侧栏项均挂在已知分组上', () => {
    const groupIds = new Set(ADMIN_NAV_GROUP_ORDER.map((g) => g.id));
    for (const item of ADMIN_NAV_ITEMS) {
      expect(groupIds.has(item.group)).toBe(true);
    }
  });

  it('邀请入口在任一邀请权限下可见', () => {
    const invites = ADMIN_NAV_ITEMS.find((item) => item.path === '/admin/invites');
    expect(invites).toBeTruthy();
    const can = (key: string) => key === PERMISSIONS.REGISTRATION_INVITES_WRITE;
    expect(canAccessAdminNavItem(can as never, invites!)).toBe(true);
    expect(canAccessAdminNavItem((() => false) as never, invites!)).toBe(false);
  });
});
