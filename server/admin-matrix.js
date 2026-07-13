import {
  ADMIN_ROLE_SLUG,
  PERMISSIONS,
  SUPER_ONLY_PERMISSIONS,
  SUPER_ROLE_SLUG,
  filterPermissionsForRoleSlug,
} from './admin-permissions.js';

/** Matrix column → permission mapping (keep in sync with services/adminMatrix.ts). */
export const MATRIX_COLUMNS = [
  {
    id: 'dashboard',
    label: '运营首页',
    kind: 'toggle',
    permissions: [PERMISSIONS.DASHBOARD_READ],
  },
  {
    id: 'systemStatus',
    label: '系统状态',
    kind: 'toggle',
    permissions: [PERMISSIONS.SYSTEM_STATUS_READ],
  },
  {
    id: 'users',
    label: '用户管理',
    kind: 'rw',
    read: PERMISSIONS.USERS_READ,
    write: PERMISSIONS.USERS_WRITE,
  },
  {
    id: 'usersRole',
    label: '成员邀请/改角色',
    kind: 'toggle',
    permissions: [PERMISSIONS.USERS_ROLE_WRITE],
    superOnly: true,
  },
  {
    id: 'usersReconcile',
    label: '用量同步',
    kind: 'toggle',
    permissions: [PERMISSIONS.USERS_RECONCILE],
  },
  {
    id: 'audit',
    label: '审计日志',
    kind: 'toggle',
    permissions: [PERMISSIONS.AUDIT_READ],
  },
  {
    id: 'taskEvents',
    label: '任务执行',
    kind: 'toggle',
    permissions: [PERMISSIONS.TASK_EVENTS_READ],
  },
  {
    id: 'usage',
    label: 'AI 用量',
    kind: 'toggle',
    permissions: [PERMISSIONS.USAGE_READ],
  },
  {
    id: 'credits',
    label: '积分发放',
    kind: 'toggle',
    permissions: [PERMISSIONS.CREDITS_WRITE],
  },
  {
    id: 'registrationInvites',
    label: '注册邀请码',
    kind: 'toggle',
    permissions: [PERMISSIONS.REGISTRATION_INVITES_WRITE],
  },
  {
    id: 'companion',
    label: '伴侣发行',
    kind: 'rw',
    read: PERMISSIONS.COMPANION_READ,
    write: PERMISSIONS.COMPANION_WRITE,
  },
  {
    id: 'companionDelete',
    label: '伴侣删除',
    kind: 'toggle',
    permissions: [PERMISSIONS.COMPANION_DELETE],
  },
  {
    id: 'geminiFairness',
    label: 'Gemini 限流',
    kind: 'rw',
    read: PERMISSIONS.GEMINI_FAIRNESS_READ,
    write: PERMISSIONS.GEMINI_FAIRNESS_WRITE,
  },
  {
    id: 'geminiStrict',
    label: '限流高危',
    kind: 'toggle',
    permissions: [PERMISSIONS.GEMINI_FAIRNESS_STRICT],
    superOnly: true,
  },
  {
    id: 'aiGatewayOps',
    label: 'AI Gateway Ops',
    kind: 'rw',
    read: PERMISSIONS.AI_GATEWAY_OPS_READ,
    write: PERMISSIONS.AI_GATEWAY_OPS_WRITE,
  },
  {
    id: 'presetsPublish',
    label: '能力预设发布',
    kind: 'toggle',
    permissions: [PERMISSIONS.PRESETS_PUBLISH],
    superOnly: true,
  },
  {
    id: 'roles',
    label: '角色与权限',
    kind: 'rw',
    read: PERMISSIONS.ROLES_READ,
    write: PERMISSIONS.ROLES_WRITE,
    superOnly: true,
  },
];

const RESERVED_ROLE_SLUGS = new Set(['super', 'admin', 'auditor', 'user']);

export function isReservedRoleSlug(slug) {
  return RESERVED_ROLE_SLUGS.has(String(slug || '').trim().toLowerCase());
}

function hasAll(perms, keys) {
  return keys.every((k) => perms.includes(k));
}

export function permissionsToMatrix(permissions, roleSlug) {
  const perms = filterPermissionsForRoleSlug(roleSlug, permissions);
  const out = {};
  for (const col of MATRIX_COLUMNS) {
    if (col.kind === 'toggle') {
      out[col.id] = hasAll(perms, col.permissions) ? 'yes' : 'none';
    } else if (col.kind === 'rw') {
      if (hasAll(perms, [col.read, col.write])) out[col.id] = 'write';
      else if (perms.includes(col.read)) out[col.id] = 'read';
      else out[col.id] = 'none';
    }
  }
  return out;
}

