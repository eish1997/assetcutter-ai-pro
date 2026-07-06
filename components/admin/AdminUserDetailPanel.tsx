import React from 'react';
import type { AuthUser } from '../../services/authClient';
import { HttpRequestError } from '../../services/httpClient';
import {
  fetchAdminUser,
  fetchAuditLogs,
  fetchTaskExecutionEvents,
  reconcileAdminUserWorkspaceUsage,
  updateAdminUser,
  adjustAdminUserCredits,
  fetchAdminUserCreditLedger,
  type AdminUserCredits,
  type AdminUserLastLogin,
  type AdminUserSession,
  type TaskExecutionEvent,
} from '../../services/adminClient';
import { fetchAdminRoles, type AdminRoleRow } from '../../services/adminRolesClient';
import { auditActionLabel } from '../../services/adminMatrix';
import { auditLogSummary } from '../../services/auditLogSummary';
import { PERMISSIONS, canGrantAdminCredits } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import {
  adminAuditUrlForUser,
  adminTaskEventsUrlForUser,
  navigateAdmin,
} from '../../services/adminNavigate';
import {
  taskEventCodeLabel,
  taskEventLevelDot,
  taskEventSummary,
} from '../../services/taskEventSummary';
import { fmtCredits, creditLedgerKindLabel, type CreditLedgerEntry } from '../../shared/credits';
import { CustomDropdown } from '../ui/CustomDropdown';
import { useAdminStaff } from './AdminStaffContext';

type DetailTab = 'audit' | 'tasks';

