import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import { capabilityPreviewAlternateUrls } from '../services/capabilityPreviewUrl';
import { workflowSafeImgSrc, WORKFLOW_IMG_EMPTY_PLACEHOLDER } from '../services/workflowImageDisplay';

export type SiteImageProps = {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLImageElement>;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  title?: string;
  loading?: 'lazy' | 'eager';
  fetchPriority?: 'high' | 'low' | 'auto';
  decoding?: 'async' | 'sync' | 'auto';
  onIntrinsicSize?: (naturalWidth: number, naturalHeight: number) => void;
  /** 全部候选 URL 失败后渲染 */
  fallback?: React.ReactNode;
  /**
   * 为 true 且 `src` 仅空白时不渲染（与旧 `CapabilityPreviewImg` 一致）。
   * 默认 false：走 `workflowSafeImgSrc` 的占位，避免空 src 报错。
   */
  suppressPlaceholderWhenEmpty?: boolean;
};

/**
 * 全站统一「直链」图片：安全 src、懒加载、`/api/r2/` 多候选重试（跨端口/静态站同源兜底）。
 * 大体积 data URL 的列表缩略请用 `ProgressivePreviewImage`。
 */
export const SiteImage = forwardRef<HTMLImageElement, SiteImageProps>(function SiteImage(
  {
    src,
    alt = '',
    className,
    style,
    draggable,
    onDragStart,
    onClick,
    title,
    loading = 'lazy',
    fetchPriority,
    decoding = 'async',
    onIntrinsicSize,
    fallback,
    suppressPlaceholderWhenEmpty,
  },
  ref
) {
  const normalizedSrc = src ?? '';
  const isSuppressedEmpty = Boolean(suppressPlaceholderWhenEmpty && !normalizedSrc.trim());

  const safe = useMemo(() => {
    if (isSuppressedEmpty) return WORKFLOW_IMG_EMPTY_PLACEHOLDER;
    return workflowSafeImgSrc(normalizedSrc);
  }, [isSuppressedEmpty, normalizedSrc]);

  const candidates = useMemo(() => {
    if (isSuppressedEmpty) return [];
    return capabilityPreviewAlternateUrls(safe);
  }, [isSuppressedEmpty, safe]);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
  }, [safe, isSuppressedEmpty]);

  if (isSuppressedEmpty) {
    return <>{fallback ?? null}</>;
  }

  const currentIdx = Math.min(attempt, Math.max(0, candidates.length - 1));
  const currentSrc = candidates[currentIdx] ?? safe;

  if (attempt >= candidates.length) {
    return (
      <>
        {fallback ?? (
          <div
            className={`flex flex-col items-center justify-center bg-white/5 text-gray-500 ${className ?? ''}`}
            style={style}
          >
            <span className="text-[8px] uppercase tracking-wide">预览不可用</span>
          </div>
        )}
      </>
    );
  }

  return (
    <img
      ref={ref}
      key={`${currentSrc}-${attempt}`}
      src={currentSrc}
      alt={alt}
      className={className}
      style={style}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      title={title}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding={decoding}
      onLoad={(e) => {
        const iw = e.currentTarget.naturalWidth;
        const ih = e.currentTarget.naturalHeight;
        if (iw > 0 && ih > 0) onIntrinsicSize?.(iw, ih);
      }}
      onError={() => {
        setAttempt((a) => {
          const next = a + 1;
          if (next >= candidates.length) {
            console.warn('[SiteImage] 图片加载失败（已尝试全部候选）', candidates);
          }
          return next;
        });
      }}
    />
  );
});
