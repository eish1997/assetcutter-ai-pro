import React, { useCallback, useEffect, useRef, useState } from 'react';

const NO_WHEEL = '[data-image-preview-no-wheel]';
const SCROLL = '[data-image-preview-scroll]';

export type ImagePreviewOverlayProps = {
  open: boolean;
  /** 切换图片或重新打开时重置缩放/平移 */
  resetKey: string;
  imageSrc: string;
  onClose: () => void;
  /** 按住空格+滚轮：切换「上一资产 / 下一资产」时的列表长度（≤1 时不切换） */
  wheelListLength: number;
  /** 按住空格+滚轮：在资产列表中前进/后退多步 */
  onWheelNavigate: (deltaSteps: number) => void;
  /**
   * 若提供：普通滚轮仅在 innerWheelOptionCount &gt; 1 时在本卡片内切换版本；
   * 按住空格+滚轮始终走 onWheelNavigate 切资产列表（与单图/多图无关）。
   * 未提供时滚轮行为与 onWheelNavigate 一致（如对话临时库）。
   */
  onWheelInnerNavigate?: (deltaSteps: number) => void;
  /** 本卡片内可切换版本数（含原始） */
  innerWheelOptionCount?: number;
  /**
   * 多版本预览时固定「外框」尺寸（如传资产 id）：切换 displayKey 时画布占位不变，便于对比。
   * 与 layoutReferenceSrc 配合时优先按基准图比例算外框。
   */
  innerLayoutStableKey?: string;
  /** 计算外框用的基准图 URL（建议原图）；缺省或加载失败则用当前预览图首次 onLoad */
  layoutReferenceSrc?: string;
  children?: React.ReactNode;
};

function fitImageToPreviewViewport(nw: number, nh: number): { w: number; h: number } {
  if (typeof window === 'undefined' || !nw || !nh) return { w: nw, h: nh };
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.88;
  const s = Math.min(maxW / nw, maxH / nh);
  return { w: nw * s, h: nh * s };
}

/**
 * 全屏大图预览：滚轮切图、Esc 关闭、双击复原、左键拖拽缩放（按下处为轴）、空格/Shift+左键/右键平移。
 */
