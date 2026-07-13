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
  'task_events.read',
  'usage.read',
  'system_status.read',
  'companion.read',
  'companion.write',
  'companion.delete',
  'gemini_fairness.read',
  'gemini_fairness.write',
  'gemini_fairness.strict',
  'ai_gateway_ops.read',
  'ai_gateway_ops.write',
  'ai_gateway_keys.read',
  'ai_gateway_keys.write',
  'presets.publish',
  'roles.read',
  'roles.write',
  'credits.write',
  'registration_invites.write',
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
  { id: 'dashboard', label: '运营首页', kind: 'toggle', permissions: ['dashboard.read'] },
  { id: 'systemStatus', label: '系统状态', kind: 'toggle', permissions: ['system_status.read'] },
  { id: 'users', label: '用户管理', kind: 'rw', read: 'users.read', write: 'users.write' },
  { id: 'usersRole', label: '成员邀请/改角色', kind: 'toggle', permissions: ['users.role.write'], superOnly: true },
  { id: 'usersReconcile', label: '用量同步', kind: 'toggle', permissions: ['users.reconcile'] },
  { id: 'audit', label: '审计日志', kind: 'toggle', permissions: ['audit.read'] },
  { id: 'taskEvents', label: '任务执行', kind: 'toggle', permissions: ['task_events.read'] },
  { id: 'usage', label: 'AI 用量', kind: 'toggle', permissions: ['usage.read'] },
  { id: 'credits', label: '积分发放', kind: 'toggle', permissions: ['credits.write'] },
  { id: 'registrationInvites', label: '注册邀请码', kind: 'toggle', permissions: ['registration_invites.write'] },
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
  {
    id: 'aiGatewayOps',
    label: 'AI Gateway Ops',
    kind: 'rw',
    read: 'ai_gateway_ops.read',
    write: 'ai_gateway_ops.write',
  },
  {
    id: 'aiGatewayKeys',
    label: 'AI Gateway Keys',
    kind: 'rw',
    read: 'ai_gateway_keys.read',
    write: 'ai_gateway_keys.write',
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
  'task_events.read': '任务执行查看',
  'usage.read': 'AI 用量查看',
  'system_status.read': '系统状态查看',
  'companion.read': '伴侣发行列表',
  'companion.write': '伴侣发行登记/上传',
  'companion.delete': '伴侣发行删除',
  'gemini_fairness.read': 'Gemini 限流查看',
  'gemini_fairness.write': 'Gemini 限流修改',
  'gemini_fairness.strict': 'Gemini 限流高危字段',
  'ai_gateway_ops.read': 'AI Gateway Ops 查看',
  'ai_gateway_ops.write': 'AI Gateway Ops 修改',
  'ai_gateway_keys.read': 'AI Gateway Keys 查看',
  'ai_gateway_keys.write': 'AI Gateway Keys 修改',
  'presets.publish': '能力预设发布',
  'roles.read': '角色矩阵查看',
  'roles.write': '角色矩阵编辑',
  'credits.write': '积分发放/扣回',
  'registration_invites.write': '注册邀请码管理',
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
  if (set.has('users.write') || set.has('users.role.write')) {
    set.add('users.read');
  }
  if (set.has('credits.write')) {
    set.add('users.read');
  }
  if (set.has('registration_invites.write')) {
    set.add('users.read');
  }
  if (set.has('roles.write')) set.add('roles.read');
  return filterPermissionsForRoleSlug(roleSlug, [...set]);
}

export const MATRIX_COLUMN_IDS = [
  'dashboard',
  'systemStatus',
  'users',
  'usersRole',
  'usersReconcile',
  'audit',
  'taskEvents',
  'usage',
  'credits',
  'registrationInvites',
  'companion',
  'companionDelete',
  'geminiFairness',
  'geminiStrict',
  'aiGatewayOps',
  'aiGatewayKeys',
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
  'admin.ai_gateway_provider_keys_put': 'AI Gateway Keys 保存',
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
  'auth.registration_invite_redeemed': '注册邀请码核销',
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
