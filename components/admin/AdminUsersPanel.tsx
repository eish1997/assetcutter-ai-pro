import React from 'react';
import type { AuthUser } from '../../services/authClient';
import { HttpRequestError } from '../../services/httpClient';
import { fetchAdminUsers, reconcileAdminUserWorkspaceUsage, updateAdminUser, downloadAdminUsersCsv } from '../../services/adminClient';
import { fetchAdminRoles, type AdminRoleRow } from '../../services/adminRolesClient';
import { PERMISSIONS } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { adminAuditUrlForUser, adminUserDetailUrl, navigateAdmin } from '../../services/adminNavigate';
import { CustomDropdown } from '../ui/CustomDropdown';
import { useAdminStaff } from './AdminStaffContext';
import UserRecentAuditSnippet from './UserRecentAuditSnippet';

function fmtMb(bytes: number | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PAGE_SIZE = 20;

function readHighlightUserIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('userId')?.trim() || '';
}

const AdminUsersPanel: React.FC = () => {
  const { can, isRolePreview } = useAdminStaff();
  const canWrite = can(PERMISSIONS.USERS_WRITE);
  const canRoleWrite = can(PERMISSIONS.USERS_ROLE_WRITE);
  const canReconcile = can(PERMISSIONS.USERS_RECONCILE);
  const canAudit = can(PERMISSIONS.AUDIT_READ);
  const [highlightUserId] = React.useState(readHighlightUserIdFromUrl);
  const [auditExpandUserId, setAuditExpandUserId] = React.useState('');
  const highlightRef = React.useRef<HTMLTableRowElement | null>(null);
  const [users, setUsers] = React.useState<AuthUser[]>([]);
  const [roles, setRoles] = React.useState<AdminRoleRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [keyword, setKeyword] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [staffRoleFilter, setStaffRoleFilter] = React.useState('');
  const [quotaWarnOnly, setQuotaWarnOnly] = React.useState(false);
  const [savingId, setSavingId] = React.useState<string>('');
  const [quotaDraftMb, setQuotaDraftMb] = React.useState<Record<string, string>>({});
  const [exporting, setExporting] = React.useState(false);
  const [exportHint, setExportHint] = React.useState('');

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminUsers({
        page,
        pageSize: PAGE_SIZE,
        q: keyword.trim(),
        status: statusFilter === 'active' || statusFilter === 'disabled' ? statusFilter : undefined,
        staffRoleId: staffRoleFilter || undefined,
        quotaWarnPct: quotaWarnOnly ? 0.8 : undefined,
      });
      setUsers(res.users);
      setTotal(res.total ?? res.users.length);
      const drafts: Record<string, string> = {};
      for (const u of res.users) {
        const q = u.workspaceQuotaBytes;
        drafts[u.id] = q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200';
      }
      setQuotaDraftMb((prev) => ({ ...prev, ...drafts }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, statusFilter, staffRoleFilter, quotaWarnOnly]);

  React.useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  React.useEffect(() => {
    if (!highlightUserId || loading) return;
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightUserId, loading, users]);

  React.useEffect(() => {
    if (!canRoleWrite) return;
    void fetchAdminRoles()
      .then((r) => setRoles(r.roles))
      .catch(() => setRoles([]));
  }, [canRoleWrite]);

  const syncQuotaDraftByUser = React.useCallback((u: AuthUser) => {
    const q = u.workspaceQuotaBytes;
    setQuotaDraftMb((prev) => ({
      ...prev,
      [u.id]: q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200',
    }));
  }, []);

  const handlePatch = async (
    userId: string,
    patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled'; staffRoleId?: string | null }
  ) => {
    if (blockIfRolePreview(isRolePreview)) return;
    if (patch.staffRoleId !== undefined) {
      const role = roles.find((r) => r.id === patch.staffRoleId);
      if (role?.slug === 'super') {
        const ok = window.confirm('确认将该用户设为超级管理员？此操作将被审计记录。');
        if (!ok) return;
      }
    }
    if (patch.status === 'disabled') {
      const target = users.find((u) => u.id === userId);
      const ok = window.confirm(`确认禁用用户 @${target?.username || userId}？`);
      if (!ok) return;
    }
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
    if (blockIfRolePreview(isRolePreview)) return;
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
    if (blockIfRolePreview(isRolePreview)) return;
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

  const roleOptions = [
    { value: '', label: '全部后台角色' },
    { value: '__none__', label: '无后台角色' },
    ...roles.map((r) => ({ value: r.id, label: `${r.displayName} (${r.slug})` })),
  ];

  const statusOptions = [
    { value: '', label: '全部状态' },
    { value: 'active', label: 'active' },
    { value: 'disabled', label: 'disabled' },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">用户管理</h2>
            <p className="mt-1 text-[10px] text-gray-500 max-w-xl leading-relaxed">
              共 {total} 用户。修改配额后用户下次请求生效；「同步用量」从 R2 扫描重建用量账本。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                setExportHint('');
                setExporting(true);
                void downloadAdminUsersCsv({
                  q: keyword.trim(),
                  status: statusFilter === 'active' || statusFilter === 'disabled' ? statusFilter : undefined,
                  staffRoleId: staffRoleFilter || undefined,
                  quotaWarnPct: quotaWarnOnly ? 0.8 : undefined,
                })
                  .then((r) => {
                    setExportHint(
                      r.truncated
                        ? `已导出 ${r.rows} 条（共 ${r.total}，已截断至上限）`
                        : `已导出 ${r.rows} 条`
                    );
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : '导出失败'))
                  .finally(() => setExporting(false));
              }}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36] disabled:opacity-40"
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </button>
            <button
              type="button"
              onClick={() => {
                void loadUsers();
              }}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
            >
              刷新
            </button>
          </div>
        </div>
        {exportHint ? <p className="mt-2 text-[10px] text-emerald-400/90">{exportHint}</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="text"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜索用户名或邮箱"
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[12px] text-white placeholder-gray-500 outline-none focus:border-[#3b82f6]"
          />
          <CustomDropdown
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={statusOptions}
            triggerClassName="w-full bg-white/5 border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] text-left flex items-center justify-between outline-none hover:bg-[#2e2e36]"
          />
          <CustomDropdown
            value={staffRoleFilter}
            onChange={(v) => {
              setStaffRoleFilter(v);
              setPage(1);
            }}
            options={roleOptions}
            triggerClassName="w-full bg-white/5 border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] text-left flex items-center justify-between outline-none hover:bg-[#2e2e36]"
          />
          <label className="flex items-center gap-2 text-[11px] text-gray-400 px-1">
            <input
              type="checkbox"
              checked={quotaWarnOnly}
              onChange={(e) => {
                setQuotaWarnOnly(e.target.checked);
                setPage(1);
              }}
            />
            仅显示配额 ≥80%
          </label>
        </div>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {loading ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载用户中…</div>
      ) : (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-x-auto">
          <table className="w-full text-[11px] min-w-[820px]">
            <thead className="bg-[#151518] text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">用户名</th>
                <th className="text-left px-3 py-2">邮箱</th>
                <th className="text-left px-3 py-2">云空间</th>
                <th className="text-left px-3 py-2">配额(MB)</th>
                <th className="text-left px-3 py-2">后台角色</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">创建时间</th>
                <th className="text-left px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <React.Fragment key={u.id}>
                <tr
                  ref={u.id === highlightUserId ? highlightRef : undefined}
                  className={`border-t border-[#252528] ${u.id === highlightUserId ? 'bg-blue-500/5 ring-1 ring-inset ring-blue-500/30' : ''}`}
                >
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
                        disabled={!canWrite}
                        className="w-16 rounded-lg border border-[#343438] bg-[#16161a] px-2 py-1 text-[10px] text-white outline-none focus:border-[#3b82f6] disabled:opacity-40"
                      />
                      <button
                        type="button"
                        disabled={savingId === u.id || !canWrite}
                        onClick={() => {
                          void handleSaveQuotaMb(u.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-[#3b6fb8] bg-[#1e3a5f] text-blue-200 disabled:opacity-40 hover:bg-[#2a5080]"
                      >
                        保存配额
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || !canReconcile}
                        onClick={() => {
                          void handleReconcile(u.id);
                        }}
                        className="px-2 py-1 rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-gray-300 disabled:opacity-40 hover:bg-[#2e2e36]"
                      >
                        同步用量
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {canRoleWrite && roles.length ? (
                      <CustomDropdown
                        value={u.staffRoleId || ''}
                        onChange={(v) => {
                          void handlePatch(u.id, {
                            role: v ? 'admin' : 'user',
                            staffRoleId: v || null,
                          });
                        }}
                        disabled={savingId === u.id}
                        options={[
                          { value: '', label: '普通用户' },
                          ...roles.map((r) => ({ value: r.id, label: r.displayName })),
                        ]}
                        triggerClassName="min-w-[120px] bg-white/5 border border-[#2e2e32] rounded-lg px-2 py-1 text-[10px] text-left flex items-center justify-between outline-none hover:bg-[#2e2e36] disabled:opacity-40"
                      />
                    ) : (
                      <span className="text-gray-300">{u.staffRoleDisplayName || u.staffRoleSlug || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg border border-[#3b6fb8] bg-[#1e3a5f] text-blue-200 hover:bg-[#2a5080] text-[10px]"
                        onClick={() => navigateAdmin(adminUserDetailUrl(u.id))}
                      >
                        详情
                      </button>
                      {canAudit ? (
                        <>
                          <button
                            type="button"
                            className="px-2 py-1 rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-gray-300 hover:bg-[#2e2e36] text-[10px]"
                            onClick={() => navigateAdmin(adminAuditUrlForUser(u.id))}
                          >
                            审计
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-gray-400 hover:bg-[#2e2e36] text-[10px]"
                            onClick={() => setAuditExpandUserId((prev) => (prev === u.id ? '' : u.id))}
                          >
                            {auditExpandUserId === u.id ? '收起' : '最近审计'}
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'disabled' || !canWrite}
                        onClick={() => {
                          void handlePatch(u.id, { status: 'disabled' });
                        }}
                        className="px-2 py-1 rounded-lg border border-[#dc6b6b] bg-[#3a1818] text-red-200 disabled:opacity-40 hover:bg-[#4a1c1c]"
                      >
                        禁用
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.status === 'active' || !canWrite}
                        onClick={() => {
                          void handlePatch(u.id, { status: 'active' });
                        }}
                        className="px-2 py-1 rounded-lg border border-[#34d399] bg-[#0d2818] text-emerald-200 disabled:opacity-40 hover:bg-[#14532d]"
                      >
                        启用
                      </button>
                    </div>
                  </td>
                </tr>
                {canAudit && auditExpandUserId === u.id ? (
                  <tr className="border-t border-[#252528]">
                    <td colSpan={8} className="p-0">
                      <UserRecentAuditSnippet userId={u.id} username={u.username} />
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {!users.length ? <p className="px-3 py-4 text-[11px] text-gray-500">暂无匹配用户</p> : null}
          <div className="flex items-center justify-between px-3 py-3 border-t border-[#252528] text-[10px] text-gray-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsersPanel;
