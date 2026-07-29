import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../services/apiBase';
import { HttpRequestError, requestJson } from '../../services/httpClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';

type ShellToolSubmission = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  toolId: string;
  semver: string;
  label: string;
  notes: string;
  fileName: string;
  r2Key: string;
  sha256: string;
  bytes: number;
  submittedByUserId: string;
  submittedByUsername: string;
  submittedAt: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  rejectReason?: string;
  artifactId?: string;
};

async function fetchAdminShellToolSubmissions(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return requestJson<{ submissions: ShellToolSubmission[] }>(
    apiUrl(`/api/admin/shell-tool-submissions${q}`),
    { cache: 'no-store' },
  );
}

async function approveShellToolSubmission(id: string) {
  return requestJson<{ submission: ShellToolSubmission; artifact: unknown }>(
    apiUrl(`/api/admin/shell-tool-submissions/${encodeURIComponent(id)}/approve`),
    { method: 'POST', body: '{}' },
  );
}

async function rejectShellToolSubmission(id: string, reason: string) {
  return requestJson<{ submission: ShellToolSubmission }>(
    apiUrl(`/api/admin/shell-tool-submissions/${encodeURIComponent(id)}/reject`),
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

const AdminShellToolSubmissionsPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.COMPANION_WRITE);
  const [rows, setRows] = useState<ShellToolSubmission[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      const r = await fetchAdminShellToolSubmissions(statusFilter === 'pending' ? 'pending' : undefined);
      setRows(r.submissions || []);
    } catch (e) {
      setError(e instanceof HttpRequestError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }, [statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onApprove = async (id: string) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!canWrite) return;
    setBusyId(id);
    setError('');
    setMsg('');
    try {
      await approveShellToolSubmission(id);
      setMsg('已通过并写入公共 catalog');
      await reload();
    } catch (e) {
      setError(e instanceof HttpRequestError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (!canWrite) return;
    const reason = window.prompt('驳回原因', '不符合规范') || '';
    if (!reason.trim()) return;
    setBusyId(id);
    setError('');
    setMsg('');
    try {
      await rejectShellToolSubmission(id, reason.trim());
      setMsg('已驳回');
      await reload();
    } catch (e) {
      setError(e instanceof HttpRequestError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 p-4 text-sm text-zinc-200">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-white">小工具审批</h2>
        <button
          type="button"
          className={`rounded px-2 py-1 text-xs ${statusFilter === 'pending' ? 'bg-white/15' : 'bg-white/5'}`}
          onClick={() => setStatusFilter('pending')}
        >
          待审
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 text-xs ${statusFilter === 'all' ? 'bg-white/15' : 'bg-white/5'}`}
          onClick={() => setStatusFilter('all')}
        >
          全部
        </button>
        <button type="button" className="rounded bg-white/10 px-2 py-1 text-xs" onClick={() => void reload()}>
          刷新
        </button>
      </div>
      <p className="text-xs text-zinc-400">用户自建 shell_tool_bundle 提交后在此审批；通过后进入公开发行目录，全员可下载。</p>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <div className="overflow-x-auto rounded border border-white/10">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-white/5 text-zinc-400">
            <tr>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">工具</th>
              <th className="px-3 py-2">版本</th>
              <th className="px-3 py-2">提交人</th>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-zinc-500">
                  暂无记录
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-zinc-100">{row.label || row.toolId}</div>
                    <div className="text-[10px] text-zinc-500">{row.toolId}</div>
                    <div className="max-w-xs truncate text-[10px] text-zinc-500" title={row.notes}>
                      {row.notes}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{row.semver}</td>
                  <td className="px-3 py-2">{row.submittedByUsername || row.submittedByUserId}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.submittedAt?.slice(0, 19)?.replace('T', ' ')}</td>
                  <td className="px-3 py-2">
                    {row.status === 'pending' && canWrite ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          className="rounded bg-emerald-700/80 px-2 py-1 disabled:opacity-50"
                          onClick={() => void onApprove(row.id)}
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          className="rounded bg-red-800/70 px-2 py-1 disabled:opacity-50"
                          onClick={() => void onReject(row.id)}
                        >
                          驳回
                        </button>
                      </div>
                    ) : row.rejectReason ? (
                      <span className="text-amber-200">{row.rejectReason}</span>
                    ) : row.artifactId ? (
                      <span className="text-zinc-500">artifact {row.artifactId.slice(0, 8)}…</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminShellToolSubmissionsPanel;
