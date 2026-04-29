import React, { useEffect, useState } from 'react';

import type { DialogMessageVersion } from '../types';
import { downloadR2ObjectAsDataUrl } from '../services/dialogR2Image';
import { dialogVersionHasRenderableImage, getDialogVersionImageDataUrl } from '../services/dialogImageHelpers';

/**
 * 会话行标题区背景：优先最后一条助手生成图；仅 R2 key 时拉取一次 data URL 再模糊展示。
 */
export function DialogSessionRowBackdrop({
  version,
  isActive,
}: {
  version: DialogMessageVersion;
  isActive: boolean;
}) {
  const [src, setSrc] = useState<string | undefined>(() => getDialogVersionImageDataUrl(version));

  useEffect(() => {
    const fromMem = getDialogVersionImageDataUrl(version);
    setSrc(fromMem);
    if (fromMem || !version.resultImageObjectKey) return;
    let cancelled = false;
    void downloadR2ObjectAsDataUrl(version.resultImageObjectKey)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!dialogVersionHasRenderableImage(version)) return null;

  if (!src) {
    return (
      <div
        className={`pointer-events-none absolute inset-0 z-0 rounded-[inherit] ${isActive ? 'bg-[#1a2d4d]/80' : 'bg-[#1c1c22]/85'} animate-pulse`}
        aria-hidden
      />
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden>
      <img
        src={src}
        alt=""
        className="absolute left-1/2 top-1/2 min-h-[125%] min-w-[125%] -translate-x-1/2 -translate-y-1/2 object-cover opacity-[0.58] blur-[4px] brightness-[0.72] scale-110"
      />
      {/* 左侧压暗保证标题可读，右侧留出更多底图可见；避免整层 90%+ 实色盖住图片 */}
      <div
        className={`absolute inset-0 bg-gradient-to-r ${
          isActive
            ? 'from-[#0d1b2f]/94 via-[#1a2d4d]/62 to-[#1a2d4d]/22'
            : 'from-[#0a0a0c]/92 via-[#141416]/58 to-[#141416]/18'
        }`}
      />
    </div>
  );
}
