import React from 'react';
import {
  fetchUserUsageEvents,
  fetchUserUsageSummary,
  fmtUsageSummaryCost,
  userUsageExportUrl,
  type UsageSummarySlice,
  type UserUsageSummary,
} from '../../services/usageApi';
import type { UsageEventRow } from '../../services/adminClient';
import {
  AUDIT_TIME_PRESETS,
  isoToDatetimeLocal,
  resolveAuditTimeRange,
  type AuditTimePreset,
} from '../../services/auditLogTimeRange';
import { CustomDropdown } from '../ui/CustomDropdown';
import UsageEventsGroupedTable from '../usage/UsageEventsGroupedTable';

const PAGE_SIZE = 40;

const EMPTY_SLICE: UsageSummarySlice = {
  eventCount: 0,
  totalQuantity: 0,
  totalCostUsdEst: 0,
  bySku: [],
};

function normalizeSummary(raw: UserUsageSummary): UserUsageSummary {
  return {
    ...EMPTY_SLICE,
    ...raw,
    today: { ...EMPTY_SLICE, ...(raw.today || {}) },
    month: { ...EMPTY_SLICE, ...(raw.month || {}) },
  };
}

type Filters = {
  timePreset: AuditTimePreset;
  customFrom: string;
  customTo: string;
  projectId: string;
};

function defaultFilters(projectId?: string): Filters {
  const range = resolveAuditTimeRange('30d', '', '');
  return {
    timePreset: '30d',
    customFrom: isoToDatetimeLocal(range.from),
    customTo: isoToDatetimeLocal(range.to),
    projectId: projectId?.trim() || '',
  };
}

function SummaryTiles({ title, data }: { title: string; data: UsageSummarySlice }) {
  return (
    <div className="rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3">
      <p className="text-[10px] text-gray-500 mb-1">{title}</p>
      <p className="text-[13px] text-white font-medium">{data.eventCount} 次</p>
      <p className="text-[10px] text-amber-500/90 mt-0.5">估算 {fmtUsageSummaryCost(data.totalCostUsdEst, data.eventCount)}</p>
    </div>
  );
}

const UsageSettingsPanel: React.FC<{
  userId?: string | null;
  activeProjectId?: string | null;
}> = ({ userId = null, activeProjectId = null }) => {
  const [draft, setDraft] = React.useState<Filters>(() => defaultFilters(activeProjectId || undefined));
  /** 首次查询不过滤项目：事件可能尚未写入 projectId，避免打开页即空白 */
  const [applied, setApplied] = React.useState<Filters>(() => defaultFilters(undefined));
  const [summary, setSummary] = React.useState<UserUsageSummary | null>(null);
  const [events, setEvents] = React.useState<UsageEventRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState<string | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loadedOnce, setLoadedOnce] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!userId) {
      setSummary(null);
      setEvents([]);
      setTotal(0);
      setNextCursor(null);
      setLoading(false);
      setError('');
      setLoadedOnce(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { from, to } = resolveAuditTimeRange(applied.timePreset, applied.customFrom, applied.customTo);
      const projectId = applied.projectId.trim() || undefined;
      const [sumRes, listRes] = await Promise.all([
        fetchUserUsageSummary({ from: from || undefined, to: to || undefined, projectId }),
        fetchUserUsageEvents({
          limit: PAGE_SIZE,
          from: from || undefined,
          to: to || undefined,
          projectId,
          cursor,
        }),
      ]);
      setSummary(normalizeSummary(sumRes));
      const rows = Array.isArray(listRes?.events) ? listRes.events : [];
      setEvents(rows);
      setTotal(listRes?.total ?? rows.length);
      setNextCursor(listRes?.nextCursor ?? null);
      setLoadedOnce(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
      setEvents([]);
      setTotal(0);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [applied, cursor, userId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const exportHref = React.useMemo(() => {
    const { from, to } = resolveAuditTimeRange(applied.timePreset, applied.customFrom, applied.customTo);
    return userUsageExportUrl({
      from: from || undefined,
      to: to || undefined,
      projectId: applied.projectId.trim() || undefined,
    });
  }, [applied]);

  return (
    <section id="settings-usage" className="scroll-mt-4 rounded-2xl border border-[#2e2e32] bg-[#121214] p-6 space-y-4">
      <div>
        <h2 className="text-xs font-black uppercase tracking-wider text-blue-400/90">AI 用量</h2>
        <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
          记录经本站代理的 Gemini、Tripo 建任务等工作流 AI 调用。自带 API Key 仅记次数不计价；金额为官方价估算，非账单。
          默认显示<strong className="text-gray-400">全部项目</strong>；可在下方填入当前工作区项目 ID 缩小范围。
        </p>
      </div>

      {!userId ? (
        <p className="text-[11px] text-gray-500">登录后可查看个人用量明细。</p>
      ) : (
        <p className="text-[10px] text-gray-600 font-mono truncate" title={userId}>
          当前账号 {userId.slice(0, 8)}…（仅显示本账号记录；管理端可见全部用户）
        </p>
      )}

      {loadedOnce && summary ? (
        <div className="grid grid-cols-3 gap-2">
          <SummaryTiles title="今日" data={summary.today} />
          <SummaryTiles title="本月" data={summary.month} />
          <SummaryTiles title="筛选范围内" data={summary} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 items-end rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3">
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          时间
          <CustomDropdown
            value={draft.timePreset}
            options={AUDIT_TIME_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(v) => setDraft((d) => ({ ...d, timePreset: v as AuditTimePreset }))}
            triggerClassName="bg-white/5 border border-[#2e2e32] rounded-lg px-2 py-1.5 text-[11px] text-gray-200 min-w-[120px]"
          />
        </label>
        <label className="text-[10px] text-gray-500 flex flex-col gap-1">
          项目 ID（可选）
          <input
            value={draft.projectId}
            onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
            placeholder="工作区项目 id"
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-[#2e2e32] text-[11px] text-gray-200 w-44"
          />
        </label>
        <button
          type="button"
          disabled={!userId}
          onClick={() => {
            setCursor(undefined);
            setApplied(draft);
          }}
          className="px-3 py-1.5 rounded-lg bg-white/10 text-[11px] text-gray-200 hover:bg-white/15 disabled:opacity-40"
        >
          查询
        </button>
        {userId ? (
          <a
            href={exportHref}
            className="px-3 py-1.5 rounded-lg border border-[#2e2e32] text-[11px] text-gray-400 hover:text-gray-200"
          >
            导出 CSV
          </a>
        ) : null}
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {!error && userId && !loading && events.length === 0 && applied.projectId.trim() ? (
        <p className="text-[11px] text-amber-500/90">
          当前按项目 ID「{applied.projectId.trim()}」筛选无结果。清空项目 ID 后点「查询」，或确认工作流任务已带上项目上下文。
        </p>
      ) : null}

      <div className="rounded-xl border border-[#2e2e32] overflow-hidden">
        <div className="px-3 py-2 border-b border-[#2e2e32] text-[10px] text-gray-500 flex justify-between">
          <span>明细 {total} 条</span>
          {loading ? <span>加载中…</span> : null}
        </div>
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <UsageEventsGroupedTable
            events={events}
            loading={loading}
            emptyMessage={
              userId
                ? '本账号暂无记录。请再执行一次工作流 AI 生图/生文（经本站代理）；管理端若能看到记录但此处为空，说明那些记录属于其他用户或测试数据。'
                : '请先登录。'
            }
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
    </section>
  );
};

export default UsageSettingsPanel;
