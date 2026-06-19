/** Keep in sync with server/admin-permissions.js */

/** Keep in sync with server/admin-permissions.js */
export const AUDITOR_ROLE_SLUG = 'auditor';

export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  USERS_ROLE_WRITE: 'users.role.write',
  USERS_RECONCILE: 'users.reconcile',
  AUDIT_READ: 'audit.read',
  TASK_EVENTS_READ: 'task_events.read',
  USAGE_READ: 'usage.read',
  SYSTEM_STATUS_READ: 'system_status.read',
  COMPANION_READ: 'companion.read',
  COMPANION_WRITE: 'companion.write',
  COMPANION_DELETE: 'companion.delete',
  GEMINI_FAIRNESS_READ: 'gemini_fairness.read',
  GEMINI_FAIRNESS_WRITE: 'gemini_fairness.write',
  GEMINI_FAIRNESS_STRICT: 'gemini_fairness.strict',
  PRESETS_PUBLISH: 'presets.publish',
  ROLES_READ: 'roles.read',
  ROLES_WRITE: 'roles.write',
} as const;

export type AdminPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const GEMINI_FAIRNESS_STRICT_FIELD_KEYS = new Set([
  'GEMINI_FAIRNESS_STRICT',
  'GEMINI_FAIRNESS_HMAC_SKEW_SEC',
  'GEMINI_FAIRNESS_KEY_MAX_LEN',
]);

export function hasAdminPermission(permissions: readonly string[] | undefined, key: AdminPermission): boolean {
  if (!permissions?.length) return false;
  return permissions.includes(key);
}

/** 角色预览 / 无 Dashboard 权限时的首个可访问后台路径 */
export function resolveAdminLandingPath(permissions: readonly string[]): string {
  if (hasAdminPermission(permissions, PERMISSIONS.DASHBOARD_READ)) return '/admin';
  const first = ADMIN_NAV_ITEMS.find(
    (item) => item.path !== '/admin' && hasAdminPermission(permissions, item.permission)
  );
  return first?.path ?? '/admin';
}

export const ADMIN_NAV_ITEMS = [
  { label: '首页', path: '/admin', permission: PERMISSIONS.DASHBOARD_READ },
  { label: '用户管理', path: '/admin/users', permission: PERMISSIONS.USERS_READ },
  { label: '审计日志', path: '/admin/audit-logs', permission: PERMISSIONS.AUDIT_READ },
  { label: '任务执行', path: '/admin/task-events', permission: PERMISSIONS.TASK_EVENTS_READ },
  { label: 'AI 用量', path: '/admin/usage', permission: PERMISSIONS.USAGE_READ },
  { label: '能力预设', path: '/admin/capability-presets', permission: PERMISSIONS.PRESETS_PUBLISH },
  { label: '系统状态', path: '/admin/system-status', permission: PERMISSIONS.SYSTEM_STATUS_READ },
  { label: '成员邀请', path: '/admin/staff-invites', permission: PERMISSIONS.USERS_ROLE_WRITE },
  { label: '本地伴侣发行', path: '/admin/companion-artifacts', permission: PERMISSIONS.COMPANION_READ },
  { label: 'Gemini 公平限流', path: '/admin/gemini-fairness', permission: PERMISSIONS.GEMINI_FAIRNESS_READ },
  { label: '角色与权限', path: '/admin/roles', permission: PERMISSIONS.ROLES_READ },
] as const;
