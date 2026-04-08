import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  getLazyImagePreviewViewer,
  PreviewShell,
  PreviewViewerFallback,
  previewPolicyForMode,
} from './preview';

const NO_WHEEL = '[data-image-preview-no-wheel]';
const SCROLL = '[data-image-preview-scroll]';

function isEscapeLikeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape' || e.keyCode === 27;
}

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
  /** 是否显示「平面 / 全景」切换（全景为等距柱状 360° 浏览效果） */
  enablePanoramaMode?: boolean;
  /** 右侧占位宽度（如常驻侧栏），用于将主图居中到左侧可用区域 */
  contentRightInset?: string;
  children?: React.ReactNode;
};

function fitImageToPreviewViewport(nw: number, nh: number): { w: number; h: number } {
  if (typeof window === 'undefined' || !nw || !nh) return { w: nw, h: nh };
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.88;
  const s = Math.min(maxW / nw, maxH / nh);
  return { w: nw * s, h: nh * s };
}

/** 全景 Viewer 独立 chunk（registry 懒加载） */
const LazyImageEquirectViewer = getLazyImagePreviewViewer('image.equirect');

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
  enablePanoramaMode = true,
  contentRightInset = '0px',
  children,
}: ImagePreviewOverlayProps) {
  const [previewLayout, setPreviewLayout] = useState<'flat' | 'pano'>('flat');
  const [uiHidden, setUiHidden] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [lockedFrame, setLockedFrame] = useState<{ w: number; h: number } | null>(null);
  const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const zoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const zoomLastScaleRef = useRef(1);
  const spacePressedRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelLastNavigateAtRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setPreviewLayout('flat');
    setUiHidden(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    dragRef.current = null;
    panRef.current = null;
    zoomPivotRef.current = null;
    zoomLastScaleRef.current = 1;
    wheelAccumRef.current = 0;
    wheelLastNavigateAtRef.current = 0;
    setImageMeta(null);
  }, [open, resetKey]);

  const parseMeta = useCallback((src: string, width: number, height: number) => {
    const ratio = width > 0 && height > 0 ? (width / height).toFixed(3) : '-';
    let mime = 'unknown';
    let approxBytes = 0;
    const m = src.match(/^data:([^;,]+);base64,(.+)$/i);
    if (m) {
      mime = (m[1] || 'unknown').toLowerCase();
      const base64 = m[2] || '';
      // Base64 payload bytes: len * 3/4 - paddings
      const padding = (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
      approxBytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
    } else if (/^https?:\/\//i.test(src)) {
      try {
        const u = new URL(src);
        const ext = u.pathname.split('.').pop()?.toLowerCase() || '';
        mime =
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'png' ? 'image/png'
            : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
            : ext === 'bmp' ? 'image/bmp'
            : ext === 'svg' ? 'image/svg+xml'
            : 'remote';
      } catch {
        mime = 'remote';
      }
    }
    const kb = approxBytes > 0 ? `${(approxBytes / 1024).toFixed(1)} KB` : '-';
    return { ratio, mime, kb };
  }, []);

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEscapeLikeKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setUiHidden((v) => !v);
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
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onWheel = (e: WheelEvent) => {
      const viewerCapturesWheel =
        enablePanoramaMode && previewLayout === 'pano' && previewPolicyForMode('image.equirect').captureGlobalWheel;
      if (viewerCapturesWheel) return;
      const t = e.target;
      if (t instanceof Element && t.closest(NO_WHEEL)) {
        const innerMode = typeof onWheelInnerNavigate === 'function';
        const allowSpaceNavigate =
          innerMode && spacePressedRef.current && wheelListLength > 1;
        if (allowSpaceNavigate) {
          // 空格+滚轮切资产为全局手势：即使悬停在 no-wheel 区域也放行到后续导航逻辑
        } else {
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
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const QUICK_STEP_THRESH = 4;
      const NAV_COOLDOWN_MS = 90;
      const emitStep = (step: number) => {
        wheelAccumRef.current = 0;
        wheelLastNavigateAtRef.current = now;
        if (innerMode) onWheelInnerNavigate!(step);
        else onWheelNavigate(step);
      };

      // 空格+切资产：单次滚轮事件常见 deltaY≈16，用 18 阈值会要滚两下才触发一次
      if (innerMode && spacePressedRef.current) {
        if (wheelListLength <= 1) return;
        if (Math.abs(dy) >= QUICK_STEP_THRESH && now - wheelLastNavigateAtRef.current >= NAV_COOLDOWN_MS) {
          emitStep(dy > 0 ? 1 : -1);
          return;
        }
        const SPACE_THRESH = 8;
        if (wheelAccumRef.current !== 0 && Math.sign(wheelAccumRef.current) !== Math.sign(dy)) {
          wheelAccumRef.current = 0;
        }
        wheelAccumRef.current += dy;
        if (wheelAccumRef.current >= SPACE_THRESH) {
          emitStep(1);
        } else if (wheelAccumRef.current <= -SPACE_THRESH) {
          emitStep(-1);
        }
        return;
      }

      const THRESH = 18;
      const MAX_STEPS_PER_EVENT = 12;
      if (Math.abs(dy) >= QUICK_STEP_THRESH && now - wheelLastNavigateAtRef.current >= NAV_COOLDOWN_MS) {
        emitStep(dy > 0 ? 1 : -1);
        return;
      }
      if (wheelAccumRef.current !== 0 && Math.sign(wheelAccumRef.current) !== Math.sign(dy)) {
        wheelAccumRef.current = 0;
      }
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
      wheelLastNavigateAtRef.current = now;
      if (innerMode) onWheelInnerNavigate!(steps);
      else onWheelNavigate(steps);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [
    open,
    previewLayout,
    enablePanoramaMode,
    wheelListLength,
    onWheelNavigate,
    onWheelInnerNavigate,
    innerWheelOptionCount,
  ]);

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
      setImageMeta({ width: nw, height: nh });
      const next = fitImageToPreviewViewport(nw, nh);
      // 多版本切换时，外框按已出现版本里的更大边扩展，避免“原图很窄导致生成图显示过小”。
      setLockedFrame((prev) =>
        prev
          ? { w: Math.max(prev.w, next.w), h: Math.max(prev.h, next.h) }
          : next
      );
    },
    [innerLayoutStableKey]
  );

  const handleImgLoadGeneral = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const im = e.currentTarget;
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      if (!nw || !nh) return;
      setImageMeta({ width: nw, height: nh });
      handleImgLoad(e);
    },
    [handleImgLoad]
  );

  if (!open || !imageSrc) return null;

  const useFrameLock = Boolean(innerLayoutStableKey && lockedFrame);
  const shellStyle: React.CSSProperties = {
    left: `calc((100% - ${contentRightInset}) / 2)`,
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: 'center center',
    ...(useFrameLock && lockedFrame
      ? { width: lockedFrame.w, height: lockedFrame.h }
      : {}),
  };

  return (
    <PreviewShell open={open} onClose={onClose} focusKey={resetKey}>
        {enablePanoramaMode && previewLayout === 'pano' && LazyImageEquirectViewer ? (
          <div
            className="absolute inset-0 z-[5] min-h-[200px]"
            onWheel={(e) => e.stopPropagation()}
          >
            <Suspense fallback={<PreviewViewerFallback label="全景模块加载中…" />}>
              <LazyImageEquirectViewer imageSrc={imageSrc} className="h-full w-full rounded-none border-0" />
            </Suspense>
          </div>
        ) : null}

        {!(enablePanoramaMode && previewLayout === 'pano') ? (
          <div
            className={`absolute top-1/2 ${useFrameLock ? 'flex items-center justify-center' : ''}`}
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
              onLoad={handleImgLoadGeneral}
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
        ) : null}

        {!uiHidden ? (
        <div className="absolute top-4 left-4 z-10 max-w-[min(300px,calc(100vw-6rem))] rounded-xl border border-white/10 bg-[#0f0f12]/98 px-3 py-2 text-[9px] text-gray-300 pointer-events-none text-left leading-relaxed space-y-1 shadow-xl backdrop-blur-[2px]">
          {enablePanoramaMode && previewLayout === 'pano' ? (
            <>
              <div>拖拽：旋转视角（360° 全景）</div>
              <div>滚轮：调整视野宽窄</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : typeof onWheelInnerNavigate === 'function' ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>空格+滚轮：上一资产 / 下一资产</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>Esc：关闭预览</div>
              <div>双击：复原缩放与位置</div>
              <div>左键：缩放</div>
              <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
              <div className="text-gray-500 pt-0.5 border-t border-white/10">当前缩放 {Math.round(scale * 100)}%</div>
            </>
          ) : (
            <>
              <div>滚轮：上一张 / 下一张</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>Esc：关闭预览</div>
              <div>双击：复原缩放与位置</div>
              <div>左键：缩放</div>
              <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
              <div className="text-gray-500 pt-0.5 border-t border-white/10">当前缩放 {Math.round(scale * 100)}%</div>
            </>
          )}
        </div>
        ) : null}

        {!uiHidden ? (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
          {enablePanoramaMode ? (
            <div
              className="flex rounded-xl border border-[#2e2e32] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setPreviewLayout('flat')}
                className={`px-3 py-2 text-[10px] font-black uppercase transition-colors ${
                  previewLayout === 'flat'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#1a1a1e]/95 text-gray-300 hover:bg-[#2a2a32]'
                }`}
              >
                平面
              </button>
              <button
                type="button"
                onClick={() => setPreviewLayout('pano')}
                className={`px-3 py-2 text-[10px] font-black uppercase transition-colors border-l border-[#2e2e32] ${
                  previewLayout === 'pano'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#1a1a1e]/95 text-gray-300 hover:bg-[#2a2a32]'
                }`}
              >
                全景
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl bg-[#1a1a1e]/95 border border-[#2e2e32] text-[10px] font-black text-white hover:bg-[#2a2a32]"
          >
            关闭
          </button>
        </div>
        ) : null}

        {!uiHidden ? children : null}
    </PreviewShell>
  );
}
