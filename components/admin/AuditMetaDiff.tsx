import React from 'react';

const FIELD_LABELS: Record<string, string> = {
  role: '站点角色',
  status: '账号状态',
  staffRoleId: '后台角色 ID',
  workspaceQuotaBytes: '云配额 (bytes)',
};

function fmtValue(key: string, value: unknown): string {
  if (value == null) return '—';
  if (key === 'workspaceQuotaBytes') {
    const n = Number(value);
    if (Number.isFinite(n)) return `${Math.round(n / (1024 * 1024))} MB (${n})`;
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const DiffRows: React.FC<{ before: Record<string, unknown>; after: Record<string, unknown> }> = ({ before, after }) => {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  const rows = keys
    .map((key) => {
      const b = before[key];
      const a = after[key];
      if (JSON.stringify(b) === JSON.stringify(a)) return null;
      return (
        <tr key={key} className="border-t border-[#252528]">
          <td className="px-2 py-1.5 text-gray-500 align-top">{FIELD_LABELS[key] || key}</td>
          <td className="px-2 py-1.5 text-red-300/90 align-top whitespace-pre-wrap break-all">{fmtValue(key, b)}</td>
          <td className="px-2 py-1.5 text-emerald-300/90 align-top whitespace-pre-wrap break-all">{fmtValue(key, a)}</td>
        </tr>
      );
    })
    .filter(Boolean);
  if (!rows.length) return <p className="text-[10px] text-gray-500">无字段差异</p>;
  return (
    <table className="w-full text-[10px]">
      <thead className="text-gray-500">
        <tr>
          <th className="text-left px-2 py-1">字段</th>
          <th className="text-left px-2 py-1">变更前</th>
          <th className="text-left px-2 py-1">变更后</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
};

function PermissionDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = new Set(Array.isArray(before) ? before.map(String) : []);
  const a = new Set(Array.isArray(after) ? after.map(String) : []);
  const added = [...a].filter((x) => !b.has(x)).sort();
  const removed = [...b].filter((x) => !a.has(x)).sort();
  return (
    <div className="space-y-2 text-[10px]">
      {added.length ? (
        <div>
          <p className="text-emerald-400/90 mb-1">新增 ({added.length})</p>
          <ul className="list-disc pl-4 text-gray-300 space-y-0.5">
            {added.map((p) => (
              <li key={`+${p}`}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {removed.length ? (
        <div>
          <p className="text-red-400/90 mb-1">移除 ({removed.length})</p>
          <ul className="list-disc pl-4 text-gray-300 space-y-0.5">
            {removed.map((p) => (
              <li key={`-${p}`}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!added.length && !removed.length ? <p className="text-gray-500">权限无变化</p> : null}
    </div>
  );
};

function ConfigDiff({ before, after }: { before: unknown; after: unknown }) {
  const b =
    before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const rows = keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => (
      <tr key={k} className="border-t border-[#252528]">
        <td className="px-2 py-1.5 text-gray-500 align-top font-mono">{k}</td>
        <td className="px-2 py-1.5 text-red-300/90">{String(b[k] ?? '—')}</td>
        <td className="px-2 py-1.5 text-emerald-300/90">{String(a[k] ?? '—')}</td>
      </tr>
    ));
  if (!rows.length) return <p className="text-[10px] text-gray-500">配置无变化</p>;
  return (
    <table className="w-full text-[10px]">
      <thead className="text-gray-500">
        <tr>
          <th className="text-left px-2 py-1">键</th>
          <th className="text-left px-2 py-1">变更前</th>
          <th className="text-left px-2 py-1">变更后</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
};

const AuditMetaDiff: React.FC<{ action: string; meta: unknown }> = ({ action, meta }) => {
  if (meta == null) return null;
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;

  if (m && 'before' in m && 'after' in m) {
    if (action === 'admin.role_permissions_update') {
      return <PermissionDiff before={m.before} after={m.after} />;
    }
    if (action === 'admin.gemini_fairness_config_put' || action === 'admin.gemini_fairness_config_delete') {
      return <ConfigDiff before={m.before} after={m.after} />;
    }
    if (action === 'admin.user_update') {
      const before = m.before && typeof m.before === 'object' ? (m.before as Record<string, unknown>) : {};
      const after = m.after && typeof m.after === 'object' ? (m.after as Record<string, unknown>) : {};
      return <DiffRows before={before} after={after} />;
    }
  }

  return (
    <pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-all">{JSON.stringify(meta, null, 2)}</pre>
  );
};

export default AuditMetaDiff;
