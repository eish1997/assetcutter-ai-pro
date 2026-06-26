import React, { useCallback } from 'react';
import {
  STORYBOARD_EDIT_CANVAS_FILTER_PILLS,
  type StoryboardEditCanvasFilterCounts,
  type StoryboardEditCanvasFilterPill,
} from '../../services/storyboardEditCanvasFilter';
import {
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_VIEW_TOGGLE_ACTIVE,
  STORYBOARD_VIEW_TOGGLE_BTN,
  STORYBOARD_VIEW_TOGGLE_IDLE,
} from './storyboardTableUi';

type Props = {
  activePill: StoryboardEditCanvasFilterPill;
  counts: StoryboardEditCanvasFilterCounts;
  total: number;
  matchCount: number;
  onChange: (pill: StoryboardEditCanvasFilterPill) => void;
  /** 统计文案由外层标题行展示时设为 true */
  hideStat?: boolean;
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
  hideStat = false,
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
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <div
        className={`${STORYBOARD_VIEW_TOGGLE} min-w-0 max-w-full flex-1 flex-wrap`}
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
      {hideStat ? null : (
        <span className="shrink-0 text-[9px] tabular-nums text-gray-500">{statLabel}</span>
      )}
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
      className={`${STORYBOARD_VIEW_TOGGLE_BTN} inline-flex shrink-0 items-center gap-1 ${
        active ? STORYBOARD_VIEW_TOGGLE_ACTIVE : STORYBOARD_VIEW_TOGGLE_IDLE
      } ${dimmed && !active ? 'opacity-55' : ''}`}
    >
      <span>{label}</span>
      {count != null ? (
        <span className={`tabular-nums text-[9px] ${active ? 'text-gray-300' : 'text-gray-500'}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
