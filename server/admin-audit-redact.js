import { AUDITOR_ROLE_SLUG } from './admin-permissions.js';

const SENSITIVE_META_KEYS = new Set([
  'r2Key',
  'objectKey',
  'publicInstallUrl',
  'downloadUrl',
  'before',
  'after',
]);

function redactIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 4) {
      parts[3] = 'xxx';
      return parts.join('.');
    }
  }
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length > 1) {
      parts[parts.length - 1] = 'xxxx';
      return parts.join(':');
    }
  }
  return 'xxx';
}

export function redactMeta(meta) {
  if (meta == null) return null;
  if (typeof meta !== 'object') return '[redacted]';
  if (Array.isArray(meta)) return meta.map(() => '[redacted]');
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_META_KEYS.has(k)) out[k] = '[redacted]';
    else if (k === 'presetId' || k === 'roleId' || k === 'artifactId' || k === 'id') {
      out[k] = typeof v === 'string' && v.length > 8 ? `${v.slice(0, 8)}…` : v;
    } else out[k] = v;
  }
  return out;
}

export function isAuditorStaff(staff) {
  return String(staff?.staffRole?.slug || '') === AUDITOR_ROLE_SLUG;
}

export function redactAuditLogRow(row) {
  if (!row) return row;
  return {
    ...row,
    ip: redactIp(row.ip),
    userAgent: row.userAgent ? '[redacted]' : '',
    targetUserId:
      row.targetUserId && String(row.targetUserId).length > 8
        ? `${String(row.targetUserId).slice(0, 8)}…`
        : row.targetUserId,
    meta: redactMeta(row.meta),
  };
}

export function redactAuditLogs(logs) {
  return (logs || []).map(redactAuditLogRow);
}

export { redactIp };

export function redactUserInsights(insights) {
  if (!insights) return insights;
  return {
    ...insights,
    lastLogin: insights.lastLogin
      ? {
          ...insights.lastLogin,
          ip: redactIp(insights.lastLogin.ip),
          userAgent: insights.lastLogin.userAgent ? '[redacted]' : '',
        }
      : null,
    sessions: (insights.sessions || []).map((s) => ({
      ...s,
      ip: redactIp(s.ip),
      userAgent: s.userAgent ? '[redacted]' : '',
    })),
  };
}
