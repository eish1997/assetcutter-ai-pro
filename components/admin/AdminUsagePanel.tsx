import React from 'react';
import {
  fetchUsageEvents,
  fetchUsageSummary,
  type UsageEventRow,
  type UsageSummaryResponse,
} from '../../services/adminClient';
import { PERMISSIONS, hasAdminPermission } from '../../services/adminPermissions';
import { useAdminStaff } from './AdminStaffContext';
import {
  AUDIT_TIME_PRESETS,
  isoToDatetimeLocal,
  resolveAuditTimeRange,
  type AuditTimePreset,
} from '../../services/auditLogTimeRange';
import { CustomDropdown } from '../ui/CustomDropdown';
import UsageEventsGroupedTable from '../usage/UsageEventsGroupedTable';
import ObservabilityTraceDrawer from './ObservabilityTraceDrawer';
import { fmtUsageSummaryCredits, sliceCreditsTotal } from '../../services/usageApi';
import { fmtCredits } from '../../shared/credits';

const PAGE_SIZE = 50;

type UsageFilters = {
  timePreset: AuditTimePreset;
  customFrom: string;
  customTo: string;
  userId: string;
  billingSku: string;
  provider: string;
};

function defaultFilters(): UsageFilters {
  const range = resolveAuditTimeRange('7d', '', '');
  return {
    timePreset: '7d',
    customFrom: isoToDatetimeLocal(range.from),
    customTo: isoToDatetimeLocal(range.to),
    userId: '',
    billingSku: '',
    provider: '',
  };
}

function readUserIdFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('userId')?.trim() || '';
}

function filtersToQuery(filters: UsageFilters, cursor?: string) {
  const { from, to } = resolveAuditTimeRange(filters.timePreset, filters.customFrom, filters.customTo);
  return {
    limit: PAGE_SIZE,
    userId: filters.userId.trim() || undefined,
    billingSku: filters.billingSku.trim() || undefined,
    provider: filters.provider.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    cursor,
  };
}

const AdminUsagePanel: React.FC = () => {
  const { permissions } = useAdminStaff();
  const canRead = hasAdminPermission(permissions, PERMISSIONS.USAGE_READ);
  const [draft, setDraft] = React.useState<UsageFilters>(() => {
    const base = defaultFilters();
    const userId = readUserIdFromUrl();
    return userId ? { ...base, userId } : base;
  });
  const [applied, setApplied] = React.useState(draft);
  const [events, setEvents] = React.useState<UsageEventRow[]>([]);
  const [summary, setSummary] = React.useState<UsageSummaryResponse | null>(null);
  const [total, setTotal] = React.useState(0);
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [traceTaskId, setTraceTaskId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError('');
    try {
      const q = filtersToQuery(applied, cursor);
      const [listRes, sumRes] = await Promise.all([fetchUsageEvents(q), fetchUsageSummary(q)]);
      setEvents(listRes.events);
      setTotal(listRes.total ?? listRes.events.length);
      setNextCursor(listRes.nextCursor ?? null);
      setSummary(sumRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applied, cursor, canRead]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return <p className="text-[12px] text-gray-500 p-4">无 AI 用量查看权限。</p>;
  }

  return (
    <div className="space-y-4 p-4 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold text-white">AI 用量</h1>
        <p className="text-[11px] text-gray-500 mt-1">工作流 AI 调用记录；汇总与明细均为积分消耗。</p>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-[#2e2e32] bg-[#121214] p-3">
            <p className="text-[10px] text-gray-500">事件数</p>
            <p className="text-[14px] text-white font-medium">{summary.eventCount}</p>
          </div>
          <div className="rounded-xl border border-[#2e2e32] bg-[#121214] p-3">
            <p className="text-[10px] text-gray-500">积分消耗</p>
            <p className="text-[14px] text-amber-400 font-medium">
              {fmtUsageSummaryCredits(sliceCreditsTotal(summary), summary.eventCount)}
            </p>
          </div>
          <div className="rounded-xl border border-[#2e2e32] bg-[#121214] p-3 col-span-2">
            <p className="text-[10px] text-gray-500 mb-1">按 SKU</p>
            <p className="text-[10px] text-gray-400 truncate">
              {summary.bySku.length
                ? summary.bySku
                    .slice(0, 4)
                    .map((s) => `${s.billingSku} ×${s.count} ${fmtCredits(s.creditsCharged ?? 0)}`)
                    .join(' · ')
                : '—'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 items-end rounded-xl border border-[#2e2e32] bg-[#121214] p-3">
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          时间
          <CustomDropdown
            value={draft.timePreset}
            options={AUDIT_TIME_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(v) => setDraft((d) => ({ ...d, timePreset: v as AuditTimePreset }))}
            className="min-w-[120px]"
          />
        </label>
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          用户
          <input
            value={draft.userId}
            onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200 w-36"
            placeholder="userId / 用户名"
          />
        </label>
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          SKU
          <input
            value={draft.billingSku}
            onChange={(e) => setDraft((d) => ({ ...d, billingSku: e.target.value }))}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200 w-40"
            placeholder="llm.gemini.flash"
          />
        </label>
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          供货商
          <input
            value={draft.provider}
            onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200 w-28"
            placeholder="vertex"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setCursor(undefined);
            setApplied(draft);
          }}
          className="px-3 py-1.5 rounded-lg bg-white/10 text-[11px] text-gray-200 hover:bg-white/15"
        >
          查询
        </button>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#2e2e32] text-[10px] text-gray-500 flex justify-between">
          <span>共 {total} 条</span>
          {loading ? <span>加载中…</span> : null}
        </div>
        <div className="overflow-x-auto">
          <UsageEventsGroupedTable
            events={events}
            loading={loading}
            showUser
            showProvider
            showConfidence
            traceTaskHref={(taskId) =>
              taskId ? `/admin/task-events?taskId=${encodeURIComponent(taskId)}` : null
            }
            onOpenTrace={(taskId) => setTraceTaskId(taskId)}
            emptyMessage="暂无用量记录。请登录后执行工作流 AI 任务（走代理或 Tripo 建任务）。"
          />
        </div>
        {nextCursor ? (
          <div className="p-2 border-t border-[#2e2e32] flex justify-center">
            <button
              type="button"
              onClick={() => setCursor(nextCursor)}
              className="text-[10px] text-gray-400 hover:text-gray-200"
            >
              加载更多
            </button>
          </div>
        ) : null}
      </div>

      <ObservabilityTraceDrawer correlationId={traceTaskId} onClose={() => setTraceTaskId(null)} />
    </div>
  );
};

export default AdminUsagePanel;
