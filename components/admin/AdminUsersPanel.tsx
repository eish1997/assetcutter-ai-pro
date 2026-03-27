import React from 'react';
import type { AuthUser } from '../../services/authClient';
import { HttpRequestError } from '../../services/httpClient';
import { fetchAdminUsers, reconcileAdminUserWorkspaceUsage, updateAdminUser } from '../../services/adminClient';

function fmtMb(bytes: number | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AdminUsersPanel: React.FC = () => {
  const [users, setUsers] = React.useState<AuthUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [savingId, setSavingId] = React.useState<string>('');
  const [quotaDraftMb, setQuotaDraftMb] = React.useState<Record<string, string>>({});

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminUsers();
      setUsers(res.users);
      const drafts: Record<string, string> = {};
      for (const u of res.users) {
        const q = u.workspaceQuotaBytes;
        drafts[u.id] = q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200';
      }
      // 刷新时以服务端最新数据为准，避免旧草稿覆盖真实用户配额
      setQuotaDraftMb(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const syncQuotaDraftByUser = React.useCallback((u: AuthUser) => {
    const q = u.workspaceQuotaBytes;
    setQuotaDraftMb((prev) => ({
      ...prev,
      [u.id]: q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200',
    }));
  }, []);

  React.useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (loading) return;
      void loadUsers();
    }, 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, [loadUsers, loading]);

  const handlePatch = async (userId: string, patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' }) => {
    setSavingId(userId);
    setError('');
    try {
      const res = await updateAdminUser(userId, patch);
      setUsers((prev) => prev.map((u) => (u.id === userId ? res.user : u)));
      syncQuotaDraftByUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingId('');
    }
  };

  const handleSaveQuotaMb = async (userId: string) => {
    const raw = quotaDraftMb[userId] ?? '';
    const mb = Math.floor(Number(raw));
    if (!Number.isFinite(mb) || mb < 1) {
      setError('配额请输入至少 1 的整数（MB）');
      return;
    }
    setSavingId(userId);
    setError('');
    try {
      const res = await updateAdminUser(userId, { workspaceQuotaBytes: mb * 1024 * 1024 });
      setUsers((prev) => prev.map((u) => (u.id === userId ? res.user : u)));
      syncQuotaDraftByUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingId('');
    }
  };

  const handleReconcile = async (userId: string, force?: boolean) => {
    if (force) {
      const ok = window.confirm(
        '将按 R2 扫描结果覆盖用量账本。若扫描仍为空，会把已用量清零；仅在该用户桶里确实没有计费工作区文件时使用。'
      );
      if (!ok) return;
    }
    setSavingId(userId);
    setError('');
    try {
      const res = await reconcileAdminUserWorkspaceUsage(userId, force ? { force: true } : undefined);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, workspaceUsedBytes: res.workspaceUsedBytes } : u))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '同步失败';
      if (err instanceof HttpRequestError && err.code === 'RECONCILE_EMPTY_BLOCKED') {
        setError(`${msg} 若已核对 R2 配置无误，可再点「强制同步」。`);
      } else {
        setError(msg);
      }
    } finally {
      setSavingId('');
    }
  };

  const filtered = users.filter((u) => {
    const q = keyword.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">用户管理</h2>
            <p className="mt-1 text-[10px] text-gray-500 max-w-xl leading-relaxed">
              工作区云空间默认 200MB（仅统计工作流图片，不含 workflow.json / 索引）。修改配额后用户下次请求生效；「同步用量」从 R2 扫描重建用量账本（不会删除对象）。若 R2 列表异常返回空，会拒绝把大用量账本误清零，此时请先核对桶与权限，必要时再「强制同步」。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadUsers();
            }}
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[10px] text-gray-200 hover:bg-white/10"
          >
            刷新
          </button>
        </div>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索用户名或邮箱"
          className="mt-3 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[12px] text-white placeholder-gray-500 outline-none focus:border-blue-500/60"
        />
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-[11px] text-gray-400">加载用户中…</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-x-auto">
          <table className="w-full text-[11px] min-w-[720px]">
            <thead className="bg-white/[0.04] text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">用户名</th>
                <th className="text-left px-3 py-2">邮箱</th>
                <th className="text-left px-3 py-2">云空间</th>
                <th className="text-left px-3 py-2">配额(MB)</th>
                <th className="text-left px-3 py-2">角色</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">创建时间</th>
                <th className="text-left px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-gray-200">{u.username}</td>
                  <td className="px-3 py-2 text-gray-300">{u.email}</td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                    {fmtMb(u.workspaceUsedBytes)} / {fmtMb(u.workspaceQuotaBytes)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={quotaDraftMb[u.id] ?? ''}
                        onChange={(e) => setQuotaDraftMb((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        className="w-16 rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-white outline-none focus:border-blue-500/50"
                      />
                      <button
                        type="button"
                        disabled={savingId === u.id}
                        onClick={() => {
                          void handleSaveQuotaMb(u.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-blue-500/40 bg-blue-500/15 text-blue-200 disabled:opacity-40 hover:bg-blue-500/25"
                      >
                        保存配额
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id}
                        onClick={() => {
                          void handleReconcile(u.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-gray-300 disabled:opacity-40 hover:bg-white/10"
                        title="从 R2 扫描工作区图片并重建用量"
                      >
                        同步用量
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id}
                        onClick={() => {
                          void handleReconcile(u.id, true);
                        }}
                        className="px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200/90 disabled:opacity-40 hover:bg-amber-500/20"
                        title="即使扫描为空也覆盖账本（桶已空时使用）"
                      >
                        强制同步
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingId === u.id || u.role === 'admin'}
                        onClick={() => {
                          void handlePatch(u.id, { role: 'admin' });
                        }}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10"
                      >
                        设为管理员
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.role === 'user'}
                        onClick={() => {
                          void handlePatch(u.id, { role: 'user' });
                        }}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10"
                      >
                        设为普通用户
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'disabled'}
                        onClick={() => {
                          void handlePatch(u.id, { status: 'disabled' });
                        }}
                        className="px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 disabled:opacity-40 hover:bg-red-500/20"
                      >
                        禁用
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'active'}
                        onClick={() => {
                          void handlePatch(u.id, { status: 'active' });
                        }}
                        className="px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 disabled:opacity-40 hover:bg-emerald-500/20"
                      >
                        启用
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <p className="px-3 py-4 text-[11px] text-gray-500">暂无匹配用户</p> : null}
        </div>
      )}
    </div>
  );
};

export default AdminUsersPanel;
