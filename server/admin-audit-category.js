/** Audit log UI categories — keep logic aligned with services/auditLogCategory.ts */

export const AUDIT_LOG_CATEGORIES = ['all', 'admin', 'auth', 'release'];

export function normalizeAuditCategory(raw) {
  const c = String(raw || 'all').trim().toLowerCase();
  return AUDIT_LOG_CATEGORIES.includes(c) ? c : 'all';
}

export function auditLogMatchesCategory(action, category) {
  const cat = normalizeAuditCategory(category);
  if (cat === 'all') return true;
  const a = String(action || '');
  if (cat === 'auth') return a.startsWith('auth.');
  if (cat === 'admin') {
    return (
      a.startsWith('admin.') &&
      !a.startsWith('admin.companion') &&
      !a.startsWith('admin.gemini') &&
      !a.startsWith('admin.capability')
    );
  }
  if (cat === 'release') {
    return (
      a.startsWith('admin.companion') ||
      a.startsWith('admin.gemini') ||
      a.startsWith('admin.capability') ||
      a.startsWith('companion_artifact')
    );
  }
  return true;
}

export function auditCategorySql(category, startParamIndex) {
  const cat = normalizeAuditCategory(category);
  if (cat === 'all') return null;
  let i = startParamIndex;
  if (cat === 'auth') {
    return { sql: `action LIKE $${i++}`, params: ['auth.%'] };
  }
  if (cat === 'admin') {
    return {
      sql: `action LIKE $${i++} AND action NOT LIKE $${i++} AND action NOT LIKE $${i++} AND action NOT LIKE $${i++}`,
      params: ['admin.%', 'admin.companion%', 'admin.gemini%', 'admin.capability%'],
    };
  }
  return {
    sql: `(action LIKE $${i++} OR action LIKE $${i++} OR action LIKE $${i++} OR action LIKE $${i++})`,
    params: ['admin.companion%', 'admin.gemini%', 'admin.capability%', 'companion_artifact%'],
  };
}

export function parseExcludeActions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
