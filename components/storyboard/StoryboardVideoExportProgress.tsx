import React from 'react';

type Props = {
  progress: number;
  className?: string;
};

/** 面板级导出进度（切换视图时仍可见） */
export default function StoryboardVideoExportProgress({ progress, className = '' }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[9px] text-gray-500">
          正在导出 WebM 到浏览器「下载」文件夹（关闭分镜表仍会继续）
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-gray-300">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-white/70 to-white/50 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
