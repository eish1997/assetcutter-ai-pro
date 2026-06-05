import { listUsersForAdmin } from './auth-store.js';
import { getWorkspaceUsedBytes } from './workspace-storage-usage.js';
import { enrichPublicUserWithStaff } from './admin-roles-store.js';

const EXPORT_MAX_ROWS = 5000;

function csvEscape(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `\t${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtIso(value) {
  if (!value) return '';
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value);
  }
}

export function parseAdminUsersExportQuery(searchParams) {
  return {
    q: searchParams.get('q') || '',
    status: searchParams.get('status') || '',
    staffRoleId: searchParams.get('staffRoleId') || '',
    quotaWarnPct: searchParams.get('quotaWarnPct') || '',
  };
}

export async function buildUsersCsv(query = {}) {
  const result = await listUsersForAdmin({
    forExport: true,
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
    q: query.q,
    status: query.status,
    staffRoleId: query.staffRoleId,
    quotaWarnPct: query.quotaWarnPct,
  });
  const rows = result.users || [];
  const truncated = (result.total || 0) > rows.length;
  const enriched = await Promise.all(
    rows.map(async (userRow) => {
      const withStaff = await enrichPublicUserWithStaff(userRow);
      const used = getWorkspaceUsedBytes(userRow.id);
      const quota = userRow.workspaceQuotaBytes;
      const pct =
        quota && quota > 0 && Number.isFinite(used) ? Math.round((used / quota) * 100) : '';
      return { ...withStaff, workspaceUsedBytes: used, usagePct: pct };
    })
  );

  const header = [
    'id',
    'username',
    'email',
    'status',
    'staff_role',
    'created_at',
    'workspace_used_bytes',
    'workspace_quota_bytes',
    'usage_pct',
  ];
  const lines = [header.join(',')];
  for (const u of enriched) {
    lines.push(
      [
        csvEscape(u.id),
        csvEscape(u.username),
        csvEscape(u.email),
        csvEscape(u.status),
        csvEscape(u.staffRoleDisplayName || u.staffRoleSlug || ''),
        csvEscape(fmtIso(u.createdAt)),
        csvEscape(u.workspaceUsedBytes ?? ''),
        csvEscape(u.workspaceQuotaBytes ?? ''),
        csvEscape(u.usagePct),
      ].join(',')
    );
  }
  return {
    csv: `\uFEFF${lines.join('\n')}`,
    rowCount: enriched.length,
    total: result.total || enriched.length,
    truncated,
  };
}
