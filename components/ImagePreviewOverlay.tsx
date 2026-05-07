import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  getLazyImagePreviewViewer,
  PreviewShell,
  PreviewViewerFallback,
  previewPolicyForMode,
} from './preview';
import { Box, Contrast, Globe2, Image as ImageIcon, X } from 'lucide-react';
import { readLocalString, writeLocalString } from '../services/clientPersist';
import { CustomDropdown } from './ui/CustomDropdown';
import {
  IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE,
  TITLE_ROW_STEPPER_SHELL,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflow/workflowSectionUiConstants';

const NO_WHEEL = '[data-image-preview-no-wheel]';
const SCROLL = '[data-image-preview-scroll]';

/** 与 `ImageAnnotationLightboxToolbar` 主栏图标同阶 */
const PV_MODE_IC = { size: 17, strokeWidth: 1.75, className: 'shrink-0' as const };

/** 与能力预设顶栏 `TITLE_ROW_STEPPER_SHELL` 内按钮同系 */
const PV_MODE_SEG_BASE =
  'h-7 w-8 flex shrink-0 items-center justify-center transition-colors outline-none focus-visible:z-[1] focus-visible:ring-2 focus-visible:ring-blue-500/50';
const PV_MODE_SEG_ON = 'bg-blue-600 text-white ring-1 ring-inset ring-blue-400/30';
const PV_MODE_SEG_OFF = 'text-gray-300 hover:bg-white/[0.08]';

const MODEL_PREVIEW_EXT_RE = /\.(glb|gltf|fbx|obj)$/i;

const LIGHTBOX_BACKDROP_STORAGE_KEY = 'ac_image_lightbox_backdrop_v1';

export type ImageLightboxBackdropId = 'frosted' | 'black' | 'gray50' | 'white';

const LIGHTBOX_BACKDROP_CLASS: Record<ImageLightboxBackdropId, string> = {
  frosted: 'bg-black/72 backdrop-blur-sm',
  black: 'bg-black',
  gray50: 'bg-[#808080]',
  white: 'bg-white',
};

const LIGHTBOX_BACKDROP_OPTIONS: Array<{
  value: ImageLightboxBackdropId;
  /** 保留给无障碍与 `title` 回退 */
  label: string;
  title: string;
}> = [
  { value: 'frosted', label: '毛玻璃', title: '预览背景：毛玻璃（暗色半透明 + 模糊）' },
  { value: 'black', label: '黑色', title: '预览背景：纯黑' },
  { value: 'gray50', label: '50% 灰', title: '预览背景：50% 中性灰' },
  { value: 'white', label: '白色', title: '预览背景：纯白' },
];

function LightboxBackdropSwatch({ id }: { id: ImageLightboxBackdropId }) {
  const shell =
    'h-7 w-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] [isolation:isolate]';
  if (id === 'frosted') {
    return (
      <span className={`relative overflow-hidden ${shell}`} aria-hidden>
        {/* 高对比棋盘格：半透明 + blur 后轮廓被抹开，更接近真实毛玻璃 */}
        <span
          className="absolute inset-0 scale-[1.15]"
          style={{
            backgroundColor: '#3d3d42',
            backgroundImage: [
              'linear-gradient(45deg, #1a1a1f 25%, transparent 25%)',
              'linear-gradient(-45deg, #1a1a1f 25%, transparent 25%)',
              'linear-gradient(45deg, transparent 75%, #1a1a1f 75%)',
              'linear-gradient(-45deg, transparent 75%, #1a1a1f 75%)',
            ].join(', '),
            backgroundSize: '5px 5px',
            backgroundPosition: '0 0, 0 2.5px, 2.5px -2.5px, -2.5px 0',
          }}
        />
        <span className="absolute inset-0 bg-black/40 backdrop-blur-[6px]" />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.22] via-white/[0.06] to-transparent" />
      </span>
    );
  }
  if (id === 'black') {
    return <span className={`${shell} bg-black`} aria-hidden />;
  }
  if (id === 'gray50') {
    return <span className={`${shell} bg-[#808080]`} aria-hidden />;
  }
  return <span className={`${shell} bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)]`} aria-hidden />;
}

function parseImageLightboxBackdrop(raw: string | null): ImageLightboxBackdropId {
  if (raw === 'frosted' || raw === 'black' || raw === 'gray50' || raw === 'white') return raw;
  return 'frosted';
}

