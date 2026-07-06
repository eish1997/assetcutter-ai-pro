/** Admin RBAC permission keys — keep in sync with services/adminPermissions.ts */

export const SUPER_ROLE_SLUG = 'super';
export const ADMIN_ROLE_SLUG = 'admin';
export const AUDITOR_ROLE_SLUG = 'auditor';

export const PERMISSIONS = Object.freeze({
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
  CREDITS_WRITE: 'credits.write',
  REGISTRATION_INVITES_WRITE: 'registration_invites.write',
});

const ALL_PERMISSION_VALUES = Object.values(PERMISSIONS);

/** Cannot be granted to non-super roles (enforced on read and on future matrix writes). */
export const SUPER_ONLY_PERMISSIONS = new Set([
  PERMISSIONS.USERS_ROLE_WRITE,
  PERMISSIONS.ROLES_READ,
  PERMISSIONS.ROLES_WRITE,
  PERMISSIONS.GEMINI_FAIRNESS_STRICT,
  PERMISSIONS.PRESETS_PUBLISH,
]);

export const GEMINI_FAIRNESS_STRICT_CONFIG_KEYS = new Set([
  'GEMINI_FAIRNESS_STRICT',
  'GEMINI_FAIRNESS_HMAC_SKEW_SEC',
  'GEMINI_FAIRNESS_KEY_MAX_LEN',
]);

export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  [SUPER_ROLE_SLUG]: ALL_PERMISSION_VALUES,
  [ADMIN_ROLE_SLUG]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.USERS_RECONCILE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.TASK_EVENTS_READ,
    PERMISSIONS.USAGE_READ,
    PERMISSIONS.SYSTEM_STATUS_READ,
    PERMISSIONS.COMPANION_READ,
    PERMISSIONS.COMPANION_WRITE,
    PERMISSIONS.COMPANION_DELETE,
    PERMISSIONS.GEMINI_FAIRNESS_READ,
    PERMISSIONS.GEMINI_FAIRNESS_WRITE,
    PERMISSIONS.CREDITS_WRITE,
    PERMISSIONS.REGISTRATION_INVITES_WRITE,
  ],
  [AUDITOR_ROLE_SLUG]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.TASK_EVENTS_READ,
    PERMISSIONS.USAGE_READ,
  ],
});

export function hasPermission(permissions, key) {
  if (!key || !Array.isArray(permissions)) return false;
  return permissions.includes(key);
}

/** Strip super-only keys unless role slug is super. */
export function filterPermissionsForRoleSlug(slug, permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  if (slug === SUPER_ROLE_SLUG) return [...new Set(list.filter((p) => ALL_PERMISSION_VALUES.includes(p)))];
  return [...new Set(list.filter((p) => ALL_PERMISSION_VALUES.includes(p) && !SUPER_ONLY_PERMISSIONS.has(p)))];
}

export function isSuperOnlyPermission(key) {
  return SUPER_ONLY_PERMISSIONS.has(key);
}
