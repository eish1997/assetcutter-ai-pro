import React, { useCallback } from 'react';
import {
  STORYBOARD_EDIT_CANVAS_FILTER_PILLS,
  type StoryboardEditCanvasFilterCounts,
  type StoryboardEditCanvasFilterPill,
} from '../../services/storyboardEditCanvasFilter';

type Props = {
  activePill: StoryboardEditCanvasFilterPill;
  counts: StoryboardEditCanvasFilterCounts;
  total: number;
  matchCount: number;
  onChange: (pill: StoryboardEditCanvasFilterPill) => void;
};

function pillCount(
  id: Exclude<StoryboardEditCanvasFilterPill, 'all'>,
  counts: StoryboardEditCanvasFilterCounts
): number {
  return counts[id];
}

export default function StoryboardEditCanvasFilterBar({
  activePill,
  counts,
  total,
  matchCount,
  onChange,
}: Props) {
  const handlePillClick = useCallback(
    (pill: StoryboardEditCanvasFilterPill) => {
      onChange(activePill === pill && pill !== 'all' ? 'all' : pill);
    },
    [activePill, onChange]
  );

  const statLabel =
    activePill === 'all' ? `共 ${total} 镜` : `命中 ${matchCount} / 总计 ${total}`;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          role="group"
          aria-label="画板筛选"
        >
          <FilterPillButton
            label="全部"
            active={activePill === 'all'}
            onClick={() => handlePillClick('all')}
          />
          {STORYBOARD_EDIT_CANVAS_FILTER_PILLS.map((pill) => {
            const count = pillCount(pill.id, counts);
            return (
              <FilterPillButton
                key={pill.id}
                label={pill.label}
                count={count}
                active={activePill === pill.id}
                dimmed={count === 0}
                onClick={() => handlePillClick(pill.id)}
              />
            );
          })}
        </div>
        <span className="shrink-0 text-[9px] tabular-nums text-gray-500">{statLabel}</span>
      </div>
    </div>
  );
}

function FilterPillButton({
  label,
  count,
  active,
  dimmed = false,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[9px] font-medium transition ${
        active
          ? 'border-white/20 bg-white/[0.12] text-gray-100 ring-1 ring-white/15'
          : dimmed
            ? 'border-white/[0.04] bg-transparent text-gray-600 hover:border-white/10 hover:text-gray-400'
            : 'border-white/[0.06] bg-white/[0.03] text-gray-300 hover:border-white/12 hover:bg-white/[0.06]'
      }`}
    >
      <span>{label}</span>
      {count != null ? (
        <span className={`tabular-nums ${active ? 'text-gray-200' : 'text-gray-500'}`}>
          ·{count}
        </span>
      ) : null}
    </button>
  );
}
