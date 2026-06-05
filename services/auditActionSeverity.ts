export type AuditActionSeverity = 'danger' | 'warn' | 'neutral';

const DANGER = new Set([
  'admin.role_delete',
  'admin.companion_artifact_delete',
  'admin.gemini_fairness_config_delete',
]);

const WARN = new Set([
  'admin.user_update',
  'admin.role_permissions_update',
  'admin.role_create',
  'admin.gemini_fairness_config_put',
  'admin.companion_artifact_register',
  'admin.companion_artifact_presign_put',
  'admin.capability_preset_publish',
  'admin.workspace_usage_reconcile',
]);

export function auditActionSeverity(action: string): AuditActionSeverity {
  if (DANGER.has(action)) return 'danger';
  if (WARN.has(action)) return 'warn';
  if (action === 'auth.login_failed') return 'warn';
  return 'neutral';
}

export const AUDIT_SEVERITY_DOT: Record<AuditActionSeverity, string> = {
  danger: 'bg-red-400',
  warn: 'bg-amber-400',
  neutral: 'bg-gray-500',
};

export const LOGIN_SUCCESS_ACTIONS = ['auth.login_success', 'auth.login'] as const;

export function loginSuccessExcludeParam(): string {
  return LOGIN_SUCCESS_ACTIONS.join(',');
}
