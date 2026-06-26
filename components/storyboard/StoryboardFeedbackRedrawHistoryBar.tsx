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
  if (records.length === 0) {
    return (
      <p className="px-0.5 text-[10px] leading-snug text-gray-600">暂无，拼图改图后出现在此</p>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5 px-0.5">
      {records.map((record) => {
        const active = selectedId === record.id;
        const statusTone =
          record.status === 'running'
            ? 'text-gray-300 ring-white/18 bg-white/[0.08]'
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
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/70" />
            ) : null}
            {record.label}
          </button>
        );
      })}
    </div>
  );
}
