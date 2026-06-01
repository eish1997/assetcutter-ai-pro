import React, { useMemo } from 'react';
import type { WorkflowAsset } from '../../types';
import {
  computeStoryboardTableStats,
  isWorkflowStoryboardTableAsset,
  storyboardTablePreviewImages,
  storyboardTableOutlineLabel,
} from '../../services/storyboardTableAsset';

type Props = {
  asset: WorkflowAsset;
  className?: string;
};

/** 工作区网格中的分镜表卡片封面 */
export default function StoryboardTableGridCard({ asset, className = '' }: Props) {
  const isTable = isWorkflowStoryboardTableAsset(asset);
  const stats = useMemo(() => {
    if (!isTable || !asset.storyboardTable) return null;
    return computeStoryboardTableStats(asset.storyboardTable);
  }, [asset.storyboardTable, isTable]);
  const previews = useMemo(
    () => (isTable ? storyboardTablePreviewImages(asset, 4) : []),
    [asset, isTable]
  );

  if (!isTable) return null;

  const title = storyboardTableOutlineLabel(asset).split(' · ')[0] ?? '分镜表';

  return (
    <div
      className={`relative flex h-full min-h-[10rem] w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-[#121212] to-[#0a0a0a] p-3 text-left ring-1 ring-inset ring-white/15 ${className}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/[0.06] blur-2xl" />

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.35)]" />
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-gray-300">分镜表</p>
          </div>
          <p className="mt-1.5 text-[12px] font-bold leading-snug text-gray-50 line-clamp-2">{title}</p>
        </div>
        <span className="shrink-0 rounded-lg bg-white/[0.10] px-2 py-1 text-[9px] font-black text-gray-100 ring-1 ring-white/15">
          {stats?.rowCount ?? 0} 镜
        </span>
      </div>

      <div className="relative mt-2 flex min-h-[5rem] flex-1 gap-1 overflow-hidden rounded-lg bg-black/35 p-1 ring-1 ring-white/[0.06]">
        {previews.length > 0 ? (
          previews.map((src, i) => (
            <div
              key={`${i}-${src.slice(0, 24)}`}
              className="min-w-0 flex-1 overflow-hidden rounded-md bg-black/40"
            >
              <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
            </div>
          ))
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[9px] text-gray-500">
            <span className="text-white/40">▤</span>
            <span>点击编辑镜头</span>
          </div>
        )}
        {stats && stats.rowCount > previews.length && previews.length > 0 ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[7px] font-bold text-gray-300">
            +{stats.rowCount - previews.length}
          </span>
        ) : null}
      </div>

      <div className="relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8px] text-gray-500">
        <span>{stats?.withImageCount ?? 0} 张分镜图</span>
        {stats ? (
          <span>
            {stats.hasGaps ? '时长未填齐' : `${stats.totalDurationSec.toFixed(1)}s`}
          </span>
        ) : null}
        {stats && stats.lockedCount > 0 ? <span>{stats.lockedCount} 镜已通过</span> : null}
      </div>
    </div>
  );
}
