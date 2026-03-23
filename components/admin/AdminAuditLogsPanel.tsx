import React from 'react';
import { fetchAuditLogs } from '../../services/adminClient';

type AuditLog = {
  id: string;
  actorIdentifier: string;
  action: string;
  targetUserId: string | null;
  meta: unknown;
  ip: string;
  createdAt: string;
};

const AdminAuditLogsPanel: React.FC = () => {
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAuditLogs(300);
      setLogs(res.logs as AuditLog[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center justify-between">
        <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">审计日志</h2>
        <button type="button" onClick={() => { void load(); }} className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[10px] hover:bg-white/10">
          刷新
        </button>
      </div>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-[11px] text-gray-400">加载日志中…</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-white/[0.04] text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">时间</th>
                <th className="text-left px-3 py-2">操作者</th>
                <th className="text-left px-3 py-2">动作</th>
                <th className="text-left px-3 py-2">目标</th>
                <th className="text-left px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-gray-400">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-300">{item.actorIdentifier || '-'}</td>
                  <td className="px-3 py-2 text-gray-200">{item.action}</td>
                  <td className="px-3 py-2 text-gray-500">{item.targetUserId || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{item.ip || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs.length ? <p className="px-3 py-4 text-[11px] text-gray-500">暂无日志</p> : null}
        </div>
      )}
    </div>
  );
};

export default AdminAuditLogsPanel;