function fmtMb(bytes: number | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function quotaPct(used?: number, quota?: number): number {
  if (!quota || quota <= 0 || used == null) return 0;
  return Math.min(100, Math.round((used / quota) * 100));
}

type Props = {
  userId: string;
};

const AdminUserDetailPanel: React.FC<Props> = ({ userId }) => {
  const { can, isRolePreview, me } = useAdminStaff();
  const canWrite = can(PERMISSIONS.USERS_WRITE);
  const canCreditsWrite = canGrantAdminCredits(me?.permissions, me?.staffRole?.slug);
  const canRoleWrite = can(PERMISSIONS.USERS_ROLE_WRITE);
  const canReconcile = can(PERMISSIONS.USERS_RECONCILE);
  const canAudit = can(PERMISSIONS.AUDIT_READ);
  const canTaskEvents = can(PERMISSIONS.TASK_EVENTS_READ);

  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [roles, setRoles] = React.useState<AdminRoleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [quotaDraftMb, setQuotaDraftMb] = React.useState('200');
  const [tab, setTab] = React.useState<DetailTab>('audit');
  const [tasksError, setTasksError] = React.useState('');

  const [auditLogs, setAuditLogs] = React.useState<
    Array<{ id: string; action: string; actorIdentifier: string; createdAt: string; meta: unknown; targetUserId: string | null }>
  >([]);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [taskEvents, setTaskEvents] = React.useState<TaskExecutionEvent[]>([]);
  const [tasksLoading, setTasksLoading] = React.useState(false);
  const [lastLogin, setLastLogin] = React.useState<AdminUserLastLogin | null>(null);
  const [sessions, setSessions] = React.useState<AdminUserSession[]>([]);
  const [credits, setCredits] = React.useState<AdminUserCredits | null>(null);
  const [creditDelta, setCreditDelta] = React.useState('');
  const [creditNote, setCreditNote] = React.useState('');
  const [creditModal, setCreditModal] = React.useState<'grant' | 'deduct' | null>(null);
  const [creditLedger, setCreditLedger] = React.useState<CreditLedgerEntry[]>([]);
  const [creditLedgerCursor, setCreditLedgerCursor] = React.useState<string | null>(null);
  const [creditLedgerLoading, setCreditLedgerLoading] = React.useState(false);

  const loadCreditLedger = React.useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      if (!userId) return;
      setCreditLedgerLoading(true);
      try {
        const res = await fetchAdminUserCreditLedger(userId, {
          limit: 20,
          cursor: opts?.cursor || undefined,
        });
        setCreditLedger((prev) => (opts?.append ? [...prev, ...res.entries] : res.entries));
        setCreditLedgerCursor(res.nextCursor);
      } catch {
        if (!opts?.append) setCreditLedger([]);
        setCreditLedgerCursor(null);
      } finally {
        setCreditLedgerLoading(false);
      }
    },
    [userId]
  );

  React.useEffect(() => {
    if (loading || !user) return;
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#admin-user-credits') return;
    document.getElementById('admin-user-credits')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [loading, user]);

  const loadUser = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminUser(userId);
      setUser(res.user);
      setLastLogin(res.lastLogin ?? null);
      setSessions(res.sessions ?? []);
      setCredits(res.credits ?? null);
      const q = res.user.workspaceQuotaBytes;
      setQuotaDraftMb(q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setUser(null);
      setLastLogin(null);
      setSessions([]);
      setCredits(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    void loadUser();
  }, [loadUser]);

  React.useEffect(() => {
    void loadCreditLedger();
  }, [loadCreditLedger]);

  React.useEffect(() => {
    if (!canRoleWrite) return;
    void fetchAdminRoles()
      .then((r) => setRoles(r.roles))
      .catch(() => setRoles([]));
  }, [canRoleWrite]);

  React.useEffect(() => {
    if (!canAudit || tab !== 'audit') return;
    let cancelled = false;
    setAuditLoading(true);
    void fetchAuditLogs({ targetUserId: userId, limit: 20, offset: 0 })
      .then((res) => {
        if (!cancelled) setAuditLogs(res.logs as typeof auditLogs);
      })
      .catch(() => {
        if (!cancelled) setAuditLogs([]);
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canAudit, tab, userId]);

  React.useEffect(() => {
    if (!canTaskEvents || tab !== 'tasks') return;
    let cancelled = false;
    setTasksLoading(true);
    setTasksError('');
    void fetchTaskExecutionEvents({ userId, limit: 20 })
      .then((res) => {
        if (!cancelled) setTaskEvents(res.events);
      })
      .catch((err) => {
        if (!cancelled) {
          setTaskEvents([]);
          setTasksError(err instanceof Error ? err.message : '加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canTaskEvents, tab, userId]);

  const applyUser = (next: AuthUser) => {
    setUser(next);
    const q = next.workspaceQuotaBytes;
    setQuotaDraftMb(q != null && Number.isFinite(q) ? String(Math.round(q / (1024 * 1024))) : '200');
  };

  const handlePatch = async (
    patch: { role?: 'admin' | 'user'; status?: 'active' | 'disabled'; staffRoleId?: string | null }
  ) => {
    if (!user) return;
    if (blockIfRolePreview(isRolePreview)) return;
    if (patch.staffRoleId !== undefined && canRoleWrite) {
      const role = roles.find((r) => r.id === patch.staffRoleId);
      if (role?.slug === 'super') {
        const ok = window.confirm('确认将该用户设为超级管理员？此操作将被审计记录。');
        if (!ok) return;
      }
    }
    if (patch.status === 'disabled') {
      const ok = window.confirm(`确认禁用用户 @${user.username}？`);
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await updateAdminUser(user.id, patch);
      applyUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveQuota = async () => {
    if (!user) return;
    if (blockIfRolePreview(isRolePreview)) return;
    const mb = Math.floor(Number(quotaDraftMb));
    if (!Number.isFinite(mb) || mb < 1) {
      setError('配额请输入至少 1 的整数（MB）');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await updateAdminUser(user.id, { workspaceQuotaBytes: mb * 1024 * 1024 });
      applyUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReconcile = async (force?: boolean) => {
    if (!user) return;
    if (blockIfRolePreview(isRolePreview)) return;
    if (force) {
      const ok = window.confirm('强制同步可能清零用量，仅在你确认 R2 桶内无计费文件时使用。');
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await reconcileAdminUserWorkspaceUsage(user.id, force ? { force: true } : undefined);
      setUser((prev) => (prev ? { ...prev, workspaceUsedBytes: res.workspaceUsedBytes } : prev));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '同步失败';
      if (err instanceof HttpRequestError && err.code === 'RECONCILE_EMPTY_BLOCKED') {
        setError(`${msg} 可尝试强制同步。`);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreditAdjust = async () => {
    if (!user || !creditModal) return;
    if (blockIfRolePreview(isRolePreview)) return;
    const n = Math.floor(Number(creditDelta));
    if (!Number.isFinite(n) || n < 1) {
      setError('请输入至少 1 的整数');
      return;
    }
    const delta = creditModal === 'grant' ? n : -n;
    const note = creditNote.trim();
    if (!note) {
      setError('备注必填');
      return;
    }
    if (creditModal === 'deduct' && credits && n > credits.balance) {
      setError('扣回数量不能超过当前余额');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await adjustAdminUserCredits(user.id, delta, note);
      setCredits(res.balance);
      setCreditModal(null);
      setCreditDelta('');
      setCreditNote('');
      void loadCreditLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : '积分调整失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !user) {
    return <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载用户详情…</div>;
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 space-y-3">
        <p className="text-[11px] text-red-400">{error || '用户不存在'}</p>
        <button
          type="button"
          onClick={() => navigateAdmin('/admin/users')}
          className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-300"
        >
          返回列表
        </button>
      </div>
    );
  }

  const used = user.workspaceUsedBytes ?? 0;
  const quota = user.workspaceQuotaBytes ?? 0;
  const pct = quotaPct(used, quota);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigateAdmin('/admin/users')}
            className="text-[10px] text-gray-500 hover:text-gray-300 mb-2"
          >
            ← 用户列表
          </button>
          <h2 className="text-lg font-semibold text-white">@{user.username}</h2>
          <p className="text-[11px] text-gray-500 mt-1 font-mono">{user.id}</p>
          <p className="text-[11px] text-gray-400 mt-1">{user.email}</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadUser()}
          className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-200 hover:bg-[#2e2e36]"
        >
          刷新
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">状态</p>
          <p className="mt-2 text-xl font-semibold text-white">{user.status}</p>
          <p className="mt-1 text-[10px] text-gray-600">注册 {new Date(user.createdAt).toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">后台角色</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {user.staffRoleDisplayName || user.staffRoleSlug || '普通用户'}
          </p>
        </div>
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 sm:col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">云空间</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {fmtMb(used)} / {fmtMb(quota)}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-[#2e2e32] overflow-hidden">
            <div
              className={`h-full rounded-full ${pct >= 80 ? 'bg-amber-400' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-gray-600">已用 {pct}%</p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">账号活动</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[#252528] bg-[#0f0f0f] p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">最近登录</p>
            {lastLogin ? (
              <>
                <p className="mt-2 text-[11px] text-gray-200">{new Date(lastLogin.at).toLocaleString()}</p>
                <p className="mt-1 text-[10px] text-gray-500 truncate">{lastLogin.ip || '—'}</p>
              </>
            ) : (
              <p className="mt-2 text-[11px] text-gray-600">暂无记录</p>
            )}
          </div>
          <div className="rounded-xl border border-[#252528] bg-[#0f0f0f] p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">AI 积分</p>
            {credits ? (
              <>
                <p className="mt-2 text-[11px] text-gray-200">
                  余额 {fmtCredits(credits.balance)} · 累计消耗 {fmtCredits(credits.lifetimeSpent)}
                </p>
                <p className="mt-1 text-[10px] text-gray-500">累计发放 {fmtCredits(credits.lifetimeGranted)}</p>
              </>
            ) : (
              <p className="mt-2 text-[11px] text-gray-600">—</p>
            )}
          </div>
          <div className="rounded-xl border border-[#252528] bg-[#0f0f0f] p-3 sm:col-span-2 lg:col-span-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">活跃会话</p>
            <p className="mt-2 text-xl font-semibold text-white">
              {sessions.filter((s) => s.active).length}
              <span className="text-[11px] font-normal text-gray-500 ml-1">/ {sessions.length}</span>
            </p>
          </div>
        </div>
        {sessions.length ? (
          <div className="overflow-x-auto rounded-xl border border-[#252528]">
            <table className="w-full text-[10px]">
              <thead className="bg-[#151518] text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">创建</th>
                  <th className="text-left px-3 py-2">过期</th>
                  <th className="text-left px-3 py-2">IP</th>
                  <th className="text-left px-3 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-[#252528]">
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {new Date(s.expiresAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{s.ip || '—'}</td>
                    <td className="px-3 py-2">
                      {s.active ? (
                        <span className="text-emerald-400/90">活跃</span>
                      ) : s.revokedAt ? (
                        <span className="text-gray-600">已撤销</span>
                      ) : (
                        <span className="text-gray-600">已过期</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div id="admin-user-credits" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">AI 积分</h3>
        <div className="grid gap-2 sm:grid-cols-3 text-[11px]">
          <div>
            <p className="text-[10px] text-gray-500">当前余额</p>
            <p className="mt-1 text-lg font-semibold text-amber-400/95">{fmtCredits(credits?.balance ?? 0)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500">累计发放</p>
            <p className="mt-1 text-white">{fmtCredits(credits?.lifetimeGranted ?? 0)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500">累计消耗</p>
            <p className="mt-1 text-white">{fmtCredits(credits?.lifetimeSpent ?? 0)}</p>
          </div>
        </div>
        {canCreditsWrite ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setCreditModal('grant');
                setCreditDelta('');
                setCreditNote('');
              }}
              className="px-3 py-2 rounded-xl border border-[#3b6fb8] bg-[#1e3a5f] text-[10px] text-blue-200 disabled:opacity-40"
            >
              发放积分
            </button>
            <button
              type="button"
              disabled={saving || !credits?.balance}
              onClick={() => {
                setCreditModal('deduct');
                setCreditDelta('');
                setCreditNote('');
              }}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-300 disabled:opacity-40"
            >
              扣回积分
            </button>
          </div>
        ) : null}
        {!canCreditsWrite ? (
          <p className="text-[10px] text-gray-500">
            当前账号无积分发放权限。超级管理员默认可用；其他角色需在「角色与权限」勾选「积分发放」。
          </p>
        ) : null}
        {creditModal ? (
          <div className="rounded-xl border border-[#343438] bg-[#0f0f0f] p-3 space-y-2">
            <p className="text-[10px] text-gray-400">{creditModal === 'grant' ? '发放积分' : '扣回积分'}</p>
            <input
              type="number"
              min={1}
              value={creditDelta}
              onChange={(e) => setCreditDelta(e.target.value)}
              placeholder="数量"
              className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
            />
            <input
              type="text"
              value={creditNote}
              onChange={(e) => setCreditNote(e.target.value)}
              placeholder="备注（必填）"
              className="w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCreditAdjust()}
                className="px-3 py-2 rounded-xl border border-[#3b6fb8] bg-[#1e3a5f] text-[10px] text-blue-200 disabled:opacity-40"
              >
                确认
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setCreditModal(null)}
                className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-400"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">积分流水</h4>
            {creditLedgerLoading ? <span className="text-[10px] text-gray-600">加载中…</span> : null}
          </div>
          {creditLedger.length ? (
            <div className="overflow-x-auto rounded-xl border border-[#252528]">
              <table className="w-full text-[10px]">
                <thead className="bg-[#151518] text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">时间</th>
                    <th className="text-left px-3 py-2 font-normal">类型</th>
                    <th className="text-right px-3 py-2 font-normal">变动</th>
                    <th className="text-right px-3 py-2 font-normal">余额</th>
                    <th className="text-left px-3 py-2 font-normal">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {creditLedger.map((row) => (
                    <tr key={row.id} className="border-t border-[#252528]">
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-gray-300">{creditLedgerKindLabel(row.kind)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          row.delta >= 0 ? 'text-emerald-400/90' : 'text-amber-300/90'
                        }`}
                      >
                        {row.delta >= 0 ? '+' : ''}
                        {fmtCredits(row.delta)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-200">
                        {fmtCredits(row.balanceAfter)}
                      </td>
                      <td className="px-3 py-2 text-gray-500 max-w-[12rem] truncate" title={row.note || ''}>
                        {row.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[10px] text-gray-600">暂无流水</p>
          )}
          {creditLedgerCursor ? (
            <button
              type="button"
              disabled={creditLedgerLoading}
              onClick={() => void loadCreditLedger({ append: true, cursor: creditLedgerCursor })}
              className="px-3 py-1.5 rounded-lg border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-400 hover:bg-[#2e2e36] disabled:opacity-40"
            >
              加载更多
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <h3 className="text-[11px] font-semibold text-gray-300">管理操作</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-[10px] text-gray-500">
            配额 (MB)
            <input
              type="number"
              min={1}
              value={quotaDraftMb}
              onChange={(e) => setQuotaDraftMb(e.target.value)}
              disabled={!canWrite || saving}
              className="mt-1 block w-24 rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6] disabled:opacity-40"
            />
          </label>
          {canWrite ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveQuota()}
              className="px-3 py-2 rounded-xl border border-[#3b6fb8] bg-[#1e3a5f] text-[10px] text-blue-200 disabled:opacity-40"
            >
              保存配额
            </button>
          ) : null}
          {canReconcile ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleReconcile()}
                className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-300 disabled:opacity-40"
              >
                同步用量
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleReconcile(true)}
                className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] text-gray-500 disabled:opacity-40"
              >
                强制同步
              </button>
            </>
          ) : null}
          {canRoleWrite && roles.length ? (
            <div className="min-w-[160px]">
              <p className="text-[10px] text-gray-500 mb-1">后台角色</p>
              <CustomDropdown
                value={user.staffRoleId || ''}
                onChange={(v) => {
                  void handlePatch({ role: v ? 'admin' : 'user', staffRoleId: v || null });
                }}
                disabled={saving}
                options={[
                  { value: '', label: '普通用户' },
                  ...roles.map((r) => ({ value: r.id, label: r.displayName })),
                ]}
                triggerClassName="w-full bg-white/5 border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] text-left flex items-center justify-between outline-none hover:bg-[#2e2e36]"
              />
            </div>
          ) : null}
          {canWrite ? (
            <>
              <button
                type="button"
                disabled={saving || user.status === 'disabled'}
                onClick={() => void handlePatch({ status: 'disabled' })}
                className="px-3 py-2 rounded-xl border border-[#dc6b6b] bg-[#3a1818] text-[10px] text-red-200 disabled:opacity-40"
              >
                禁用
              </button>
              <button
                type="button"
                disabled={saving || user.status === 'active'}
                onClick={() => void handlePatch({ status: 'active' })}
                className="px-3 py-2 rounded-xl border border-[#34d399] bg-[#0d2818] text-[10px] text-emerald-200 disabled:opacity-40"
              >
                启用
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#252528]">
          <div className="flex gap-1.5">
            {canAudit ? (
              <button
                type="button"
                onClick={() => setTab('audit')}
                className={`px-3 py-1.5 rounded-lg text-[10px] border ${
                  tab === 'audit'
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                    : 'border-[#2e2e32] bg-[#1c1c22] text-gray-400'
                }`}
              >
                平台审计
              </button>
            ) : null}
            {canTaskEvents ? (
              <button
                type="button"
                onClick={() => setTab('tasks')}
                className={`px-3 py-1.5 rounded-lg text-[10px] border ${
                  tab === 'tasks'
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                    : 'border-[#2e2e32] bg-[#1c1c22] text-gray-400'
                }`}
              >
                任务执行
              </button>
            ) : null}
          </div>
          {canAudit && tab === 'audit' ? (
            <button
              type="button"
              className="text-[10px] text-blue-300 hover:underline"
              onClick={() => navigateAdmin(adminAuditUrlForUser(user.id))}
            >
              在审计页查看全部
            </button>
          ) : null}
          {canTaskEvents && tab === 'tasks' ? (
            <button
              type="button"
              className="text-[10px] text-blue-300 hover:underline"
              onClick={() => navigateAdmin(adminTaskEventsUrlForUser(user.id))}
            >
              在任务页查看全部
            </button>
          ) : null}
        </div>

        {tab === 'audit' && canAudit ? (
          auditLoading ? (
            <p className="px-4 py-6 text-[11px] text-gray-500">加载审计…</p>
          ) : (
            <ul className="divide-y divide-[#252528]">
              {auditLogs.map((item) => (
                <li key={item.id} className="px-4 py-3 text-[11px]">
                  <p className="text-gray-500 text-[10px]">{new Date(item.createdAt).toLocaleString()}</p>
                  <p className="text-gray-300 mt-1">
                    <span className="text-gray-500">{auditActionLabel(item.action)} · </span>
                    {auditLogSummary({
                      action: item.action,
                      actorIdentifier: item.actorIdentifier,
                      targetUserId: item.targetUserId,
                      meta: item.meta,
                    })}
                  </p>
                </li>
              ))}
              {!auditLogs.length ? <li className="px-4 py-6 text-[11px] text-gray-500">暂无相关审计</li> : null}
            </ul>
          )
        ) : null}

        {tab === 'tasks' && canTaskEvents ? (
          tasksLoading ? (
            <p className="px-4 py-6 text-[11px] text-gray-500">加载任务记录…</p>
          ) : tasksError ? (
            <p className="px-4 py-6 text-[11px] text-red-400">{tasksError}</p>
          ) : (
            <ul className="divide-y divide-[#252528]">
              {taskEvents.map((item) => (
                <li key={`${item.source}:${item.id}`} className="px-4 py-3 text-[11px]">
                  <div className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${taskEventLevelDot(item.level)}`} />
                    {new Date(item.ts).toLocaleString()} · {taskEventCodeLabel(item.code)}
                  </div>
                  <p className="text-gray-300 mt-1">{taskEventSummary(item)}</p>
                </li>
              ))}
              {!taskEvents.length ? (
                <li className="px-4 py-6 text-[11px] text-gray-500">暂无任务执行记录</li>
              ) : null}
            </ul>
          )
        ) : null}

        {!canAudit && tab === 'audit' ? (
          <p className="px-4 py-6 text-[11px] text-gray-500">无审计查看权限</p>
        ) : null}
      </div>
    </div>
  );
};

export default AdminUserDetailPanel;
