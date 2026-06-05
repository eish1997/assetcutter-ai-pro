import { describe, expect, it } from 'vitest';
import { ADMIN_ROLE_SLUG, PERMISSIONS } from '../server/admin-permissions.js';
import { matrixToPermissions, permissionsToMatrix } from '../server/admin-matrix.js';

describe('admin-matrix', () => {
  it('用量同步 alone 不会隐式开启用户管理', () => {
    const perms = matrixToPermissions(
      { users: 'none', usersReconcile: 'yes' },
      ADMIN_ROLE_SLUG
    );
    expect(perms).toContain(PERMISSIONS.USERS_RECONCILE);
    expect(perms).not.toContain(PERMISSIONS.USERS_READ);
    expect(perms).not.toContain(PERMISSIONS.USERS_WRITE);

    const matrix = permissionsToMatrix(perms, ADMIN_ROLE_SLUG);
    expect(matrix.users).toBe('none');
    expect(matrix.usersReconcile).toBe('yes');
  });

  it('用户管理关闭后保存回显仍为 none', () => {
    const matrix = { users: 'none', usersReconcile: 'none', usersRole: 'none' };
    const perms = matrixToPermissions(matrix, ADMIN_ROLE_SLUG);
    const roundTrip = permissionsToMatrix(perms, ADMIN_ROLE_SLUG);
    expect(roundTrip.users).toBe('none');
  });

  it('伴侣删除 alone 不会隐式开启伴侣列表', () => {
    const perms = matrixToPermissions(
      { companion: 'none', companionDelete: 'yes' },
      ADMIN_ROLE_SLUG
    );
    expect(perms).toContain(PERMISSIONS.COMPANION_DELETE);
    expect(perms).not.toContain(PERMISSIONS.COMPANION_READ);
  });

  it('任务执行与审计日志可独立配置', () => {
    const perms = matrixToPermissions({ audit: 'yes', taskEvents: 'none' }, ADMIN_ROLE_SLUG);
    expect(perms).toContain(PERMISSIONS.AUDIT_READ);
    expect(perms).not.toContain(PERMISSIONS.TASK_EVENTS_READ);
  });

  it('系统状态与运营首页可独立配置', () => {
    const perms = matrixToPermissions({ dashboard: 'yes', systemStatus: 'none' }, ADMIN_ROLE_SLUG);
    expect(perms).toContain(PERMISSIONS.DASHBOARD_READ);
    expect(perms).not.toContain(PERMISSIONS.SYSTEM_STATUS_READ);
  });
});
