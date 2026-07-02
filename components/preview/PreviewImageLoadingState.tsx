import React from 'react';

type PreviewImageLoadingStateProps = {
  /** 网格缩略图等占位，加载完成前模糊显示 */
  placeholderSrc?: string | null;
  label?: string;
};

/** 大图主图解码前的中央占位：占位图 + 轻量 spinner */
export const PreviewImageLoadingState: React.FC<PreviewImageLoadingStateProps> = ({
  placeholderSrc,
  label = '图片加载中…',
}) => (
  <div
    className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center"
    aria-hidden
  >
    {placeholderSrc ? (
      <img
        src={placeholderSrc}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full scale-105 select-none object-contain opacity-35 blur-md"
      />
    ) : null}
    <div className="relative flex flex-col items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#0a0a0c]/78 px-5 py-4 shadow-xl ring-1 ring-inset ring-white/[0.05]">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-blue-400/90"
        aria-hidden
      />
      <span className="text-[10px] font-medium tracking-wide text-gray-400">{label}</span>
    </div>
  </div>
);