export function matrixToPermissions(matrix, roleSlug) {
  const m = matrix && typeof matrix === 'object' ? matrix : {};
  const set = new Set();
  for (const col of MATRIX_COLUMNS) {
    const v = m[col.id] ?? 'none';
    if (col.kind === 'toggle') {
      if (v === 'yes') col.permissions.forEach((p) => set.add(p));
    } else if (col.kind === 'rw') {
      if (v === 'read' || v === 'write') set.add(col.read);
      if (v === 'write') set.add(col.write);
    }
  }
  if (set.has(PERMISSIONS.USERS_WRITE) || set.has(PERMISSIONS.USERS_ROLE_WRITE)) {
    set.add(PERMISSIONS.USERS_READ);
  }
  if (set.has(PERMISSIONS.CREDITS_WRITE)) {
    set.add(PERMISSIONS.USERS_READ);
  }
  if (set.has(PERMISSIONS.REGISTRATION_INVITES_WRITE)) {
    set.add(PERMISSIONS.USERS_READ);
  }
  if (set.has(PERMISSIONS.ROLES_WRITE)) set.add(PERMISSIONS.ROLES_READ);
  return filterPermissionsForRoleSlug(roleSlug, [...set]);
}

export function normalizeMatrixInput(matrix, roleSlug) {
  const perms = matrixToPermissions(matrix, roleSlug);
  return permissionsToMatrix(perms, roleSlug);
}

export function assertMatrixEditable({ actorRoleSlug, targetRoleSlug }) {
  if (actorRoleSlug !== SUPER_ROLE_SLUG) {
    throw new Error('仅超级管理员可修改角色权限');
  }
  if (targetRoleSlug === SUPER_ROLE_SLUG) {
    throw new Error('超级管理员角色权限不可修改');
  }
}

export function validateCustomRoleSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(s)) {
    throw new Error('slug 须为 2～31 位小写字母/数字/下划线，且以字母开头');
  }
  if (isReservedRoleSlug(s)) throw new Error(`slug「${s}」为系统保留字`);
  return s;
}

/** Keep in sync with services/adminMatrix.ts AUDIT_ACTION_LABELS */
export const AUDIT_ACTION_LABELS = {
  'auth.login_failed': '登录失败',
  'auth.login': '登录成功',
  'auth.login_success': '登录成功',
  'auth.register': '注册',
  'auth.logout': '登出',
  'admin.user_update': '用户变更',
  'admin.credits_adjust': '积分调整',
  'admin.users_export': '用户 CSV 导出',
  'admin.role_create': '创建角色',
  'admin.role_delete': '删除角色',
  'admin.role_permissions_update': '角色权限变更',
  'admin.gemini_fairness_config_put': 'Gemini 限流保存',
  'admin.gemini_fairness_config_delete': 'Gemini 限流清空',
  'admin.ai_gateway_ops_control_put': 'AI Gateway Ops 保存',
  'admin.ai_gateway_ops_control_action': 'AI Gateway Ops 一键动作',
  'admin.ai_gateway_ops_control_delete': 'AI Gateway Ops 清空',
  'admin.companion_artifact_presign_put': '伴侣预签名上传',
  'admin.companion_artifact_register': '伴侣发行登记',
  'admin.companion_artifact_delete': '伴侣删除',
  'admin.workspace_usage_reconcile': '用量同步',
  'admin.capability_preset_publish': '能力预设发布',
  'admin.alert_webhook_update': '告警 Webhook 配置',
  'admin.staff_invite_create': '创建成员邀请',
  'admin.staff_invite_revoke': '撤销成员邀请',
  'admin.staff_invite_redeemed': '成员邀请核销',
  'admin.registration_invite_create': '创建注册邀请码',
  'admin.registration_invite_revoke': '撤销注册邀请码',
  'admin.price_catalog.create': '价目表新建版本',
  'admin.price_catalog.update': '价目表更新版本',
  'auth.registration_invite_redeemed': '注册邀请码核销',
  companion_artifact_download: '伴侣下载',
};

export function auditActionLabel(action) {
  return AUDIT_ACTION_LABELS[action] || action;
}

export { SUPER_ROLE_SLUG, ADMIN_ROLE_SLUG, SUPER_ONLY_PERMISSIONS };
