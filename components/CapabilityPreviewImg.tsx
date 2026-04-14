import React, { forwardRef } from 'react';
import { SiteImage } from './SiteImage';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  onIntrinsicSize?: (naturalWidth: number, naturalHeight: number) => void;
  /** 全部候选加载失败时展示 */
  fallback?: React.ReactNode;
  loading?: 'lazy' | 'eager';
};

/**
 * 能力商店等场景预览图：行为与全站 `SiteImage` 一致（同源多候选 URL 重试）。
 */
export const CapabilityPreviewImg = forwardRef<HTMLImageElement, Props>(function CapabilityPreviewImg(
  { src, alt = '', className, style, onClick, onIntrinsicSize, fallback, loading = 'lazy' },
  ref
) {
  if (!src.trim()) {
    return <>{fallback ?? null}</>;
  }

  return (
    <SiteImage
      ref={ref}
      src={src}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
      onIntrinsicSize={onIntrinsicSize}
      fallback={fallback}
      loading={loading}
    />
  );
});
