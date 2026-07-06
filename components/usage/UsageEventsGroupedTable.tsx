import React from 'react';
import type { UsageEventRow } from '../../services/adminClient';
import {
  fmtUsageEventCredits,
  fmtUsageGroupCredits,
  groupUsageEventsByTask,
} from '../../services/usageApi';

type UsageEventsGroupedTableProps = {
  events: UsageEventRow[];
  loading?: boolean;
  emptyMessage: string;
  showUser?: boolean;
  showProvider?: boolean;
  showConfidence?: boolean;
  /** 管理端：任务 ID → 任务执行页深链 */
  traceTaskHref?: (taskId: string) => string | null;
  /** 管理端：打开 Trace 侧栏 */
  onOpenTrace?: (taskId: string) => void;
};

function shortId(id: string, max = 10): string {
  const s = String(id || '').trim();
  if (!s) return '—';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

const UsageEventsGroupedTable: React.FC<UsageEventsGroupedTableProps> = ({
  events,
  loading = false,
  emptyMessage,
  showUser = false,
  showProvider = false,
  showConfidence = false,
  traceTaskHref,
  onOpenTrace,
}) => {
  const groups = React.useMemo(() => groupUsageEventsByTask(events), [events]);
  const colCount = 4 + (showUser ? 1 : 0) + (showProvider ? 1 : 0);

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-[#121214]">
        <tr className="text-left text-gray-500 border-b border-[#2e2e32]">
          <th className="px-3 py-2 font-normal">任务 ID</th>
          <th className="px-3 py-2 font-normal">时间</th>
          {showUser ? <th className="px-3 py-2 font-normal">用户</th> : null}
          <th className="px-3 py-2 font-normal">SKU</th>
          <th className="px-3 py-2 font-normal text-right">积分消耗</th>
          {showProvider ? <th className="px-3 py-2 font-normal">供货商</th> : null}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const rowSpan = group.events.length;
          const multi = rowSpan > 1;
          return group.events.map((ev, idx) => (
            <tr
              key={ev.id}
              className={`border-b border-[#2e2e32]/50 ${multi ? 'bg-white/[0.01]' : ''}`}
            >
              {idx === 0 ? (
                <td
                  rowSpan={rowSpan}
                  className="px-3 py-2 align-top border-r border-[#2e2e32]/40 bg-[#0f0f0f]/60"
                >
                  <p
                    className="text-gray-200 font-mono text-[9px] break-all leading-snug"
                    title={group.displayTaskId}
                  >
                    {shortId(group.displayTaskId, 14)}
                  </p>
                  {multi ? (
                    <p className="text-[9px] text-gray-500 mt-1">{rowSpan} 次请求</p>
                  ) : null}
                  <p className="text-[9px] text-amber-400/90 mt-1">
                    合计 {fmtUsageGroupCredits(group.events)}
                  </p>
                  {traceTaskHref && group.displayTaskId && group.displayTaskId !== '—' ? (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {onOpenTrace ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenTrace(group.displayTaskId);
                          }}
                          className="text-[9px] text-blue-400/90 hover:text-blue-300"
                        >
                          Trace
                        </button>
                      ) : null}
                      <a
                        href={traceTaskHref(group.displayTaskId) || '#'}
                        className="text-[9px] text-emerald-400/90 hover:text-emerald-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        执行记录 →
                      </a>
                    </div>
                  ) : null}
                </td>
              ) : null}
              <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                {new Date(ev.createdAt).toLocaleString()}
              </td>
              {showUser ? (
                <td className="px-3 py-2 text-gray-300">{ev.username || ev.userId}</td>
              ) : null}
              <td className="px-3 py-2 text-gray-300 font-mono text-[10px]">{ev.billingSku}</td>
              <td className="px-3 py-2 text-amber-300/90 tabular-nums text-right">
                {fmtUsageEventCredits(ev)}
                {showConfidence ? (
                  <span className="block text-[8px] text-gray-600 font-normal">({ev.costConfidence})</span>
                ) : null}
              </td>
              {showProvider ? <td className="px-3 py-2 text-gray-500">{ev.provider}</td> : null}
            </tr>
          ));
        })}
        {!loading && events.length === 0 ? (
          <tr>
            <td colSpan={colCount} className="px-3 py-8 text-center text-gray-600">
              {emptyMessage}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
};

export default UsageEventsGroupedTable;
