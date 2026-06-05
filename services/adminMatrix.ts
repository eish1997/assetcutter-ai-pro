/** Matrix column ids — keep in sync with server/admin-matrix.js */

export type MatrixCellValue = 'none' | 'read' | 'write' | 'yes';

export const SUPER_ROLE_SLUG = 'super';

export const SUPER_ONLY_PERMISSIONS = new Set([
  'users.role.write',
  'roles.read',
  'roles.write',
  'gemini_fairness.strict',
  'presets.publish',
]);

const ALL_PERMISSION_VALUES = [
  'dashboard.read',
  'users.read',
  'users.write',
  'users.role.write',
  'users.reconcile',
  'audit.read',
  'companion.read',
  'companion.write',
  'companion.delete',
  'gemini_fairness.read',
  'gemini_fairness.write',
  'gemini_fairness.strict',
  'presets.publish',
  'roles.read',
  'roles.write',
] as const;

export type MatrixColumnDef = {
  id: MatrixColumnId;
  label: string;
  kind: 'toggle' | 'rw';
  permissions?: string[];
  read?: string;
  write?: string;
  superOnly?: boolean;
};

/** 与 server/admin-matrix.js MATRIX_COLUMNS 同步 */
export const MATRIX_COLUMN_DEFS: MatrixColumnDef[] = [
  { id: 'dashboard', label: 'Dashboard', kind: 'toggle', permissions: ['dashboard.read'] },
  { id: 'users', label: '用户管理', kind: 'rw', read: 'users.read', write: 'users.write' },
  { id: 'usersRole', label: '改用户角色', kind: 'toggle', permissions: ['users.role.write'], superOnly: true },
  { id: 'usersReconcile', label: '用量同步', kind: 'toggle', permissions: ['users.reconcile'] },
  { id: 'audit', label: '审计', kind: 'toggle', permissions: ['audit.read'] },
  { id: 'companion', label: '伴侣发行', kind: 'rw', read: 'companion.read', write: 'companion.write' },
  { id: 'companionDelete', label: '伴侣删除', kind: 'toggle', permissions: ['companion.delete'] },
  {
    id: 'geminiFairness',
    label: 'Gemini 限流',
    kind: 'rw',
    read: 'gemini_fairness.read',
    write: 'gemini_fairness.write',
  },
  {
    id: 'geminiStrict',
    label: '限流高危',
    kind: 'toggle',
    permissions: ['gemini_fairness.strict'],
    superOnly: true,
  },
  { id: 'presetsPublish', label: '能力预设发布', kind: 'toggle', permissions: ['presets.publish'], superOnly: true },
  { id: 'roles', label: '角色与权限', kind: 'rw', read: 'roles.read', write: 'roles.write', superOnly: true },
];

export const PERMISSION_LABELS: Record<string, string> = {
  'dashboard.read': 'Dashboard 查看',
  'users.read': '用户列表查看',
  'users.write': '用户状态/配额修改',
  'users.role.write': '指定用户后台角色',
  'users.reconcile': 'R2 用量同步',
  'audit.read': '审计日志查看',
  'companion.read': '伴侣发行列表',
  'companion.write': '伴侣发行登记/上传',
  'companion.delete': '伴侣发行删除',
  'gemini_fairness.read': 'Gemini 限流查看',
  'gemini_fairness.write': 'Gemini 限流修改',
  'gemini_fairness.strict': 'Gemini 限流高危字段',
  'presets.publish': '能力预设发布',
  'roles.read': '角色矩阵查看',
  'roles.write': '角色矩阵编辑',
};

export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] || key;
}

export function filterPermissionsForRoleSlug(slug: string, permissions: string[]): string[] {
  const list = permissions.filter((p) => (ALL_PERMISSION_VALUES as readonly string[]).includes(p));
  if (slug === SUPER_ROLE_SLUG) return [...new Set(list)];
  return [...new Set(list.filter((p) => !SUPER_ONLY_PERMISSIONS.has(p)))];
}

/** 与 server/admin-matrix.js matrixToPermissions 同步 */
export function matrixToPermissions(matrix: Record<string, MatrixCellValue>, roleSlug: string): string[] {
  const set = new Set<string>();
  for (const col of MATRIX_COLUMN_DEFS) {
    const v = matrix[col.id] ?? 'none';
    if (col.kind === 'toggle') {
      if (v === 'yes') col.permissions?.forEach((p) => set.add(p));
    } else if (col.kind === 'rw') {
      if (v === 'read' || v === 'write') {
        if (col.read) set.add(col.read);
      }
      if (v === 'write' && col.write) set.add(col.write);
    }
  }
  if (set.has('users.write') || set.has('users.role.write') || set.has('users.reconcile')) {
    set.add('users.read');
  }
  if (set.has('companion.write') || set.has('companion.delete')) set.add('companion.read');
  if (set.has('gemini_fairness.write') || set.has('gemini_fairness.strict')) {
    set.add('gemini_fairness.read');
  }
  if (set.has('roles.write')) set.add('roles.read');
  return filterPermissionsForRoleSlug(roleSlug, [...set]);
}

export const MATRIX_COLUMN_IDS = [
  'dashboard',
  'users',
  'usersRole',
  'usersReconcile',
  'audit',
  'companion',
  'companionDelete',
  'geminiFairness',
  'geminiStrict',
  'presetsPublish',
  'roles',
] as const;

export type MatrixColumnId = (typeof MATRIX_COLUMN_IDS)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login_failed': '登录失败',
  'auth.login': '登录成功',
  'auth.login_success': '登录成功',
  'auth.register': '注册',
  'auth.logout': '登出',
  'admin.user_update': '用户变更',
  'admin.users_export': '用户 CSV 导出',
  'admin.role_create': '创建角色',
  'admin.role_delete': '删除角色',
  'admin.role_permissions_update': '角色权限变更',
  'admin.gemini_fairness_config_put': 'Gemini 限流保存',
  'admin.gemini_fairness_config_delete': 'Gemini 限流清空',
  'admin.companion_artifact_presign_put': '伴侣预签名上传',
  'admin.companion_artifact_register': '伴侣发行登记',
  'admin.companion_artifact_delete': '伴侣删除',
  'admin.workspace_usage_reconcile': '用量同步',
  'admin.capability_preset_publish': '能力预设发布',
  'admin.alert_webhook_update': '告警 Webhook 配置',
  'admin.staff_invite_create': '创建成员邀请',
  'admin.staff_invite_revoke': '撤销成员邀请',
  'admin.staff_invite_redeemed': '成员邀请核销',
  'companion_artifact_download': '伴侣下载',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

export function nextRwCell(current: MatrixCellValue): MatrixCellValue {
  if (current === 'none') return 'read';
  if (current === 'read') return 'write';
  return 'none';
}

export function nextToggleCell(current: MatrixCellValue): MatrixCellValue {
  return current === 'yes' ? 'none' : 'yes';
}

export function cellLabel(kind: 'toggle' | 'rw', value: MatrixCellValue): string {
  if (kind === 'toggle') return value === 'yes' ? '是' : '—';
  if (value === 'write') return '读写';
  if (value === 'read') return '只读';
  return '—';
}
