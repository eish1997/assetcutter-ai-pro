import React from 'react';
import {
  fetchUserUsageEvents,
  fetchUserUsageSummary,
  fmtUsageSummaryCredits,
  sliceCreditsTotal,
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
import { fetchCreditBalance, fetchCreditLedger } from '../../services/creditsApi';
import { fmtCredits, creditLedgerKindLabel, type CreditBalance, type CreditLedgerEntry } from '../../shared/credits';

const PAGE_SIZE = 40;

function currentUserLabel(userId: string): string {
  const id = String(userId || '').trim();
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

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
  const credits = sliceCreditsTotal(data);
  return (
    <div className="rounded-xl border border-[#2e2e32] bg-[#0f0f0f] p-3">
      <p className="text-[10px] text-gray-500 mb-1">{title}</p>
      <p className="text-[13px] text-white font-medium">{data.eventCount} 次</p>
      <p className="text-[10px] text-amber-400/90 mt-0.5">
        消耗 {fmtUsageSummaryCredits(credits, data.eventCount)} 积分
      </p>
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
  const [creditBalance, setCreditBalance] = React.useState<CreditBalance | null>(null);
  const [creditLedger, setCreditLedger] = React.useState<CreditLedgerEntry[]>([]);
  const [creditLedgerCursor, setCreditLedgerCursor] = React.useState<string | null>(null);
  const [creditLedgerLoading, setCreditLedgerLoading] = React.useState(false);
  const [last7dCredits, setLast7dCredits] = React.useState<number | null>(null);

  const loadCreditLedger = React.useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      if (!userId) {
        setCreditLedger([]);
        setCreditLedgerCursor(null);
        return;
      }
      setCreditLedgerLoading(true);
      try {
        const res = await fetchCreditLedger({ limit: 15, cursor: opts?.cursor || undefined });
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

  const load = React.useCallback(async () => {
    if (!userId) {
      setSummary(null);
      setEvents([]);
      setTotal(0);
      setNextCursor(null);
      setLoading(false);
      setError('');
      setCreditBalance(null);
      setLast7dCredits(null);
      setCreditLedger([]);
      setCreditLedgerCursor(null);
      setLoadedOnce(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { from, to } = resolveAuditTimeRange(applied.timePreset, applied.customFrom, applied.customTo);
      const projectId = applied.projectId.trim() || undefined;
      const range7d = resolveAuditTimeRange('7d', '', '');
      const [sumRes, listRes, balRes, sum7dRes] = await Promise.all([
        fetchUserUsageSummary({ from: from || undefined, to: to || undefined, projectId }),
        fetchUserUsageEvents({
          limit: PAGE_SIZE,
          from: from || undefined,
          to: to || undefined,
          projectId,
          cursor,
        }),
        fetchCreditBalance().catch(() => null),
        fetchUserUsageSummary({
          from: range7d.from || undefined,
          to: range7d.to || undefined,
          projectId,
        }).catch(() => null),
      ]);
      setCreditBalance(balRes);
      setLast7dCredits(sum7dRes ? sliceCreditsTotal(normalizeSummary(sum7dRes)) : null);
      setSummary(normalizeSummary(sumRes));
      const rows = Array.isArray(listRes?.events) ? listRes.events : [];
      setEvents(rows);
      setTotal(listRes?.total ?? rows.length);
      setNextCursor(listRes?.nextCursor ?? null);
      setLoadedOnce(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = raw.includes('管理后台')
        ? '无法加载个人用量，请刷新页面后重试。'
        : raw;
      setError(msg);
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

  React.useEffect(() => {
    void loadCreditLedger();
  }, [loadCreditLedger]);

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
          查看<strong className="text-gray-400">本账号</strong>经本站代理的 AI 调用记录与积分消耗（1 积分 ≈ $0.001 估算成本）。
          自带 API Key 的任务不计积分。可按时间范围筛选；项目 ID 可选，留空表示全部项目。
        </p>
      </div>

      {!userId ? (
        <p className="text-[11px] text-gray-500">登录后可查看个人用量明细。</p>
      ) : (
        <>
          {creditBalance ? (
            <>
              {creditBalance.balance <= 0 ? (
                <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 px-4 py-3 space-y-2">
                  <p className="text-[11px] font-medium text-rose-100/95">积分已用完</p>
                  <p className="text-[10px] text-rose-200/75 leading-relaxed">
                    经本站代理的 AI 任务（生图、视频、3D 等）将无法执行。请联系管理员发放积分；若已自带 Gemini API Key，可在设置中配置后跳过积分扣减。
                  </p>
                </div>
              ) : null}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <p className="text-[10px] text-gray-500">剩余 AI 积分</p>
                <p className="text-xl font-semibold text-amber-400/95 mt-0.5">{fmtCredits(creditBalance.balance)}</p>
                <p className="text-[10px] text-gray-600 mt-1">
                  累计消耗 {fmtCredits(creditBalance.lifetimeSpent)}
                  {last7dCredits != null ? ` · 近 7 天 ${fmtCredits(last7dCredits)}` : ''}
                  {' · 额度由管理员发放'}
                </p>
              </div>
            </>
          ) : null}
          {userId ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">积分流水</h3>
                {creditLedgerLoading ? <span className="text-[10px] text-gray-600">加载中…</span> : null}
              </div>
              {creditLedger.length ? (
                <div className="overflow-x-auto rounded-xl border border-[#2e2e32]">
                  <table className="w-full text-[10px]">
                    <thead className="bg-[#0f0f0f] text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-2 font-normal">时间</th>
                        <th className="text-left px-3 py-2 font-normal">类型</th>
                        <th className="text-right px-3 py-2 font-normal">变动</th>
                        <th className="text-right px-3 py-2 font-normal">余额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditLedger.map((row) => (
                        <tr key={row.id} className="border-t border-[#2e2e32]/60">
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[10px] text-gray-600">暂无积分流水。消耗记录会在 AI 任务成功后写入。</p>
              )}
              {creditLedgerCursor ? (
                <button
                  type="button"
                  disabled={creditLedgerLoading}
                  onClick={() => void loadCreditLedger({ append: true, cursor: creditLedgerCursor })}
                  className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-40"
                >
                  加载更多流水
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="text-[10px] text-gray-600">
            账号 {currentUserLabel(userId)} · 仅显示本人记录
          </p>
        </>
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
                ? '暂无 AI 用量记录。执行一次经本站代理的工作流任务（生图、生文、3D 等）后，消耗会出现在这里。'
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
