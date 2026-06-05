import React from 'react';
import {
  fetchAuditLogs,
  fetchAuditLogsMeta,
  fetchAuditQuickStats,
  downloadAuditLogsCsv,
  type AuditLogsQuery,
  type AuditQuickStats,
  type AuditRetentionMeta,
} from '../../services/adminClient';
import { AUDITOR_ROLE_SLUG } from '../../services/adminPermissions';
import { blockIfRolePreview } from '../../services/adminRolePreview';
import { useAdminStaff } from './AdminStaffContext';
import { auditActionLabel, AUDIT_ACTION_LABELS } from '../../services/adminMatrix';
import { AUDIT_CATEGORY_TABS, filterActionOptionsForCategory, type AuditLogCategory } from '../../services/auditLogCategory';
import { auditActionSeverity, AUDIT_SEVERITY_DOT, loginSuccessExcludeParam } from '../../services/auditActionSeverity';
import { auditLogSummary } from '../../services/auditLogSummary';
import {
  AUDIT_TIME_PRESETS,
  isoToDatetimeLocal,
  resolveAuditTimeRange,
  type AuditTimePreset,
} from '../../services/auditLogTimeRange';
import { CustomDropdown } from '../ui/CustomDropdown';
import AuditLogDetailDrawer, { type AuditLogDetail } from './AuditLogDetailDrawer';

type AuditLog = AuditLogDetail;

const PAGE_SIZE = 50;

type AuditFilters = {
  category: AuditLogCategory;
  timePreset: AuditTimePreset;
  customFrom: string;
  customTo: string;
  action: string;
  actor: string;
  targetUserId: string;
  hideLoginSuccess: boolean;
};

function defaultFilters(): AuditFilters {
  const range = resolveAuditTimeRange('7d', '', '');
  return {
    category: 'all',
    timePreset: '7d',
    customFrom: isoToDatetimeLocal(range.from),
    customTo: isoToDatetimeLocal(range.to),
    action: '',
    actor: '',
    targetUserId: '',
    hideLoginSuccess: true,
  };
}

function filtersToQuery(filters: AuditFilters, cursor?: string): AuditLogsQuery {
  const { from, to } = resolveAuditTimeRange(filters.timePreset, filters.customFrom, filters.customTo);
  const q: AuditLogsQuery = {
    limit: PAGE_SIZE,
    action: filters.action || undefined,
    actor: filters.actor.trim() || undefined,
    targetUserId: filters.targetUserId.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    category: filters.category === 'all' ? undefined : filters.category,
    excludeActions: filters.hideLoginSuccess ? loginSuccessExcludeParam() : undefined,
  };
  if (cursor) q.cursor = cursor;
  return q;
}

function readTargetUserIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('targetUserId')?.trim() || '';
}

