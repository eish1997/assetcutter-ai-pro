/** Keep in sync with server/admin-audit-category.js */

export type AuditLogCategory = 'all' | 'admin' | 'auth' | 'release';

export const AUDIT_CATEGORY_TABS: Array<{ id: AuditLogCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'admin', label: '后台操作' },
  { id: 'auth', label: '认证' },
  { id: 'release', label: '发行/限流' },
];

export function auditLogMatchesCategory(action: string, category: AuditLogCategory): boolean {
  if (category === 'all') return true;
  const a = String(action || '');
  if (category === 'auth') return a.startsWith('auth.');
  if (category === 'admin') {
    return (
      a.startsWith('admin.') &&
      !a.startsWith('admin.companion') &&
      !a.startsWith('admin.gemini') &&
      !a.startsWith('admin.capability')
    );
  }
  if (category === 'release') {
    return (
      a.startsWith('admin.companion') ||
      a.startsWith('admin.gemini') ||
      a.startsWith('admin.capability') ||
      a.startsWith('companion_artifact')
    );
  }
  return true;
}

export function filterActionOptionsForCategory(
  entries: Array<[string, string]>,
  category: AuditLogCategory
): Array<{ value: string; label: string }> {
  const filtered = entries.filter(([value]) => auditLogMatchesCategory(value, category));
  return [{ value: '', label: '全部动作' }, ...filtered.map(([value, label]) => ({ value, label }))];
}
