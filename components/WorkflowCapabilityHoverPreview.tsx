import React, { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ProgressivePreviewImage } from './ProgressivePreviewImage';
import { CapabilityPreviewImg } from './CapabilityPreviewImg';
import { workflowSafeImgSrc } from '../services/workflowImageDisplay';
import { shouldUsePreviewThumbnail } from '../services/workflowImageThumb';

type Props = {
  label: string;
  x: number;
  y: number;
  original: string;
  generated: string;
};

const HOVER_THUMB = 208;
const GEN_CLIP_INITIAL: React.CSSProperties = {
  clipPath: 'polygon(0 0, 0% 0, 0% 100%, 0 100%)',
};

/**
 * 能力卡片悬浮对比预览：扫描动画用 rAF 直接改 DOM，避免在巨型 WorkflowSection 上每秒 setState 导致整页卡顿。
 * http(s) 预览走 CapabilityPreviewImg（多候选 URL）；大 data URL 走 ProgressivePreviewImage。
 */
export const WorkflowCapabilityHoverPreview = React.memo(function WorkflowCapabilityHoverPreview({
  label,
  x,
  y,
  original,
  generated,
}: Props) {
  const genRef = useRef<HTMLImageElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const cacheKeyBase = useMemo(
    () => `cap-hover:${label}:${original.length}:${generated.length}:${original.slice(0, 48)}:${generated.slice(0, 48)}`,
    [label, original, generated]
  );

  const useProgOrig = shouldUsePreviewThumbnail(workflowSafeImgSrc(original));
  const useProgGen = shouldUsePreviewThumbnail(workflowSafeImgSrc(generated));

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const start = performance.now();
    const duration = 1800;
    const loop = (now: number) => {
      if (cancelled) return;
      const p = ((now - start) % duration) / duration;
      const cut = p * 100;
      const gen = genRef.current;
      const line = lineRef.current;
      if (gen) gen.style.clipPath = `polygon(0 0, ${cut}% 0, ${cut}% 100%, 0 100%)`;
      if (line) line.style.left = `${cut}%`;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, []);

  if (!original.trim() || !generated.trim()) return null;

  return createPortal(
    <div className="fixed z-[2500] pointer-events-none" style={{ left: x + 18, top: y + 18 }}>
      <div className="w-52 rounded-xl border border-white/15 bg-[#0f1116]/90 backdrop-blur-sm p-2 shadow-2xl">
        <div className="text-[8px] text-gray-300 mb-1">{label}</div>
        <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-black/30">
          {useProgOrig ? (
            <ProgressivePreviewImage
              fullSrc={original}
              cacheKey={`${cacheKeyBase}:orig`}
              thumbMaxEdge={HOVER_THUMB}
              className="absolute inset-0"
              imgClassName="absolute inset-0 h-full w-full object-cover"
              alt=""
            />
          ) : (
            <CapabilityPreviewImg
              src={original}
              className="absolute inset-0 h-full w-full object-cover"
              alt=""
            />
          )}
          {useProgGen ? (
            <ProgressivePreviewImage
              ref={genRef}
              fullSrc={generated}
              cacheKey={`${cacheKeyBase}:gen`}
              thumbMaxEdge={HOVER_THUMB}
              className="absolute inset-0"
              imgClassName="absolute inset-0 h-full w-full object-cover"
              imgStyle={GEN_CLIP_INITIAL}
              alt=""
            />
          ) : (
            <CapabilityPreviewImg
              ref={genRef}
              src={generated}
              className="absolute inset-0 h-full w-full object-cover"
              style={GEN_CLIP_INITIAL}
              alt=""
            />
          )}
          <div
            ref={lineRef}
            className="absolute inset-y-0 w-[1px] bg-cyan-100/90 shadow-[0_0_10px_rgba(34,211,238,0.55)]"
            style={{ left: '0%', transform: 'translateX(-50%)' }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
});
