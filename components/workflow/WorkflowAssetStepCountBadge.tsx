import React from 'react';

type Props = {
  current: number;
  total: number;
  className?: string;
};

/** 工作区资产卡片角标：当前步 / 总步数（纯数字） */
export default function WorkflowAssetStepCountBadge({ current, total, className = '' }: Props) {
  if (!(total > 0)) return null;
  const safeCurrent = Math.min(Math.max(1, current), total);
  return (
    <span
      className={`pointer-events-none absolute bottom-2 left-2 z-[3] rounded-md bg-black/78 px-1 py-px text-[8px] font-black tabular-nums leading-none text-gray-100/95 ring-1 ring-white/12 ${className}`}
    >
      {safeCurrent}/{total}
    </span>
  );
}
