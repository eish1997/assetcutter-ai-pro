/** Keep in sync with server/admin-permissions.js */

/** Keep in sync with server/admin-permissions.js */
export const SUPER_ROLE_SLUG = 'super';
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
  AI_GATEWAY_OPS_READ: 'ai_gateway_ops.read',
  AI_GATEWAY_OPS_WRITE: 'ai_gateway_ops.write',
  AI_GATEWAY_KEYS_READ: 'ai_gateway_keys.read',
  AI_GATEWAY_KEYS_WRITE: 'ai_gateway_keys.write',
  PRESETS_PUBLISH: 'presets.publish',
  ROLES_READ: 'roles.read',
  ROLES_WRITE: 'roles.write',
  CREDITS_WRITE: 'credits.write',
  PRICING_WRITE: 'pricing.write',
  REGISTRATION_INVITES_WRITE: 'registration_invites.write',
} as const;

export type AdminPermission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ADMIN_NAV_GROUP_ORDER = [
  { id: 'overview', label: '' },
  { id: 'access', label: '准入' },
  { id: 'observe', label: '可观测' },
  { id: 'billing', label: '计费' },
  { id: 'ai_ops', label: 'AI 运维' },
  { id: 'content', label: '内容与发行' },
  { id: 'system', label: '系统' },
] as const;

export type AdminNavGroupId = (typeof ADMIN_NAV_GROUP_ORDER)[number]['id'];

export type AdminNavItem = {
  label: string;
  path: string;
  group: AdminNavGroupId;
  /** Single permission required to show this nav item */
  permission?: AdminPermission;
  /** Show if the staff has any of these permissions (e.g. invites) */
  anyOfPermissions?: readonly AdminPermission[];
};

export const GEMINI_FAIRNESS_STRICT_FIELD_KEYS = new Set([
  'GEMINI_FAIRNESS_STRICT',
  'GEMINI_FAIRNESS_HMAC_SKEW_SEC',
  'GEMINI_FAIRNESS_KEY_MAX_LEN',
]);

export function hasAdminPermission(permissions: readonly string[] | undefined, key: AdminPermission): boolean {
  if (!permissions?.length) return false;
  return permissions.includes(key);
}

export function canAccessAdminNavItem(
  can: (key: AdminPermission) => boolean,
  item: AdminNavItem
): boolean {
  if (item.anyOfPermissions?.length) {
    return item.anyOfPermissions.some((p) => can(p));
  }
  return item.permission ? can(item.permission) : false;
}

export function navItemMatchesPermission(
  item: AdminNavItem,
  permissions: readonly string[]
): boolean {
  if (item.anyOfPermissions?.length) {
    return item.anyOfPermissions.some((p) => hasAdminPermission(permissions, p));
  }
  return item.permission ? hasAdminPermission(permissions, item.permission) : false;
}

/** 积分发放：super 恒可；其余需 credits.write（兼容旧库未迁移权限） */
export function canGrantAdminCredits(
  permissions: readonly string[] | undefined,
  staffRoleSlug?: string | null
): boolean {
  if (staffRoleSlug === SUPER_ROLE_SLUG) return true;
  return hasAdminPermission(permissions, PERMISSIONS.CREDITS_WRITE);
}

/** 角色预览 / 无 Dashboard 权限时的首个可访问后台路径 */
export function resolveAdminLandingPath(permissions: readonly string[]): string {
  if (hasAdminPermission(permissions, PERMISSIONS.DASHBOARD_READ)) return '/admin';
  const first = ADMIN_NAV_ITEMS.find(
    (item) => item.path !== '/admin' && navItemMatchesPermission(item, permissions)
  );
  return first?.path ?? '/admin';
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { label: '首页', path: '/admin', permission: PERMISSIONS.DASHBOARD_READ, group: 'overview' },
  { label: '用户管理', path: '/admin/users', permission: PERMISSIONS.USERS_READ, group: 'access' },
  {
    label: '邀请',
    path: '/admin/invites',
    anyOfPermissions: [PERMISSIONS.USERS_ROLE_WRITE, PERMISSIONS.REGISTRATION_INVITES_WRITE],
    group: 'access',
  },
  { label: '角色与权限', path: '/admin/roles', permission: PERMISSIONS.ROLES_READ, group: 'access' },
  { label: '任务执行', path: '/admin/task-events', permission: PERMISSIONS.TASK_EVENTS_READ, group: 'observe' },
  { label: 'AI 任务', path: '/admin/ai-jobs', permission: PERMISSIONS.TASK_EVENTS_READ, group: 'observe' },
  { label: '审计日志', path: '/admin/audit-logs', permission: PERMISSIONS.AUDIT_READ, group: 'observe' },
  { label: 'AI 用量', path: '/admin/usage', permission: PERMISSIONS.USAGE_READ, group: 'billing' },
  { label: '价目表', path: '/admin/price-catalog', permission: PERMISSIONS.USAGE_READ, group: 'billing' },
  { label: '活动积分', path: '/admin/promo-credits', permission: PERMISSIONS.CREDITS_WRITE, group: 'billing' },
  {
    label: '供应商中心',
    path: '/admin/ai-provider-keys',
    permission: PERMISSIONS.AI_GATEWAY_KEYS_READ,
    group: 'ai_ops',
  },
  {
    label: 'Gemini 公平限流',
    path: '/admin/gemini-fairness',
    permission: PERMISSIONS.GEMINI_FAIRNESS_READ,
    group: 'ai_ops',
  },
  {
    label: '能力预设',
    path: '/admin/capability-presets',
    permission: PERMISSIONS.PRESETS_PUBLISH,
    group: 'content',
  },
  {
    label: '本地伴侣发行',
    path: '/admin/companion-artifacts',
    permission: PERMISSIONS.COMPANION_READ,
    group: 'content',
  },
  {
    label: '系统状态',
    path: '/admin/system-status',
    permission: PERMISSIONS.SYSTEM_STATUS_READ,
    group: 'system',
  },
];