function pickPreviewableModelUrl(modelUrls?: string[]): string | null {
  if (!Array.isArray(modelUrls) || modelUrls.length === 0) return null;
  const cleaned = modelUrls.map((u) => String(u || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const score = (u: string) => {
    const pure = u.split('#')[0]?.split('?')[0] ?? u;
    if (/\.glb$/i.test(pure)) return 0;
    if (/\.gltf$/i.test(pure)) return 1;
    if (/\.fbx$/i.test(pure)) return 2;
    if (/\.obj$/i.test(pure)) return 3;
    if (/^blob:/i.test(u)) return 4;
    return 99;
  };
  const candidates = cleaned.filter((u) => {
    const pure = u.split('#')[0]?.split('?')[0] ?? u;
    return MODEL_PREVIEW_EXT_RE.test(pure) || /^blob:/i.test(u);
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0] ?? null;
}

function isEscapeLikeKey(e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape' || e.keyCode === 27;
}

export type ImagePreviewOverlayProps = {
  open: boolean;
  /** 切换图片或重新打开时重置缩放/平移 */
  resetKey: string;
  /** 与 centerSlot 二选一：有中央自定义内容时可省略 */
  imageSrc?: string;
  /** 替代中央图片区（如文字编辑）。有时与 imageSrc 同时存在：仅展示 centerSlot，不展示图片与缩放平移 */
  centerSlot?: React.ReactNode;
  onClose: () => void;
  /** 按住 Shift+滚轮：切换「上一资产 / 下一资产」时的列表长度（≤1 时不切换） */
  wheelListLength: number;
  /** 按住 Shift+滚轮：在资产列表中前进/后退多步 */
  onWheelNavigate: (deltaSteps: number) => void;
  /**
   * 若提供：普通滚轮仅在 innerWheelOptionCount &gt; 1 时在本卡片内切换版本；
   * 按住 Shift+滚轮始终走 onWheelNavigate 切资产列表（与单图/多图无关）。
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
  /** 关联 3D 模型 URL 列表（在线预览：GLB/GLTF/FBX/OBJ；blob 需配合 modelFileName） */
  modelUrls?: string[];
  /** 本地拖入模型的原始文件名（用于 blob URL 推断格式） */
  modelFileName?: string;
  /** 右侧占位宽度（如常驻侧栏），用于将主图居中到左侧可用区域 */
  contentRightInset?: string;
  /**
   * 传给 PreviewShell 的全屏层 z-index（Tailwind 类）。嵌套在更高 z 的全屏壳内（如工作流编排 `z-[2100]`）时必须高于父层，否则预览会显示在父层背后。
   */
  shellZIndexClassName?: string;
  /** 右上角「平面/全景/关闭」左侧：额外控件（如工作流下载、丢弃版本） */
  topRightExtra?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * 平面预览时叠在 `<img>` 上的内容（与图同层、受同一套 scale/translate 影响）。
   * 用于标注层等与 `object-contain` 像素对齐的覆盖物。
   */
  flatImageOverlay?: (ctx: { imgRef: React.RefObject<HTMLImageElement | null> }) => React.ReactNode;
};

function fitImageToPreviewViewport(nw: number, nh: number): { w: number; h: number } {
  if (typeof window === 'undefined' || !nw || !nh) return { w: nw, h: nh };
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.88;
  const s = Math.min(maxW / nw, maxH / nh);
  return { w: nw * s, h: nh * s };
}

function dominantAxisForImage(nw: number, nh: number): 'width' | 'height' {
  return nw >= nh ? 'width' : 'height';
}

function lockByOriginalDominantAxis(nw: number, nh: number): { axis: 'width' | 'height'; size: number } {
  const fit = fitImageToPreviewViewport(nw, nh);
  const axis = dominantAxisForImage(nw, nh);
  return { axis, size: axis === 'width' ? fit.w : fit.h };
}

/** 全景 Viewer 独立 chunk（registry 懒加载） */
const LazyImageEquirectViewer = getLazyImagePreviewViewer('image.equirect');
/** 3D Viewer 独立 chunk（registry 懒加载） */
const LazyImageModel3DViewer = getLazyImagePreviewViewer('image.model3d');

/**
 * 全屏大图预览：滚轮切图、Esc 关闭、双击复原、左键拖拽缩放（按下处为轴）、空格/Shift+左键/右键平移；多资产时 Shift+滚轮切资产。
 */
export function ImagePreviewOverlay({
  open,
  resetKey,
  imageSrc,
  centerSlot,
  onClose,
  wheelListLength,
  onWheelNavigate,
  onWheelInnerNavigate,
  innerWheelOptionCount = 1,
  innerLayoutStableKey,
  layoutReferenceSrc,
  enablePanoramaMode = true,
  modelUrls,
  modelFileName,
  contentRightInset = '0px',
  shellZIndexClassName,
  topRightExtra,
  children,
  flatImageOverlay,
}: ImagePreviewOverlayProps) {
  const [previewLayout, setPreviewLayout] = useState<'flat' | 'pano' | 'model3d'>('flat');
  const [lightboxBackdropId, setLightboxBackdropId] = useState<ImageLightboxBackdropId>(() =>
    parseImageLightboxBackdrop(readLocalString(LIGHTBOX_BACKDROP_STORAGE_KEY))
  );
  const [uiHidden, setUiHidden] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [lockedDominant, setLockedDominant] = useState<{ axis: 'width' | 'height'; size: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const zoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const zoomLastScaleRef = useRef(1);
  const spacePressedRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelLastNavigateAtRef = useRef(0);
  const previewModelSrc = pickPreviewableModelUrl(modelUrls);
  const hasModel3DMode = Boolean(!centerSlot && previewModelSrc && LazyImageModel3DViewer);

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
  }, [open, resetKey]);

  useEffect(() => {
    if (!open || !innerLayoutStableKey) {
      setLockedDominant(null);
      return;
    }
    setLockedDominant(null);
    if (!layoutReferenceSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;
      setLockedDominant(lockByOriginalDominantAxis(nw, nh));
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
        spacePressedRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
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
        (enablePanoramaMode && previewLayout === 'pano' && previewPolicyForMode('image.equirect').captureGlobalWheel) ||
        (hasModel3DMode && previewLayout === 'model3d' && previewPolicyForMode('image.model3d').captureGlobalWheel);
      if (viewerCapturesWheel) return;

      const innerMode = typeof onWheelInnerNavigate === 'function';
      const shiftAssetNav = e.shiftKey && wheelListLength > 1;

      const t = e.target;
      if (!shiftAssetNav && t instanceof Element) {
        const scrollEl = t.closest(SCROLL) as HTMLElement | null;
        if (scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight + 1) {
          const st = scrollEl.scrollTop;
          const sh = scrollEl.scrollHeight;
          const ch = scrollEl.clientHeight;
          if ((e.deltaY < 0 && st > 0) || (e.deltaY > 0 && st + ch < sh - 1)) {
            return;
          }
        }
      }
      if (t instanceof Element && t.closest(NO_WHEEL)) {
        if (!shiftAssetNav) {
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
        // Shift+滚轮切资产：全局手势，悬停在底部按钮条（no-wheel）时也生效
      }

      if (!shiftAssetNav) {
        if (innerMode) {
          if (innerWheelOptionCount <= 1) {
            e.preventDefault();
            return;
          }
        } else if (wheelListLength <= 1) {
          e.preventDefault();
          return;
        }
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

      /** 无 Shift：滚轮切「本卡 displayKey」或单列表切图 */
      const emitInnerOrListStep = (step: number) => {
        wheelAccumRef.current = 0;
        wheelLastNavigateAtRef.current = now;
        if (innerMode) onWheelInnerNavigate!(step);
        else onWheelNavigate(step);
      };

      // Shift+切资产：单次滚轮事件常见 deltaY≈16，用较低累积阈值
      if (shiftAssetNav) {
        const emitAssetStep = (step: number) => {
          wheelAccumRef.current = 0;
          wheelLastNavigateAtRef.current = now;
          onWheelNavigate(step);
        };
        if (Math.abs(dy) >= QUICK_STEP_THRESH && now - wheelLastNavigateAtRef.current >= NAV_COOLDOWN_MS) {
          emitAssetStep(dy > 0 ? 1 : -1);
          return;
        }
        const SHIFT_THRESH = 8;
        if (wheelAccumRef.current !== 0 && Math.sign(wheelAccumRef.current) !== Math.sign(dy)) {
          wheelAccumRef.current = 0;
        }
        wheelAccumRef.current += dy;
        if (wheelAccumRef.current >= SHIFT_THRESH) {
          emitAssetStep(1);
        } else if (wheelAccumRef.current <= -SHIFT_THRESH) {
          emitAssetStep(-1);
        }
        return;
      }

      const THRESH = 18;
      const MAX_STEPS_PER_EVENT = 12;
      if (Math.abs(dy) >= QUICK_STEP_THRESH && now - wheelLastNavigateAtRef.current >= NAV_COOLDOWN_MS) {
        emitInnerOrListStep(dy > 0 ? 1 : -1);
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
    hasModel3DMode,
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
      const next = lockByOriginalDominantAxis(nw, nh);
      // 约定：按原始图“较大侧”对齐；若已锁定则不再被后续版本改写。
      setLockedDominant((prev) => prev ?? next);
    },
    [innerLayoutStableKey]
  );

  /**
   * 某些浏览器在缓存命中时可能出现 onLoad 未按预期触发，
   * 这里在 src 变更后主动读取 complete 图片的固有尺寸兜底。
   */
  useEffect(() => {
    if (!open || centerSlot || !imageSrc?.trim()) return;
    const im = imgRef.current;
    if (!im) return;
    if (!im.complete) return;
    const nw = im.naturalWidth;
    const nh = im.naturalHeight;
    if (!nw || !nh) return;
    if (!innerLayoutStableKey) return;
    const next = lockByOriginalDominantAxis(nw, nh);
    setLockedDominant((prev) => prev ?? next);
  }, [open, centerSlot, imageSrc, innerLayoutStableKey, resetKey]);

  const handleImgLoadGeneral = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const im = e.currentTarget;
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      if (!nw || !nh) return;
      handleImgLoad(e);
    },
    [handleImgLoad]
  );

  const hasImage = Boolean(imageSrc && imageSrc.trim());
  if (!open || (!hasImage && !centerSlot)) return null;

  const useFrameLock = Boolean(!centerSlot && innerLayoutStableKey && lockedDominant);
  const shellStyle: React.CSSProperties = {
    left: `calc((100% - ${contentRightInset}) / 2)`,
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: 'center center',
  };
  const lockedImgStyle: React.CSSProperties | undefined = useFrameLock && lockedDominant
    ? lockedDominant.axis === 'width'
      ? { width: `${lockedDominant.size}px`, height: 'auto', maxWidth: '92vw', maxHeight: '88vh' }
      : { height: `${lockedDominant.size}px`, width: 'auto', maxWidth: '92vw', maxHeight: '88vh' }
    : undefined;

  return (
    <PreviewShell
      open={open}
      onClose={onClose}
      focusKey={resetKey}
      zIndexClassName={shellZIndexClassName ?? 'z-[2000]'}
      backdropTintClassName={LIGHTBOX_BACKDROP_CLASS[lightboxBackdropId]}
    >
        {!centerSlot && enablePanoramaMode && previewLayout === 'pano' && LazyImageEquirectViewer ? (
          <div
            className="absolute inset-0 z-[5] min-h-[200px]"
            onWheel={(e) => e.stopPropagation()}
          >
            <Suspense fallback={<PreviewViewerFallback label="全景模块加载中…" />}>
              <LazyImageEquirectViewer imageSrc={imageSrc!} className="h-full w-full rounded-none border-0" />
            </Suspense>
          </div>
        ) : null}

        {!centerSlot && hasModel3DMode && previewLayout === 'model3d' ? (
          <div className="absolute inset-0 z-[5] min-h-0" onWheel={(e) => e.stopPropagation()}>
            <Suspense fallback={<PreviewViewerFallback label="3D 模块加载中…" />}>
              <LazyImageModel3DViewer
                imageSrc={imageSrc!}
                modelSrc={previewModelSrc ?? undefined}
                modelFileName={modelFileName}
                className="h-full w-full min-h-0"
              />
            </Suspense>
          </div>
        ) : null}

        {centerSlot ? (
          <div
            className="absolute top-1/2 z-[4] flex items-center justify-center px-4 box-border w-[min(80rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)]"
            style={{
              left: `calc((100% - ${contentRightInset}) / 2)`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {centerSlot}
          </div>
        ) : null}

        {!centerSlot && !(enablePanoramaMode && previewLayout === 'pano') && !(hasModel3DMode && previewLayout === 'model3d') ? (
          <div
            className={`absolute top-1/2 ${useFrameLock ? 'flex items-center justify-center' : ''}`}
            style={shellStyle}
          >
            <div className="relative inline-block max-w-full max-h-full">
              <img
                key={imageSrc}
                src={imageSrc!}
                className={
                  useFrameLock
                    ? 'block max-h-full max-w-full object-contain rounded-xl select-none cursor-zoom-in'
                    : 'block max-h-[88vh] max-w-[92vw] object-contain rounded-xl select-none cursor-zoom-in'
                }
                style={lockedImgStyle}
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
              {flatImageOverlay ? flatImageOverlay({ imgRef }) : null}
            </div>
          </div>
        ) : null}

        {!uiHidden ? (
        <div className="absolute top-4 left-4 z-10 max-w-[min(300px,calc(100vw-6rem))] pointer-events-none text-left text-[8px] leading-relaxed text-gray-500/70 space-y-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.75)]">
          {enablePanoramaMode && previewLayout === 'pano' ? (
            <>
              <div>拖拽：旋转视角（360° 全景）</div>
              <div>滚轮：调整视野宽窄</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : hasModel3DMode && previewLayout === 'model3d' ? (
            <>
              <div>拖拽：旋转模型</div>
              <div>滚轮：缩放距离</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : centerSlot ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>Shift+滚轮：上一资产 / 下一资产</div>
              <div>Tab：隐藏/显示界面</div>
              <div>Esc：关闭预览</div>
            </>
          ) : typeof onWheelInnerNavigate === 'function' ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>Shift+滚轮：上一资产 / 下一资产</div>
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
        <div
          className="absolute right-4 z-10 flex max-w-[calc(100vw-2rem)] justify-end"
          style={{ top: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
        >
          <div
            className={WORKFLOW_IMAGE_PREVIEW_RAIL}
            onClick={(e) => e.stopPropagation()}
            role="toolbar"
            aria-label="预览工具"
          >
            {/* 显示：预览背景 */}
            <CustomDropdown
              value={lightboxBackdropId}
              onChange={(v) => {
                const next = parseImageLightboxBackdrop(v);
                setLightboxBackdropId(next);
                writeLocalString(LIGHTBOX_BACKDROP_STORAGE_KEY, next);
              }}
              options={LIGHTBOX_BACKDROP_OPTIONS}
              listDensity="compact"
              listClassName="border border-white/[0.12] bg-[#0c0c10]/75 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.5)] ring-1 ring-inset ring-white/[0.06]"
              renderListItem={(opt) => (
                <LightboxBackdropSwatch id={parseImageLightboxBackdrop(opt.value)} />
              )}
              triggerAriaLabel="预览背景"
              triggerClassName={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
              renderTrigger={() => <Contrast {...PV_MODE_IC} aria-hidden />}
              portalZIndex={{ backdrop: 2700, list: 2701 }}
            />
            {topRightExtra ? (
              <>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                <div className="inline-flex items-center gap-1">{topRightExtra}</div>
              </>
            ) : null}
            {!centerSlot && (enablePanoramaMode || hasModel3DMode) ? (
              <>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                <div
                  className={`${TITLE_ROW_STEPPER_SHELL} shrink-0`}
                  role="group"
                  aria-label="预览模式"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewLayout('flat')}
                    className={`${PV_MODE_SEG_BASE} ${previewLayout === 'flat' ? PV_MODE_SEG_ON : PV_MODE_SEG_OFF}`}
                    title="平面预览"
                    aria-label="切换到平面预览"
                    aria-pressed={previewLayout === 'flat'}
                  >
                    <ImageIcon {...PV_MODE_IC} aria-hidden />
                  </button>
                  {enablePanoramaMode ? (
                    <button
                      type="button"
                      onClick={() => setPreviewLayout('pano')}
                      className={`${PV_MODE_SEG_BASE} border-l border-white/[0.08] ${
                        previewLayout === 'pano' ? PV_MODE_SEG_ON : PV_MODE_SEG_OFF
                      }`}
                      title="全景预览"
                      aria-label="切换到全景预览"
                      aria-pressed={previewLayout === 'pano'}
                    >
                      <Globe2 {...PV_MODE_IC} aria-hidden />
                    </button>
                  ) : null}
                  {hasModel3DMode ? (
                    <button
                      type="button"
                      onClick={() => setPreviewLayout('model3d')}
                      className={`${PV_MODE_SEG_BASE} border-l border-white/[0.08] ${
                        previewLayout === 'model3d' ? PV_MODE_SEG_ON : PV_MODE_SEG_OFF
                      }`}
                      title="3D 预览"
                      aria-label="切换到 3D 预览"
                      aria-pressed={previewLayout === 'model3d'}
                    >
                      <Box {...PV_MODE_IC} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
            <button
              type="button"
              onClick={onClose}
              className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
              title="关闭"
              aria-label="关闭预览"
            >
              <X {...PV_MODE_IC} aria-hidden />
            </button>
          </div>
        </div>
        ) : null}

        {!uiHidden ? children : null}
    </PreviewShell>
  );
}
