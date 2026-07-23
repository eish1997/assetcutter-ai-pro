import React from 'react';

type Props = {
  current: number;
  total: number;
  className?: string;
  compact?: boolean;
};

/** 工作区资产卡片角标：当前步 / 总步数（纯数字） */
export default function WorkflowAssetStepCountBadge({ current, total, className = '', compact = false }: Props) {
  if (!(total > 0)) return null;
  const safeCurrent = Math.min(Math.max(1, current), total);
  if (compact) {
    return (
      <span
        className={`pointer-events-none absolute bottom-0.5 right-0.5 z-[3] inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] bg-black/55 px-0.5 text-[6px] font-black tabular-nums leading-none text-gray-100/90 ring-1 ring-white/10 ${className}`}
        title={`${safeCurrent}/${total}`}
      >
        {safeCurrent}
      </span>
    );
  }
  return (
    <span
      className={`pointer-events-none absolute bottom-1 right-1 z-[3] inline-flex h-4 min-w-4 items-center justify-center rounded bg-black/60 px-1 text-[7px] font-black tabular-nums leading-none text-gray-100/90 ring-1 ring-white/10 ${className}`}
    >
      {safeCurrent}
    </span>
  );
}
