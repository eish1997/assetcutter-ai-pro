import React from 'react';
import type { StoryboardFeedbackRedrawBatchRecord } from '../../services/storyboardFeedbackSheetRedraw';

type Props = {
  records: StoryboardFeedbackRedrawBatchRecord[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  busy?: boolean;
};

export default function StoryboardFeedbackRedrawHistoryBar({
  records,
  selectedId,
  onSelect,
  busy = false,
}: Props) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-semibold text-gray-500">反馈改图记录</span>
      {records.length === 0 ? (
        <span className="shrink-0 text-[10px] text-gray-600">暂无，拼图改图后出现在此</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {records.map((record) => {
            const active = selectedId === record.id;
            const statusTone =
              record.status === 'running'
                ? 'text-violet-300 ring-violet-400/35 bg-violet-500/12'
                : record.status === 'failed'
                  ? 'text-rose-300/90 ring-rose-400/30 bg-rose-500/10'
                  : record.status === 'partial'
                    ? 'text-amber-300/90 ring-amber-400/30 bg-amber-500/10'
                    : active
                      ? 'text-sky-200 ring-sky-400/40 bg-sky-500/15'
                      : 'text-gray-300 ring-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07]';

            return (
              <button
                key={record.id}
                type="button"
                title={`${record.rowIds.length} 镜${
                  record.matchedCount != null ? ` · 回填 ${record.matchedCount}` : ''
                }`}
                disabled={busy && record.status === 'running'}
                onClick={() => onSelect(active ? null : record.id)}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[10px] font-semibold ring-1 transition ${statusTone}`}
              >
                {record.status === 'running' ? (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                ) : null}
                {record.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