export function ImagePreviewOverlay({
  open,
  resetKey,
  imageSrc,
  onClose,
  wheelListLength,
  onWheelNavigate,
  onWheelInnerNavigate,
  innerWheelOptionCount = 1,
  innerLayoutStableKey,
  layoutReferenceSrc,
  children,
}: ImagePreviewOverlayProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [lockedFrame, setLockedFrame] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const zoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const zoomLastScaleRef = useRef(1);
  const spacePressedRef = useRef(false);
  const wheelAccumRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    dragRef.current = null;
    panRef.current = null;
    zoomPivotRef.current = null;
    zoomLastScaleRef.current = 1;
    wheelAccumRef.current = 0;
  }, [open, resetKey]);

  useEffect(() => {
    if (!open || !innerLayoutStableKey) {
      setLockedFrame(null);
      return;
    }
    setLockedFrame(null);
    if (!layoutReferenceSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;
      setLockedFrame(fitImageToPreviewViewport(nw, nh));
    };
    img.onerror = () => {};
    img.src = layoutReferenceSrc;
    return () => {
      cancelled = true;
    };
  }, [open, innerLayoutStableKey, layoutReferenceSrc]);

  useEffect(() => {
    if (!open) return;
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', blockContextMenu, true);
    return () => window.removeEventListener('contextmenu', blockContextMenu, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spacePressedRef.current) wheelAccumRef.current = 0;
        spacePressedRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
        wheelAccumRef.current = 0;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
      wheelAccumRef.current = 0;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest(NO_WHEEL)) {
        const scrollEl = t.closest(SCROLL) as HTMLElement | null;
        if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
          const st = scrollEl.scrollTop;
          const sh = scrollEl.scrollHeight;
          const ch = scrollEl.clientHeight;
          if ((e.deltaY < 0 && st > 0) || (e.deltaY > 0 && st + ch < sh - 1)) return;
        }
        e.preventDefault();
        return;
      }
      const innerMode = typeof onWheelInnerNavigate === 'function';

      if (innerMode && spacePressedRef.current) {
        if (wheelListLength <= 1) {
          e.preventDefault();
          return;
        }
      } else if (innerMode) {
        if (innerWheelOptionCount <= 1) {
          e.preventDefault();
          return;
        }
      } else if (wheelListLength <= 1) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      let dy = e.deltaY;
      const dx = e.deltaX;
      if (Math.abs(dx) > Math.abs(dy)) dy = dx;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 120;
      if (!dy && typeof (e as unknown as { wheelDelta?: number }).wheelDelta === 'number') {
        dy = -(e as unknown as { wheelDelta: number }).wheelDelta / 3;
      }
      if (Math.abs(dy) < 0.25) return;

      // 空格+切资产：单次滚轮事件常见 deltaY≈16，用 18 阈值会要滚两下才触发一次
      if (innerMode && spacePressedRef.current) {
        if (wheelListLength <= 1) return;
        const SPACE_THRESH = 8;
        wheelAccumRef.current += dy;
        if (wheelAccumRef.current >= SPACE_THRESH) {
          wheelAccumRef.current = 0;
          onWheelNavigate(1);
        } else if (wheelAccumRef.current <= -SPACE_THRESH) {
          wheelAccumRef.current = 0;
          onWheelNavigate(-1);
        }
        return;
      }

      const THRESH = 18;
      const MAX_STEPS_PER_EVENT = 12;
      wheelAccumRef.current += dy;
      let steps = 0;
      while (wheelAccumRef.current >= THRESH && steps < MAX_STEPS_PER_EVENT) {
        wheelAccumRef.current -= THRESH;
        steps += 1;
      }
      while (wheelAccumRef.current <= -THRESH && steps > -MAX_STEPS_PER_EVENT) {
        wheelAccumRef.current += THRESH;
        steps -= 1;
      }
      if (steps === 0) return;
      if (innerMode) {
        onWheelInnerNavigate!(steps);
      } else {
        onWheelNavigate(steps);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [open, wheelListLength, onWheelNavigate, onWheelInnerNavigate, innerWheelOptionCount]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        const nextScale = Math.max(0.2, Math.min(6, drag.startScale + (dx - dy) * 0.005));
        const prevS = zoomLastScaleRef.current;
        const pivot = zoomPivotRef.current;
        const img = imgRef.current;
        if (img && pivot && Math.abs(nextScale - prevS) > 1e-9) {
          const rect = img.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const f = 1 - nextScale / prevS;
          setOffset((prev) => ({
            x: prev.x + f * (pivot.x - cx),
            y: prev.y + f * (pivot.y - cy),
          }));
          zoomLastScaleRef.current = nextScale;
        } else if (Math.abs(nextScale - prevS) > 1e-9) {
          zoomLastScaleRef.current = nextScale;
        }
        setScale(nextScale);
      }
      const pan = panRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        setOffset({ x: pan.startOffsetX + dx, y: pan.startOffsetY + dy });
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      panRef.current = null;
      zoomPivotRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleImgMouseDown = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) {
        const useLeftPan = e.shiftKey || spacePressedRef.current;
        if (useLeftPan) {
          panRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startOffsetX: offset.x,
            startOffsetY: offset.y,
          };
          return;
        }
        zoomPivotRef.current = { x: e.clientX, y: e.clientY };
        zoomLastScaleRef.current = scale;
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startScale: scale,
        };
        return;
      }
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startOffsetX: offset.x,
        startOffsetY: offset.y,
      };
    },
    [offset.x, offset.y, scale]
  );

  const handleImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      if (!innerLayoutStableKey) return;
      const im = e.currentTarget;
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      if (!nw || !nh) return;
      setLockedFrame((prev) => prev ?? fitImageToPreviewViewport(nw, nh));
    },
    [innerLayoutStableKey]
  );

  if (!open || !imageSrc) return null;

  const useFrameLock = Boolean(innerLayoutStableKey && lockedFrame);
  const shellStyle: React.CSSProperties = {
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: 'center center',
    ...(useFrameLock && lockedFrame
      ? { width: lockedFrame.w, height: lockedFrame.h }
      : {}),
  };

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/72 backdrop-blur-sm animate-in fade-in"
      data-ac-block-workflow-marquee
      onClick={onClose}
      onContextMenuCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        className="relative w-full h-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onContextMenuCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div
          className={`absolute left-1/2 top-1/2 ${useFrameLock ? 'flex items-center justify-center' : ''}`}
          style={shellStyle}
        >
          <img
            src={imageSrc}
            className={
              useFrameLock
                ? 'max-w-full max-h-full w-full h-full object-contain rounded-xl shadow-2xl select-none cursor-zoom-in'
                : 'max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl select-none cursor-zoom-in'
            }
            alt=""
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            onLoad={handleImgLoad}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setScale(1);
              setOffset({ x: 0, y: 0 });
              dragRef.current = null;
              panRef.current = null;
              zoomPivotRef.current = null;
              zoomLastScaleRef.current = 1;
            }}
            ref={imgRef}
            onMouseDown={handleImgMouseDown}
          />
        </div>

        <div className="absolute top-4 left-4 z-10 max-w-[min(300px,calc(100vw-6rem))] rounded-xl bg-[#101018]/90 border border-[#2e2e32] px-3 py-2 text-[9px] text-gray-300 pointer-events-none text-left leading-relaxed space-y-1">
          {typeof onWheelInnerNavigate === 'function' ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>空格+滚轮：上一资产 / 下一资产</div>
            </>
          ) : (
            <div>滚轮：上一张 / 下一张</div>
          )}
          <div>Esc：关闭预览</div>
          <div>双击：复原缩放与位置</div>
          <div>左键：缩放</div>
          <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
          <div className="text-gray-500 pt-0.5 border-t border-white/10">当前缩放 {Math.round(scale * 100)}%</div>
        </div>

        <div className="absolute right-4 top-4 z-10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-[10px] font-black text-white hover:bg-[#2a2a32]"
          >
            关闭
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