const ActionBadge: React.FC<{ action: string }> = ({ action }) => {
  const severity = auditActionSeverity(action);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${AUDIT_SEVERITY_DOT[severity]}`} />
      <span>{auditActionLabel(action)}</span>
    </span>
  );
};

const AdminAuditLogsPanel: React.FC = () => {
  const { can, staffRole, isRolePreview } = useAdminStaff();
  const isAuditor = staffRole?.slug === AUDITOR_ROLE_SLUG;
  const [draft, setDraft] = React.useState<AuditFilters>(() => {
    const base = defaultFilters();
    const target = readTargetUserIdFromUrl();
    return target ? { ...base, targetUserId: target } : base;
  });
  const [applied, setApplied] = React.useState<AuditFilters>(() => {
    const base = defaultFilters();
    const target = readTargetUserIdFromUrl();
    return target ? { ...base, targetUserId: target } : base;
  });
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [total, setTotal] = React.useState(0);
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [redactedView, setRedactedView] = React.useState(false);
  const [retention, setRetention] = React.useState<AuditRetentionMeta | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [selectedLog, setSelectedLog] = React.useState<AuditLog | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [exportHint, setExportHint] = React.useState('');
  const [stats, setStats] = React.useState<AuditQuickStats | null>(null);
  const [statsLoading, setStatsLoading] = React.useState(false);

  const actionOptions = React.useMemo(
    () => filterActionOptionsForCategory(Object.entries(AUDIT_ACTION_LABELS), draft.category),
    [draft.category]
  );

  const appliedRange = React.useMemo(() => {
    const { from, to } = resolveAuditTimeRange(applied.timePreset, applied.customFrom, applied.customTo);
    return { from, to };
  }, [applied]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAuditLogs(filtersToQuery(applied, cursor));
      setLogs(res.logs as AuditLog[]);
      setTotal(res.total ?? res.logs.length);
      setNextCursor(res.nextCursor ?? null);
      setRedactedView(Boolean(res.redacted));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [applied, cursor]);

  React.useEffect(() => {
    void fetchAuditLogsMeta()
      .then((m) => setRetention(m.retention))
      .catch(() => setRetention(null));
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    void fetchAuditQuickStats({ from: appliedRange.from, to: appliedRange.to })
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedRange.from, appliedRange.to]);

  const resetPagination = React.useCallback(() => {
    setCursor(undefined);
    setCursorStack([]);
    setNextCursor(null);
  }, []);

  const applyFilters = React.useCallback(
    (next: AuditFilters, resetPage = true) => {
      setApplied(next);
      if (resetPage) resetPagination();
    },
    [resetPagination]
  );

  const runQuery = () => {
    applyFilters(draft);
  };

  const handleCategoryTab = (category: AuditLogCategory) => {
    const next = { ...draft, category, action: '' };
    setDraft(next);
    applyFilters(next);
  };

  const handleTimePreset = (preset: AuditTimePreset) => {
    const range = resolveAuditTimeRange(preset, draft.customFrom, draft.customTo);
    setDraft((prev) => ({
      ...prev,
      timePreset: preset,
      customFrom: preset === 'custom' ? prev.customFrom : isoToDatetimeLocal(range.from),
      customTo: preset === 'custom' ? prev.customTo : isoToDatetimeLocal(range.to),
    }));
  };

  const applyStatFilter = (patch: Partial<AuditFilters>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    applyFilters(next);
  };

  const filterByTarget = (userId: string) => {
    const next = { ...draft, targetUserId: userId };
    setDraft(next);
    applyFilters(next);
    setSelectedLog(null);
  };

  const exportQuery = React.useMemo(() => filtersToQuery(applied), [applied]);

  const page = cursorStack.length + 1;
  const canPrev = cursorStack.length > 0;
  const canNext = Boolean(nextCursor);

  const renderLogRow = (item: AuditLog) => {
    const summary = auditLogSummary({
      action: item.action,
      actorIdentifier: item.actorIdentifier,
      targetUserId: item.targetUserId,
      meta: item.meta,
    });
    return (
      <tr
        key={item.id}
        className="border-t border-[#252528] hover:bg-[#151518]/60 cursor-pointer"
        onClick={() => setSelectedLog(item)}
      >
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td>
        <td className="px-3 py-2 text-gray-200 leading-relaxed">{summary}</td>
        <td className="px-3 py-2 text-gray-400" title={item.action}>
          <ActionBadge action={item.action} />
        </td>
        <td className="px-3 py-2 text-gray-300">{item.actorIdentifier || '—'}</td>
        <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{item.ip || '—'}</td>
      </tr>
    );
  };

  const renderLogCard = (item: AuditLog) => {
    const summary = auditLogSummary({
      action: item.action,
      actorIdentifier: item.actorIdentifier,
      targetUserId: item.targetUserId,
      meta: item.meta,
    });
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setSelectedLog(item)}
        className="w-full text-left px-3 py-3 border-t border-[#252528] hover:bg-[#151518]/60 space-y-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <ActionBadge action={item.action} />
          <span className="text-[10px] text-gray-500 shrink-0">{new Date(item.createdAt).toLocaleString()}</span>
        </div>
        <p className="text-[11px] text-gray-200 leading-relaxed">{summary}</p>
        <p className="text-[10px] text-gray-500">
          {item.actorIdentifier || '—'} · {item.ip || '—'}
        </p>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          {
            label: '后台操作',
            value: stats?.adminOps,
            onClick: () => applyStatFilter({ category: 'admin', action: '', hideLoginSuccess: true }),
          },
          {
            label: '登录失败',
            value: stats?.loginFailed,
            onClick: () => applyStatFilter({ category: 'auth', action: 'auth.login_failed', hideLoginSuccess: false }),
          },
          {
            label: '发行/限流',
            value: stats?.releaseOps,
            onClick: () => applyStatFilter({ category: 'release', action: '', hideLoginSuccess: true }),
          },
        ].map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={card.onClick}
            className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 text-left hover:border-[#3b82f6]/40 hover:bg-[#151518] transition-colors"
          >
            <p className="text-[10px] uppercase tracking-wider text-gray-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{statsLoading ? '…' : card.value ?? '—'}</p>
            <p className="mt-1 text-[10px] text-gray-600">当前时间范围内 · 点击筛选</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-300">审计日志</h2>
            <p className="mt-1 text-[10px] text-gray-600">默认近 7 天并隐藏登录成功；修改筛选后点「查询」</p>
            {redactedView ? (
              <p className="mt-1 text-[10px] text-amber-500/90">当前为审计员脱敏视图（IP / meta 等已掩码）</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void (async () => {
                  if (blockIfRolePreview(isRolePreview)) return;
                  setExporting(true);
                  setExportHint('');
                  try {
                    const result = await downloadAuditLogsCsv(exportQuery);
                    setExportHint(
                      result.truncated
                        ? `已导出 ${result.rows} 条（共 ${result.total} 条，超出上限已截断）${result.redacted ? ' · 脱敏版' : ''}`
                        : `已导出 ${result.rows} 条${result.redacted ? ' · 脱敏版' : ''}`
                    );
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '导出失败');
                  } finally {
                    setExporting(false);
                  }
                })();
              }}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] hover:bg-[#2e2e36] disabled:opacity-50"
            >
              {exporting ? '导出中…' : isAuditor ? '导出 CSV（脱敏）' : '导出 CSV'}
            </button>
            <button
              type="button"
              onClick={() => {
                void load();
              }}
              className="px-3 py-2 rounded-xl border border-[#2e2e32] bg-[#1c1c22] text-[10px] hover:bg-[#2e2e36]"
            >
              刷新
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {AUDIT_CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleCategoryTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] border ${
                applied.category === tab.id
                  ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                  : 'border-[#2e2e32] bg-[#1c1c22] text-gray-400 hover:bg-[#2e2e36]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {AUDIT_TIME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleTimePreset(preset.id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] border ${
                draft.timePreset === preset.id
                  ? 'border-[#4b5563] bg-[#2e2e36] text-gray-200'
                  : 'border-[#2e2e32] bg-[#1c1c22] text-gray-500 hover:bg-[#252528]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {draft.timePreset === 'custom' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] text-gray-500">
              起始
              <input
                type="datetime-local"
                value={draft.customFrom}
                onChange={(e) => setDraft((p) => ({ ...p, customFrom: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              />
            </label>
            <label className="text-[10px] text-gray-500">
              结束
              <input
                type="datetime-local"
                value={draft.customTo}
                onChange={(e) => setDraft((p) => ({ ...p, customTo: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[11px] text-white outline-none focus:border-[#3b82f6]"
              />
            </label>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <CustomDropdown
            value={draft.action}
            onChange={(v) => setDraft((p) => ({ ...p, action: v }))}
            options={actionOptions}
            triggerClassName="w-full bg-white/5 border border-[#2e2e32] rounded-xl px-3 py-2 text-[11px] text-left flex items-center justify-between outline-none hover:bg-[#2e2e36]"
          />
          <input
            type="text"
            value={draft.actor}
            onChange={(e) => setDraft((p) => ({ ...p, actor: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runQuery();
            }}
            placeholder="操作者关键词"
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[12px] text-white placeholder-gray-500 outline-none focus:border-[#3b82f6]"
          />
          <input
            type="text"
            value={draft.targetUserId}
            onChange={(e) => setDraft((p) => ({ ...p, targetUserId: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runQuery();
            }}
            placeholder="目标用户 ID"
            className="rounded-xl border border-[#343438] bg-[#1c1c22] px-3 py-2 text-[12px] text-white placeholder-gray-500 outline-none focus:border-[#3b82f6]"
          />
          <button
            type="button"
            onClick={runQuery}
            className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200 hover:bg-blue-500/20"
          >
            查询
          </button>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-gray-400">
          <input
            type="checkbox"
            checked={draft.hideLoginSuccess}
            onChange={(e) => {
              const next = { ...draft, hideLoginSuccess: e.target.checked };
              setDraft(next);
              applyFilters(next);
            }}
          />
          隐藏登录成功（减少认证噪声）
        </label>
        {exportHint ? <p className="text-[10px] text-emerald-400/90">{exportHint}</p> : null}
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {loading ? (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 text-[11px] text-gray-400">加载日志中…</div>
      ) : (
        <div className="rounded-2xl border border-[#2e2e32] bg-[#121214] overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#151518] text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 w-[140px]">时间</th>
                  <th className="text-left px-3 py-2">摘要</th>
                  <th className="text-left px-3 py-2 w-[120px]">动作</th>
                  <th className="text-left px-3 py-2 w-[120px]">操作者</th>
                  <th className="text-left px-3 py-2 w-[100px]">IP</th>
                </tr>
              </thead>
              <tbody>{logs.map(renderLogRow)}</tbody>
            </table>
          </div>
          <div className="md:hidden">{logs.map(renderLogCard)}</div>
          {!logs.length ? <p className="px-3 py-4 text-[11px] text-gray-500">暂无日志</p> : null}
          <div className="flex items-center justify-between px-3 py-3 border-t border-[#252528] text-[10px] text-gray-500">
            <span>
              共 {total} 条 · 第 {page} 页
              {retention ? ` · ${retention.note}` : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => {
                  setCursorStack((stack) => {
                    if (!stack.length) return stack;
                    const prev = stack[stack.length - 1];
                    setCursor(prev || undefined);
                    return stack.slice(0, -1);
                  });
                }}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => {
                  if (!nextCursor) return;
                  setCursorStack((stack) => [...stack, cursor ?? '']);
                  setCursor(nextCursor);
                }}
                className="px-2 py-1 rounded border border-[#2e2e32] disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      <AuditLogDetailDrawer
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        onFilterTarget={filterByTarget}
      />
    </div>
  );
};

export default AdminAuditLogsPanel;
