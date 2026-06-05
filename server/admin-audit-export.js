import { listAuditLogs } from './auth-store.js';
import { auditActionLabel } from './admin-matrix.js';
import { redactAuditLogRow } from './admin-audit-redact.js';

const EXPORT_MAX = 5000;

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function metaForCsv(meta) {
  if (meta == null) return '';
  try {
    const raw = JSON.stringify(meta);
    return raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw;
  } catch {
    return '';
  }
}

export function parseAdminAuditQuery(searchParams) {
  return {
    limit: searchParams.get('limit') || 200,
    offset: searchParams.get('offset') || 0,
    action: searchParams.get('action') || '',
    actor: searchParams.get('actor') || '',
    targetUserId: searchParams.get('targetUserId') || '',
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
    category: searchParams.get('category') || '',
    excludeActions: searchParams.get('excludeActions') || '',
    cursor: searchParams.get('cursor') || '',
  };
}

export async function buildAuditLogsCsv(query, { actionLabel = auditActionLabel, redact = false } = {}) {
  const result = await listAuditLogs({
    ...query,
    limit: Math.min(EXPORT_MAX, Number(query.limit || EXPORT_MAX) || EXPORT_MAX),
    offset: 0,
  });
  const header = ['createdAt', 'actorIdentifier', 'action', 'actionLabel', 'targetUserId', 'ip', 'meta'];
  const lines = [header.join(',')];
  for (const row of result.logs) {
    const item = redact ? redactAuditLogRow(row) : row;
    lines.push(
      [
        csvEscape(item.createdAt),
        csvEscape(item.actorIdentifier),
        csvEscape(item.action),
        csvEscape(actionLabel(item.action)),
        csvEscape(item.targetUserId || ''),
        csvEscape(item.ip || ''),
        csvEscape(metaForCsv(item.meta)),
      ].join(',')
    );
  }
  return {
    csv: `\uFEFF${lines.join('\n')}\n`,
    rowCount: result.logs.length,
    total: result.total,
    truncated: (result.total || 0) > result.logs.length,
  };
}
