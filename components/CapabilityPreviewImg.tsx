import React, { useEffect, useState } from 'react';
import { capabilityPreviewAlternateUrls } from '../services/capabilityPreviewUrl';

type Props = {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  /** 全部候选加载失败时展示 */
  fallback?: React.ReactNode;
};

/**
 * 能力商店预览图：同源改写后若仍失败，再尝试绝对同源 URL；避免打开站点后大量裂图。
 */
export const CapabilityPreviewImg: React.FC<Props> = ({ src, alt = '', className, style, onClick, fallback }) => {
  const [attempt, setAttempt] = useState(0);
  const candidates = capabilityPreviewAlternateUrls(src);
  const current = candidates[Math.min(attempt, candidates.length - 1)] ?? src;

  useEffect(() => {
    setAttempt(0);
  }, [src]);

  if (!src.trim()) {
    return fallback ?? null;
  }

  if (attempt >= candidates.length) {
    return (
      <>
        {fallback ?? (
          <div className={`flex flex-col items-center justify-center bg-white/5 text-gray-500 ${className ?? ''}`} style={style}>
            <span className="text-[8px] uppercase tracking-wide">预览不可用</span>
          </div>
        )}
      </>
    );
  }

  return (
    <img
      key={`${current}-${attempt}`}
      src={current}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      onClick={onClick}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
};
