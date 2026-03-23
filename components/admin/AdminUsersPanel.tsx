import React from 'react';
import type { AuthUser } from '../../services/authClient';
import { fetchAdminUsers, updateAdminUser } from '../../services/adminClient';

const AdminUsersPanel: React.FC = () => {
  const [users, setUsers] = React.useState<AuthUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [savingId, setSavingId] = React.useState<string>('');

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handlePatch = async (userId: string, patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' }) => {
    setSavingId(userId);
    setError('');
    try {
      const res = await updateAdminUser(userId, patch);
      setUsers((prev) => prev.map((u) => (u.id === userId ? res.user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
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
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">用户管理</h2>
          <button
            type="button"
            onClick={() => { void loadUsers(); }}
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
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-white/[0.04] text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">用户名</th>
                <th className="text-left px-3 py-2">邮箱</th>
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
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingId === u.id || u.role === 'admin'}
                        onClick={() => { void handlePatch(u.id, { role: 'admin' }); }}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10"
                      >
                        设为管理员
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.role === 'user'}
                        onClick={() => { void handlePatch(u.id, { role: 'user' }); }}
                        className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 disabled:opacity-40 hover:bg-white/10"
                      >
                        设为普通用户
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'disabled'}
                        onClick={() => { void handlePatch(u.id, { status: 'disabled' }); }}
                        className="px-2 py-1 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 disabled:opacity-40 hover:bg-red-500/20"
                      >
                        禁用
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'active'}
                        onClick={() => { void handlePatch(u.id, { status: 'active' }); }}
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

