import React, { Suspense, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getLazyImagePreviewViewer,
  PreviewShell,
  PreviewViewerErrorBoundary,
  PreviewViewerFallback,
  PreviewImageLoadingState,
  previewPolicyForMode,
  type ImagePreviewCanvasAdjustControl,
  type ImagePreviewLayoutMode,
  type ImagePreviewWebCaptureApi,
  type Model3DDisplayMode,
} from './preview';
import {
  IMAGE_PREVIEW_PIXEL_SAMPLE_MAX_EDGE,
  imageNaturalIndicesFromClientPoint,
  readRgbFromCanvasMappedNatural,
} from '../services/imagePreviewPointerGeometry';
import { Box, Contrast, Globe2, GripHorizontal, Image as ImageIcon, Mountain, Save, Scaling, X } from 'lucide-react';
import { readLocalString, writeLocalString } from '../services/clientPersist';
import {
  isWorkflowLightboxBootAtLeast,
  WORKFLOW_LIGHTBOX_BOOT_RANK,
  type WorkflowLightboxBootPhase,
} from '../hooks/useWorkflowLightboxBoot';
import { CustomDropdown } from './ui/CustomDropdown';
import {
  IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE,
  TITLE_ROW_STEPPER_SHELL,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflow/workflowSectionUiConstants';
import type { PanoramaViewportProjection } from '../services/panoViewportProjection';
import { ImagePreviewSplitStretchOverlay, type ImagePreviewSplitStretchExportState } from './ImagePreviewSplitStretchOverlay';
import { ImagePreviewSplitStretchWriteBackPopover } from './ImagePreviewSplitStretchWriteBackPopover';
import { ImagePreviewWorkflowResizePopover } from './ImagePreviewWorkflowResizePopover';
import type { WorkflowLightboxImageWriteBackPayload } from '../services/imagePreviewWorkflowResize';

const NO_WHEEL = '[data-image-preview-no-wheel]';
const SCROLL = '[data-image-preview-scroll]';
/** 大图右侧缩略图条：滚轮仅滚动列表，不切换主预览 */
const LIGHTBOX_THUMB_STRIP_SCROLL = '[data-lightbox-asset-thumb-strip-scroll]';

function wheelEventDeltaY(e: WheelEvent): number {
  let dy = e.deltaY;
  const dx = e.deltaX;
  if (Math.abs(dx) > Math.abs(dy)) dy = dx;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= 120;
  if (!dy && typeof (e as unknown as { wheelDelta?: number }).wheelDelta === 'number') {
    dy = -(e as unknown as { wheelDelta: number }).wheelDelta / 3;
  }
  return dy;
}

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

/** 工作流列表卸载后的静态底图仍可见时，遮罩需半透明 */
const LIGHTBOX_BACKDROP_OVER_LIST_CLASS: Record<ImageLightboxBackdropId, string> = {
  frosted: 'bg-black/58 backdrop-blur-md',
  black: 'bg-black/45',
  gray50: 'bg-[#808080]/55',
  white: 'bg-white/55',
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

/** 与 `LIGHTBOX_BACKDROP_OPTIONS` 顺序一致，对应数字键 1～4 */
const LIGHTBOX_BACKDROP_HOTKEY_ORDER: readonly ImageLightboxBackdropId[] = LIGHTBOX_BACKDROP_OPTIONS.map(
  (o) => o.value
);

function isKeyboardTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  return t.closest('input, textarea, select, [contenteditable="true"]') != null;
}

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
  /** 3D 模型显示模式，由父级工具条控制 */
  model3dDisplayMode?: Model3DDisplayMode;
  /** 右侧占位宽度（如常驻侧栏），用于将主图居中到左侧可用区域 */
  contentRightInset?: string;
  /**
   * 与 `contentRightInset` 配套的右纵列（缩略图条 / 快捷侧栏）。
   * 提供时主预览区与右列 flex 分栏，侧栏参与布局而非叠在画面上。
   */
  rightRail?: React.ReactNode;
  /**
   * 全屏壳右侧留白（与 App 级快捷侧栏同宽），预览不覆盖该区域。
   */
  shellRightGutter?: string;
  /** 左侧占位宽度（如 VGP 步骤节点图），与 contentRightInset 一起约束 centerSlot 可用区域 */
  contentLeftInset?: string;
  /**
   * 传给 PreviewShell 的全屏层 z-index（Tailwind 类）。嵌套在更高 z 的全屏壳内（如工作流编排 `z-[2100]`）时必须高于父层，否则预览会显示在父层背后。
   */
  shellZIndexClassName?: string;
  /** 遮罩下的静态底图（如工作流列表卸载前的截图） */
  backdropImageSrc?: string | null;
  /** 主图解码前的占位（如网格缩略图），配合壳层先开 */
  placeholderImageSrc?: string | null;
  /** 工作流分阶段启动：T0 仅壳+关闭，T2 完整工具条，T3 侧栏/标注 */
  bootPhase?: WorkflowLightboxBootPhase;
  /** 主图首帧 decode 完成（进入 T2） */
  onPrimaryImageReady?: () => void;
  /** 右上角「平面/全景/关闭」左侧：额外控件（如工作流下载、丢弃版本） */
  topRightExtra?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * 平面预览时叠在 `<img>` 上的内容（与图同层、受同一套 scale/translate 影响）。
   * 全景 + 标注桥接时叠在与 WebGL 同矩的容器内（见 `FlatImageOverlayContext`）。
   */
  flatImageOverlay?: (ctx: FlatImageOverlayContext) => React.ReactNode;
  /**
   * 由父组件持有时，全景懒加载 Viewer 挂载后会写入，可用于 `captureViewDataUrl`（如视口矩形裁切导出）。
   */
  panoViewerRef?: React.RefObject<PanoramaViewportProjection | null>;
  /**
   * 若提供：高度 3D 工具条 portal 到该元素（如工作流右侧详情列上方），不再占用顶栏旁槽位。
   */
  heightfieldToolbarHostRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * 若提供：线分割 / 改尺寸写回 state 由父级持有（与 `ImageAnnotationLightboxToolbar` 主栏按钮共用）；未提供时由壳内 state + 顶栏内联按钮承担。
   */
  canvasAdjustControl?: ImagePreviewCanvasAdjustControl | null;
  /** 平面模式下在主图上移动指针时回调当前像素 RGB（离开图内容区或无法采样时为 null） */
  onFlatImagePixelSample?: (rgb: { r: number; g: number; b: number } | null) => void;
  /** 平面 / 全景 / 高度 3D / 3D 模型 切换时通知父级（用于大图标注按模式分桶） */
  onPreviewLayoutChange?: (layout: ImagePreviewLayoutMode) => void;
  /** Tab 隐藏/显示界面时通知父级（用于同步隐藏工作流侧栏、标注条等） */
  onUiHiddenChange?: (hidden: boolean) => void;
  /**
   * 注册「截取当前预览画面」能力：全景用 `panoViewerRef`；高度 3D / 模型 3D 用宿主内 WebGL canvas。
   * 卸载时传 `null`。
   */
  onWebPreviewCaptureApiChange?: (api: ImagePreviewWebCaptureApi | null) => void;
  /**
   * 为真时：平面主图不响应缩放/平移等 `onMouseDown` 手势（如本机 SAM 武装时点选/框选需独占指针）。
   */
  suppressFlatImageInteraction?: boolean;
  /**
   * 工作流大图：平面下将当前预览（含线分割变形）按设定等比尺寸写回资产；非平面（全景 / 高度 3D / 模型 3D）时入口灰显。
   */
  imageResizeWriteBack?: {
    onCommit: (payload: WorkflowLightboxImageWriteBackPayload) => void | Promise<void>;
  } | null;
};

export type FlatImageOverlayContext = {
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** 仅全景桥接时：与 WebGL 画布同尺寸的叠层根（`absolute inset-0`） */
  panoOverlayContainerRef: React.RefObject<HTMLDivElement | null> | undefined;
  panoProjectionRef: React.RefObject<PanoramaViewportProjection | null> | undefined;
  /** 全景 Viewer 挂载/卸载时递增，驱动叠层在 `ref.current` 就绪后重渲染并挂上 `subscribeAnimation` */
  panoViewerBindEpoch?: number;
  previewLayout: ImagePreviewLayoutMode;
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
/** 高度 3D（置换）Viewer 独立 chunk */
const LazyImageHeightfieldViewer = getLazyImagePreviewViewer('image.heightfield');

/** `lazy()` 包一层 `Suspense`，并把 ref 交到内层 `forwardRef` Viewer */
const PanoEquirectLazyView = forwardRef<
  PanoramaViewportProjection | null,
  { imageSrc: string; className?: string; panoPreserveViewKey?: string }
>(function PanoEquirectLazyView(props, ref) {
    if (!LazyImageEquirectViewer) return null;
    return (
      <PreviewViewerErrorBoundary mode="image.equirect" label="全景">
        <Suspense fallback={<PreviewViewerFallback label="全景模块加载中…" />}>
          <LazyImageEquirectViewer {...props} ref={ref} />
        </Suspense>
      </PreviewViewerErrorBoundary>
    );
  }
);

/**
 * 全屏大图预览：滚轮切图、Esc 关闭、双击复原、左键拖拽缩放（按下处为轴）、空格/Shift+左键/右键平移；多资产时 Shift+滚轮切资产。
 * 平面模式：Q 循环平面 / 全景 / 高度 3D / 3D 模型（有则显）、W 移动画布模式、Z/X 缩放、R+拖拽旋转（Shift 10° 档）。
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
  model3dDisplayMode = 'material',
  contentRightInset = '0px',
  contentLeftInset = '0px',
  rightRail,
  shellRightGutter,
  shellZIndexClassName,
  backdropImageSrc,
  placeholderImageSrc,
  bootPhase = 't3',
  onPrimaryImageReady,
  topRightExtra,
  children,
  flatImageOverlay,
  panoViewerRef: panoViewerRefProp,
  heightfieldToolbarHostRef,
  canvasAdjustControl,
  onFlatImagePixelSample,
  onPreviewLayoutChange,
  onUiHiddenChange,
  onWebPreviewCaptureApiChange,
  suppressFlatImageInteraction = false,
  imageResizeWriteBack = null,
}: ImagePreviewOverlayProps) {
  const [previewLayout, setPreviewLayout] = useState<ImagePreviewLayoutMode>('flat');

  const setPreviewLayoutAndNotify = useCallback(
    (updater: React.SetStateAction<ImagePreviewLayoutMode>) => {
      setPreviewLayout((cur) => {
        const n = typeof updater === 'function' ? (updater as (c: typeof cur) => typeof cur)(cur) : updater;
        queueMicrotask(() => onPreviewLayoutChange?.(n));
        return n;
      });
    },
    [onPreviewLayoutChange]
  );
  const [lightboxBackdropId, setLightboxBackdropId] = useState<ImageLightboxBackdropId>(() =>
    parseImageLightboxBackdrop(readLocalString(LIGHTBOX_BACKDROP_STORAGE_KEY))
  );
  const [uiHidden, setUiHidden] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** 平面画布旋转（度），作用于内层包装 + transformOrigin，R+拖拽以按下点为枢轴 */
  const [flatRotationDeg, setFlatRotationDeg] = useState(0);
  /** 相对内层包装左上角；null 时用 50% 50% */
  const [rotOriginLocal, setRotOriginLocal] = useState<{ x: number; y: number } | null>(null);
  /** W 键：左键拖移始终为平移画布（否则左键为缩放拖移；空格仍临时平移） */
  const [canvasPanArmed, setCanvasPanArmed] = useState(false);
  /** 平面模式：线分割纵向变形（画布预览 + 可拖分割线） */
  const [internalSplitStretchEnabled, setInternalSplitStretchEnabled] = useState(false);
  const [internalSplitStretchWriteBackPopOpen, setInternalSplitStretchWriteBackPopOpen] = useState(false);
  const [internalResizeWriteBackPopOpen, setInternalResizeWriteBackPopOpen] = useState(false);
  const splitStretchEnabled =
    canvasAdjustControl != null ? canvasAdjustControl.splitStretchEnabled : internalSplitStretchEnabled;
  const setSplitStretchEnabled =
    canvasAdjustControl?.setSplitStretchEnabled ?? setInternalSplitStretchEnabled;
  const splitStretchWriteBackPopOpen =
    canvasAdjustControl != null
      ? canvasAdjustControl.splitStretchWriteBackPopOpen
      : internalSplitStretchWriteBackPopOpen;
  const setSplitStretchWriteBackPopOpen =
    canvasAdjustControl?.setSplitStretchWriteBackPopOpen ?? setInternalSplitStretchWriteBackPopOpen;
  const resizeWriteBackPopOpen =
    canvasAdjustControl != null ? canvasAdjustControl.resizeWriteBackPopOpen : internalResizeWriteBackPopOpen;
  const setResizeWriteBackPopOpen =
    canvasAdjustControl?.setResizeWriteBackPopOpen ?? setInternalResizeWriteBackPopOpen;
  const splitStretchExportRef = useRef<ImagePreviewSplitStretchExportState | null>(null);
  const [lockedDominant, setLockedDominant] = useState<{ axis: 'width' | 'height'; size: number } | null>(null);
  const [primaryImageReady, setPrimaryImageReady] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const internalPanoViewerRef = useRef<PanoramaViewportProjection | null>(null);
  const panoViewerRef = panoViewerRefProp ?? internalPanoViewerRef;
  /** 懒加载全景挂载后 `ref.current` 才可用，用 epoch 触发叠层重渲染（否则 `ready` 恒为 false） */
  const [panoViewerBindEpoch, setPanoViewerBindEpoch] = useState(0);
  const panoViewerLastNodeRef = useRef<PanoramaViewportProjection | null>(null);
  const assignPanoViewerRef = useCallback(
    (node: PanoramaViewportProjection | null) => {
      (panoViewerRef as React.MutableRefObject<PanoramaViewportProjection | null>).current = node;
      if (panoViewerLastNodeRef.current !== node) {
        panoViewerLastNodeRef.current = node;
        setPanoViewerBindEpoch((n) => n + 1);
      }
    },
    [panoViewerRef]
  );
  const panoOverlayHostRef = useRef<HTMLDivElement | null>(null);
  /** 高度 3D / 模型 3D 预览根容器，用于截取 WebGL 当前帧 */
  const webglPreviewHostRef = useRef<HTMLDivElement | null>(null);
  const innerWrapRef = useRef<HTMLDivElement | null>(null);
  const rotateDragRef = useRef<{ pivotX: number; pivotY: number; lastRad: number | null } | null>(null);
  const rKeyPressedRef = useRef(false);
  const pixelSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pixelSampleMetaRef = useRef<string>('');
  const syncPixelSampleBuffer = useCallback((img: HTMLImageElement): boolean => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return false;
    const srcKey = `${String(imageSrc ?? '')}|${nw}x${nh}`;
    if (pixelSampleCanvasRef.current && pixelSampleMetaRef.current === srcKey) return true;
    try {
      const maxDim = Math.max(nw, nh);
      const scale =
        maxDim > IMAGE_PREVIEW_PIXEL_SAMPLE_MAX_EDGE ? IMAGE_PREVIEW_PIXEL_SAMPLE_MAX_EDGE / maxDim : 1;
      const tw = Math.max(1, Math.floor(nw * scale));
      const th = Math.max(1, Math.floor(nh * scale));
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, nw, nh, 0, 0, tw, th);
      pixelSampleCanvasRef.current = c;
      pixelSampleMetaRef.current = srcKey;
      return true;
    } catch {
      pixelSampleCanvasRef.current = null;
      pixelSampleMetaRef.current = '';
      return false;
    }
  }, [imageSrc]);

  const dragRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);
  const zoomPivotRef = useRef<{ x: number; y: number } | null>(null);
  const zoomLastScaleRef = useRef(1);
  /** 与 React state 同步；拖动手势内由 mousemove 直接改写，经 rAF 合并回写 state，避免一帧多次 setState */
  const scaleLiveRef = useRef(1);
  const offsetLiveRef = useRef({ x: 0, y: 0 });
  const flatRotLiveRef = useRef(0);
  const gestureFlushRafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    scaleLiveRef.current = scale;
    offsetLiveRef.current = { x: offset.x, y: offset.y };
    flatRotLiveRef.current = flatRotationDeg;
  }, [scale, offset.x, offset.y, flatRotationDeg]);

  const flushGestureToReact = useCallback(() => {
    gestureFlushRafRef.current = null;
    setScale(scaleLiveRef.current);
    setOffset({ x: offsetLiveRef.current.x, y: offsetLiveRef.current.y });
    setFlatRotationDeg(flatRotLiveRef.current);
  }, []);

  const scheduleGestureFlush = useCallback(() => {
    if (gestureFlushRafRef.current != null) return;
    gestureFlushRafRef.current = requestAnimationFrame(() => {
      flushGestureToReact();
    });
  }, [flushGestureToReact]);
  const spacePressedRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelLastNavigateAtRef = useRef(0);
  const previewModelSrc = pickPreviewableModelUrl(modelUrls);
  const hasModel3DMode = Boolean(!centerSlot && previewModelSrc && LazyImageModel3DViewer);
  const hasHeightfieldMode = Boolean(!centerSlot && imageSrc?.trim() && LazyImageHeightfieldViewer);
  const panoLayoutActive = Boolean(!centerSlot && enablePanoramaMode && previewLayout === 'pano');
  const model3dLayoutActive = Boolean(!centerSlot && hasModel3DMode && previewLayout === 'model3d');
  const heightfieldLayoutActive = Boolean(!centerSlot && hasHeightfieldMode && previewLayout === 'heightfield');
  const heightfieldToolbarSlotRef = useRef<HTMLDivElement | null>(null);
  const [heightfieldToolbarHostEl, setHeightfieldToolbarHostEl] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!heightfieldLayoutActive || uiHidden) {
      setHeightfieldToolbarHostEl((h) => (h ? null : h));
      return;
    }
    const external = heightfieldToolbarHostRef?.current ?? null;
    const internal = heightfieldToolbarHostRef ? null : heightfieldToolbarSlotRef.current;
    const el = external ?? internal;
    setHeightfieldToolbarHostEl((prev) => (prev === el ? prev : el));
  }, [heightfieldLayoutActive, uiHidden, heightfieldToolbarHostRef, resetKey]);

  const webPreviewCaptureApi = useMemo<ImagePreviewWebCaptureApi>(
    () => ({
      captureCurrentViewAsDataUrl: () => {
        const layout = previewLayout;
        if (layout === 'pano') {
          const u = panoViewerRef.current?.captureViewDataUrl('image/png');
          const s = String(u || '').trim();
          return s.startsWith('data:') ? s : null;
        }
        if (layout === 'heightfield' || layout === 'model3d') {
          const root = webglPreviewHostRef.current;
          if (!root) return null;
          const c = root.querySelector('canvas');
          if (!(c instanceof HTMLCanvasElement) || c.width < 2 || c.height < 2) return null;
          try {
            return c.toDataURL('image/png');
          } catch {
            return null;
          }
        }
        return null;
      },
    }),
    [previewLayout, panoViewerRef]
  );

  useEffect(() => {
    if (!onWebPreviewCaptureApiChange) return;
    onWebPreviewCaptureApiChange(webPreviewCaptureApi);
    return () => onWebPreviewCaptureApiChange(null);
  }, [onWebPreviewCaptureApiChange, webPreviewCaptureApi]);

  /** 全景模式下叠一层与平面一致的 object-contain 贴图 + 标注，使裁切/局部重绘等仍可用（底图透明，仍见 WebGL 全景） */
  const panoAnnotationBridge = Boolean(panoLayoutActive && flatImageOverlay);
  const showFlatImageColumn = Boolean(
    !centerSlot &&
      !model3dLayoutActive &&
      !heightfieldLayoutActive &&
      (!panoLayoutActive || Boolean(flatImageOverlay))
  );
  /** 全景桥接时标注在全屏叠层，不再走中央「缩放壳」里的那条柱 */
  const flatAnnotationColumnOutsidePanoStack = Boolean(showFlatImageColumn && !panoAnnotationBridge);
  const flatPixelSampleActive =
    Boolean(onFlatImagePixelSample) &&
    open &&
    !centerSlot &&
    Boolean(imageSrc?.trim()) &&
    (previewLayout === 'flat' || (panoLayoutActive && Boolean(flatImageOverlay)));

  const flatNavigateCanvasOk = Boolean(
    showFlatImageColumn && previewLayout === 'flat' && !panoAnnotationBridge && !centerSlot
  );
  const splitStretchUiOk = Boolean(flatNavigateCanvasOk && !suppressFlatImageInteraction);
  const resizeWriteBackUiOk = Boolean(flatNavigateCanvasOk && !centerSlot && imageResizeWriteBack);

  const splitResizeToolbarInner = useMemo(() => {
    if (canvasAdjustControl) return null;
    if (!(splitStretchUiOk || resizeWriteBackUiOk)) return null;
    return (
      <>
        {splitStretchUiOk ? (
          <>
            <button
              type="button"
              onClick={() => setSplitStretchEnabled((v) => !v)}
              className={
                splitStretchEnabled
                  ? `${IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE} bg-blue-600/35 ring-2 ring-inset ring-blue-400/40`
                  : IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE
              }
              title="线分割变形：拖蓝色条调整上下区域纵向比例；再次点击关闭"
              aria-label="线分割变形"
              aria-pressed={splitStretchEnabled}
            >
              <GripHorizontal {...PV_MODE_IC} aria-hidden />
            </button>
            {splitStretchEnabled && imageResizeWriteBack ? (
              <button
                type="button"
                onClick={() => {
                  setResizeWriteBackPopOpen(false);
                  setSplitStretchWriteBackPopOpen(true);
                }}
                className={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
                title="确认将线分割变形写回当前工作流版本"
                aria-label="线分割写回资产"
              >
                <Save {...PV_MODE_IC} aria-hidden />
              </button>
            ) : null}
          </>
        ) : null}
        {resizeWriteBackUiOk ? (
          <button
            type="button"
            onClick={() => {
              if (previewLayout !== 'flat') return;
              setSplitStretchWriteBackPopOpen(false);
              setResizeWriteBackPopOpen((o) => !o);
            }}
            disabled={previewLayout !== 'flat'}
            className={
              previewLayout !== 'flat'
                ? `${IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE} cursor-not-allowed opacity-40`
                : resizeWriteBackPopOpen
                  ? `${IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE} bg-blue-600/35 ring-2 ring-inset ring-blue-400/40`
                  : IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE
            }
            title={
              previewLayout !== 'flat'
                ? '请切换到「平面」预览后再改尺寸写回'
                : '改尺寸写回当前版本（等比缩放；写回后清除本版本标注）'
            }
            aria-label="改尺寸写回资产"
            aria-pressed={resizeWriteBackPopOpen}
          >
            <Scaling {...PV_MODE_IC} aria-hidden />
          </button>
        ) : null}
      </>
    );
  }, [
    canvasAdjustControl,
    splitStretchUiOk,
    resizeWriteBackUiOk,
    splitStretchEnabled,
    imageResizeWriteBack,
    previewLayout,
    resizeWriteBackPopOpen,
  ]);

  const modeSwitchRail = useMemo(() => {
    if (centerSlot || (!enablePanoramaMode && !hasModel3DMode && !hasHeightfieldMode)) return null;
    return (
      <div className={`${TITLE_ROW_STEPPER_SHELL} shrink-0`} role="group" aria-label="预览模式">
        <button
          type="button"
          onClick={() => setPreviewLayoutAndNotify('flat')}
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
            onClick={() => setPreviewLayoutAndNotify('pano')}
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
        {hasHeightfieldMode ? (
          <button
            type="button"
            onClick={() => setPreviewLayoutAndNotify('heightfield')}
            className={`${PV_MODE_SEG_BASE} border-l border-white/[0.08] ${
              previewLayout === 'heightfield' ? PV_MODE_SEG_ON : PV_MODE_SEG_OFF
            }`}
            title="高度 3D：按图片亮度显示置换表面"
            aria-label="切换到高度 3D 预览"
            aria-pressed={previewLayout === 'heightfield'}
          >
            <Mountain {...PV_MODE_IC} aria-hidden />
          </button>
        ) : null}
        {hasModel3DMode ? (
          <button
            type="button"
            onClick={() => setPreviewLayoutAndNotify('model3d')}
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
    );
  }, [
    centerSlot,
    enablePanoramaMode,
    hasModel3DMode,
    hasHeightfieldMode,
    previewLayout,
    setPreviewLayoutAndNotify,
  ]);

  const applyKeyedZoom = useCallback(
    (grow: boolean) => {
      if (!flatNavigateCanvasOk) return;
      const factor = grow ? 1.12 : 1 / 1.12;
      setScale((prevS) => {
        const nextS = Math.max(0.2, Math.min(6, prevS * factor));
        return Math.abs(nextS - prevS) < 1e-9 ? prevS : nextS;
      });
    },
    [flatNavigateCanvasOk]
  );

  const splitLayoutActive = rightRail != null && contentRightInset !== '0px';

  const syncPrimaryImageReadyFromDom = useCallback((): boolean => {
    if (!open || centerSlot || !imageSrc?.trim()) return false;
    const im = imgRef.current;
    if (im?.complete && im.naturalWidth > 0 && im.naturalHeight > 0) {
      setPrimaryImageReady(true);
      return true;
    }
    return false;
  }, [open, centerSlot, imageSrc]);

  useLayoutEffect(() => {
    setPrimaryImageReady(false);
    if (!open || centerSlot || !imageSrc?.trim()) return;
    syncPrimaryImageReadyFromDom();
  }, [open, centerSlot, imageSrc, resetKey, syncPrimaryImageReadyFromDom]);

  /** split 布局切换会 remount `<img>`，缓存命中时可能不再触发 onLoad */
  useLayoutEffect(() => {
    if (!open || centerSlot || !imageSrc?.trim()) return;
    if (!syncPrimaryImageReadyFromDom()) {
      const raf = requestAnimationFrame(() => syncPrimaryImageReadyFromDom());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [
    open,
    centerSlot,
    imageSrc,
    resetKey,
    splitLayoutActive,
    flatAnnotationColumnOutsidePanoStack,
    syncPrimaryImageReadyFromDom,
  ]);

  useLayoutEffect(() => {
    if (!open || !centerSlot) return;
    onPrimaryImageReady?.();
  }, [open, centerSlot, resetKey, onPrimaryImageReady]);

  useEffect(() => {
    if (!open || !primaryImageReady || centerSlot) return;
    onPrimaryImageReady?.();
  }, [open, primaryImageReady, centerSlot, onPrimaryImageReady]);

  useEffect(() => {
    if (!open) return;
    setPreviewLayoutAndNotify('flat');
    setUiHidden(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setFlatRotationDeg(0);
    setRotOriginLocal(null);
    setCanvasPanArmed(false);
    dragRef.current = null;
    panRef.current = null;
    zoomPivotRef.current = null;
    zoomLastScaleRef.current = 1;
    rotateDragRef.current = null;
    rKeyPressedRef.current = false;
    wheelAccumRef.current = 0;
    wheelLastNavigateAtRef.current = 0;
    setSplitStretchEnabled(false);
    setSplitStretchWriteBackPopOpen(false);
    setResizeWriteBackPopOpen(false);
  }, [open, resetKey, setPreviewLayoutAndNotify]);

  useEffect(() => {
    onUiHiddenChange?.(uiHidden);
  }, [uiHidden, onUiHiddenChange]);

  useEffect(() => {
    if (!uiHidden) return;
    setSplitStretchWriteBackPopOpen(false);
    setResizeWriteBackPopOpen(false);
  }, [uiHidden]);

  useLayoutEffect(() => {
    if (!splitStretchUiOk || !splitStretchEnabled) {
      splitStretchExportRef.current = { active: false, lineFrac: 0.5, splitNaturalY: 0 };
    }
  }, [splitStretchUiOk, splitStretchEnabled]);

  useEffect(() => {
    if (previewLayout !== 'flat') {
      setSplitStretchEnabled(false);
      setSplitStretchWriteBackPopOpen(false);
      setResizeWriteBackPopOpen(false);
    }
  }, [previewLayout]);

  useEffect(() => {
    if (!splitStretchEnabled) setSplitStretchWriteBackPopOpen(false);
  }, [splitStretchEnabled]);

  /** 避免每帧 pointermove 触发父级（如 WorkflowSection）setState → 整树重绘 */
  const lastFlatPixelSampleSigRef = useRef<string | null>(null);
  const flatPixelSampleFlushRafRef = useRef<number | null>(null);
  const flatPixelSamplePendingRef = useRef<{ clientX: number; clientY: number } | null>(null);

  useLayoutEffect(() => {
    pixelSampleCanvasRef.current = null;
    pixelSampleMetaRef.current = '';
    lastFlatPixelSampleSigRef.current = null;
    if (flatPixelSampleFlushRafRef.current != null) {
      cancelAnimationFrame(flatPixelSampleFlushRafRef.current);
      flatPixelSampleFlushRafRef.current = null;
    }
    flatPixelSamplePendingRef.current = null;
    onFlatImagePixelSample?.(null);
  }, [imageSrc, resetKey, innerLayoutStableKey, open, onFlatImagePixelSample]);

  useEffect(() => {
    if (!onFlatImagePixelSample) return;
    if (!flatPixelSampleActive) {
      lastFlatPixelSampleSigRef.current = null;
      if (flatPixelSampleFlushRafRef.current != null) {
        cancelAnimationFrame(flatPixelSampleFlushRafRef.current);
        flatPixelSampleFlushRafRef.current = null;
      }
      flatPixelSamplePendingRef.current = null;
      onFlatImagePixelSample(null);
    }
  }, [flatPixelSampleActive, onFlatImagePixelSample]);

  useEffect(() => {
    if (!flatPixelSampleActive || !onFlatImagePixelSample) {
      return;
    }
    const emitIfChanged = (sig: string, payload: { r: number; g: number; b: number } | null) => {
      if (sig === lastFlatPixelSampleSigRef.current) return;
      lastFlatPixelSampleSigRef.current = sig;
      onFlatImagePixelSample(payload);
    };
    const flush = () => {
      flatPixelSampleFlushRafRef.current = null;
      const pending = flatPixelSamplePendingRef.current;
      flatPixelSamplePendingRef.current = null;
      if (!pending) return;
      const img = imgRef.current;
      if (!img) {
        emitIfChanged('null', null);
        return;
      }
      const r = img.getBoundingClientRect();
      if (
        pending.clientX < r.left ||
        pending.clientX >= r.right ||
        pending.clientY < r.top ||
        pending.clientY >= r.bottom
      ) {
        emitIfChanged('null', null);
        return;
      }
      if (!syncPixelSampleBuffer(img)) {
        emitIfChanged('null', null);
        return;
      }
      const canvas = pixelSampleCanvasRef.current;
      if (!canvas) {
        emitIfChanged('null', null);
        return;
      }
      const idx = imageNaturalIndicesFromClientPoint(img, pending.clientX, pending.clientY);
      if (!idx) {
        emitIfChanged('null', null);
        return;
      }
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) {
        emitIfChanged('null', null);
        return;
      }
      const rgb = readRgbFromCanvasMappedNatural(canvas, nw, nh, idx.ix, idx.iy);
      emitIfChanged(`${rgb.r},${rgb.g},${rgb.b}`, rgb);
    };
    const onMove = (e: PointerEvent) => {
      flatPixelSamplePendingRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (flatPixelSampleFlushRafRef.current == null) {
        flatPixelSampleFlushRafRef.current = requestAnimationFrame(flush);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (flatPixelSampleFlushRafRef.current != null) {
        cancelAnimationFrame(flatPixelSampleFlushRafRef.current);
        flatPixelSampleFlushRafRef.current = null;
      }
      flatPixelSamplePendingRef.current = null;
    };
  }, [flatPixelSampleActive, onFlatImagePixelSample, syncPixelSampleBuffer]);

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
    const canCyclePreviewMode = Boolean(imageSrc?.trim() && !centerSlot);
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
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !isKeyboardTypingTarget(e.target)) {
        if (e.code === 'KeyQ' && canCyclePreviewMode) {
          const modes: ImagePreviewLayoutMode[] = ['flat'];
          if (enablePanoramaMode) modes.push('pano');
          if (hasHeightfieldMode) modes.push('heightfield');
          if (hasModel3DMode) modes.push('model3d');
          if (modes.length >= 2) {
            e.preventDefault();
            setPreviewLayoutAndNotify((cur) => {
              const i = modes.indexOf(cur);
              const from = i >= 0 ? i : 0;
              return modes[(from + 1) % modes.length] ?? 'flat';
            });
          }
          return;
        }
        if (e.code === 'KeyW') {
          e.preventDefault();
          setCanvasPanArmed((v) => !v);
          return;
        }
        if (e.code === 'KeyR') {
          e.preventDefault();
          rKeyPressedRef.current = true;
          return;
        }
        if (e.code === 'KeyZ') {
          e.preventDefault();
          applyKeyedZoom(true);
          return;
        }
        if (e.code === 'KeyX') {
          e.preventDefault();
          applyKeyedZoom(false);
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        if (!isKeyboardTypingTarget(e.target)) {
          e.preventDefault();
          const idx = Number(e.key) - 1;
          const next = LIGHTBOX_BACKDROP_HOTKEY_ORDER[idx];
          if (next) {
            setLightboxBackdropId(next);
            writeLocalString(LIGHTBOX_BACKDROP_STORAGE_KEY, next);
          }
        }
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
      if (e.code === 'KeyR') {
        rKeyPressedRef.current = false;
      }
    };
    const onBlur = () => {
      spacePressedRef.current = false;
      rKeyPressedRef.current = false;
      rotateDragRef.current = null;
    };
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [
    open,
    onClose,
    imageSrc,
    centerSlot,
    enablePanoramaMode,
    hasModel3DMode,
    hasHeightfieldMode,
    applyKeyedZoom,
    setPreviewLayoutAndNotify,
  ]);

  useEffect(() => {
    if (!open) return;
    const onWheel = (e: WheelEvent) => {
      const viewerCapturesWheel =
        (enablePanoramaMode && previewLayout === 'pano' && previewPolicyForMode('image.equirect').captureGlobalWheel) ||
        (hasModel3DMode && previewLayout === 'model3d' && previewPolicyForMode('image.model3d').captureGlobalWheel) ||
        (hasHeightfieldMode &&
          previewLayout === 'heightfield' &&
          previewPolicyForMode('image.heightfield').captureGlobalWheel);
      if (viewerCapturesWheel) return;

      const innerMode = typeof onWheelInnerNavigate === 'function';
      const shiftAssetNav = e.shiftKey && wheelListLength > 1;

      const t = e.target;
      if (!shiftAssetNav && t instanceof Element) {
        const thumbStrip = t.closest(LIGHTBOX_THUMB_STRIP_SCROLL) as HTMLElement | null;
        if (thumbStrip) {
          e.preventDefault();
          e.stopPropagation();
          const dy = wheelEventDeltaY(e);
          if (Math.abs(dy) >= 0.25 && thumbStrip.scrollHeight > thumbStrip.clientHeight + 1) {
            thumbStrip.scrollTop += dy;
          }
          return;
        }
      }
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
      const dy = wheelEventDeltaY(e);
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
    hasHeightfieldMode,
    wheelListLength,
    onWheelNavigate,
    onWheelInnerNavigate,
    innerWheelOptionCount,
  ]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const rot = rotateDragRef.current;
      if (rot) {
        const a = Math.atan2(e.clientY - rot.pivotY, e.clientX - rot.pivotX);
        if (rot.lastRad == null) {
          rot.lastRad = a;
          return;
        }
        let delta = a - rot.lastRad;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        rot.lastRad = a;
        const deltaDeg = (delta * 180) / Math.PI;
        let next = flatRotLiveRef.current + deltaDeg;
        if (e.shiftKey) next = Math.round(next / 10) * 10;
        flatRotLiveRef.current = next;
        scheduleGestureFlush();
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        const nextScale = Math.max(0.2, Math.min(6, drag.startScale + (dx - dy) * 0.005));
        const prevS = zoomLastScaleRef.current;
        const pivot = zoomPivotRef.current;
        const img = imgRef.current;
        let nextOffset = offsetLiveRef.current;
        if (img && pivot && Math.abs(nextScale - prevS) > 1e-9) {
          const rect = img.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const f = 1 - nextScale / prevS;
          nextOffset = {
            x: offsetLiveRef.current.x + f * (pivot.x - cx),
            y: offsetLiveRef.current.y + f * (pivot.y - cy),
          };
          zoomLastScaleRef.current = nextScale;
        } else if (Math.abs(nextScale - prevS) > 1e-9) {
          zoomLastScaleRef.current = nextScale;
        }
        offsetLiveRef.current = nextOffset;
        scaleLiveRef.current = nextScale;
        scheduleGestureFlush();
      }
      const pan = panRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        offsetLiveRef.current = { x: pan.startOffsetX + dx, y: pan.startOffsetY + dy };
        scheduleGestureFlush();
      }
    };
    const onMouseUp = () => {
      if (gestureFlushRafRef.current != null) {
        cancelAnimationFrame(gestureFlushRafRef.current);
        gestureFlushRafRef.current = null;
        flushGestureToReact();
      }
      rotateDragRef.current = null;
      dragRef.current = null;
      panRef.current = null;
      zoomPivotRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      if (gestureFlushRafRef.current != null) {
        cancelAnimationFrame(gestureFlushRafRef.current);
        gestureFlushRafRef.current = null;
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [flushGestureToReact, scheduleGestureFlush]);

  const handleImgMouseDown = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) {
        if (rKeyPressedRef.current) {
          const wrap = innerWrapRef.current;
          if (wrap) {
            const r = wrap.getBoundingClientRect();
            setRotOriginLocal({ x: e.clientX - r.left, y: e.clientY - r.top });
          }
          rotateDragRef.current = { pivotX: e.clientX, pivotY: e.clientY, lastRad: null };
          return;
        }
        const useLeftPan = e.shiftKey || spacePressedRef.current || canvasPanArmed;
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
    [offset.x, offset.y, scale, canvasPanArmed]
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
   * split 布局切换 remount 时亦同；complete 检查见 syncPrimaryImageReadyFromDom。
   */

  const hasImage = Boolean(imageSrc && imageSrc.trim());
  const showPrimaryImageLoading = Boolean(
    open &&
      hasImage &&
      !centerSlot &&
      !primaryImageReady &&
      flatAnnotationColumnOutsidePanoStack
  );
  const handleImgLoadGeneral = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const im = e.currentTarget;
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      if (!nw || !nh) return;
      setPrimaryImageReady(true);
      handleImgLoad(e);
    },
    [handleImgLoad]
  );

  const handleImgErrorGeneral = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      try {
        if (import.meta.env.DEV) {
          const failedSrc = e.currentTarget.currentSrc || e.currentTarget.src;
          console.warn('[assetcutter] 大图预览主图加载失败', failedSrc.slice(0, 240));
        }
      } catch {
        /* ignore */
      }
      setPrimaryImageReady(true);
    },
    []
  );

  const flatImageVisibleClass = primaryImageReady
    ? 'opacity-100 transition-opacity duration-200 ease-out'
    : 'opacity-0 pointer-events-none';
  if (!open) return null;
  if (!hasImage && !centerSlot) {
    return (
      <PreviewShell
        open={open}
        onClose={onClose}
        focusKey={resetKey}
        zIndexClassName={shellZIndexClassName ?? 'z-[2000]'}
        backdropTintClassName={
          backdropImageSrc
            ? LIGHTBOX_BACKDROP_OVER_LIST_CLASS[lightboxBackdropId]
            : LIGHTBOX_BACKDROP_CLASS[lightboxBackdropId]
        }
        backdropImageSrc={backdropImageSrc}
        shellRightGutter={shellRightGutter}
      >
        <PreviewImageLoadingState placeholderSrc={placeholderImageSrc} label="预览加载中…" />
        {children}
      </PreviewShell>
    );
  }

  const useSplitLayout = splitLayoutActive;

  const useFrameLock = Boolean(!centerSlot && innerLayoutStableKey && lockedDominant);
  const shellStyle: React.CSSProperties = {
    left: useSplitLayout ? '50%' : `calc((100% - ${contentRightInset}) / 2)`,
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: 'center center',
  };
  const panoFlatStackStyle: React.CSSProperties = {
    left: useSplitLayout ? '50%' : `calc((100% - ${contentRightInset}) / 2)`,
    top: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 6,
  };
  const lockedImgStyle: React.CSSProperties | undefined = useFrameLock && lockedDominant
    ? lockedDominant.axis === 'width'
      ? { width: `${lockedDominant.size}px`, height: 'auto', maxWidth: useSplitLayout ? '100%' : '92vw', maxHeight: '88vh' }
      : { height: `${lockedDominant.size}px`, width: 'auto', maxWidth: useSplitLayout ? '100%' : '92vw', maxHeight: '88vh' }
    : undefined;

  const innerRotateStyle: React.CSSProperties = {
    ...(Math.abs(flatRotationDeg) > 1e-6 ? { transform: `rotate(${flatRotationDeg}deg)` } : {}),
    transformOrigin: rotOriginLocal ? `${rotOriginLocal.x}px ${rotOriginLocal.y}px` : '50% 50%',
  };

  const showModeCycleHint = Boolean(!centerSlot && (enablePanoramaMode || hasModel3DMode || hasHeightfieldMode));
  const bootRank = WORKFLOW_LIGHTBOX_BOOT_RANK[bootPhase];
  const showToolbarExtended = bootRank >= WORKFLOW_LIGHTBOX_BOOT_RANK.t2;
  const showToolbarHeavyChrome = bootRank >= WORKFLOW_LIGHTBOX_BOOT_RANK.t3;
  const flatPrimaryImgRevealClass =
    panoAnnotationBridge || splitStretchEnabled ? '' : flatImageVisibleClass;

  const mainStageContent = (
    <>
        {showPrimaryImageLoading ? (
          <PreviewImageLoadingState placeholderSrc={placeholderImageSrc} />
        ) : null}
        {!centerSlot &&
        enablePanoramaMode &&
        previewLayout === 'pano' &&
        LazyImageEquirectViewer &&
        !panoAnnotationBridge ? (
          <div
            className="absolute inset-0 z-[5] min-h-[200px]"
            onWheel={(e) => e.stopPropagation()}
          >
            <PreviewViewerErrorBoundary mode="image.equirect" label="全景">
              <Suspense fallback={<PreviewViewerFallback label="全景模块加载中…" />}>
                <LazyImageEquirectViewer
                  imageSrc={imageSrc!}
                  className="h-full w-full rounded-none border-0"
                  panoPreserveViewKey={innerLayoutStableKey?.trim() || undefined}
                />
              </Suspense>
            </PreviewViewerErrorBoundary>
          </div>
        ) : null}
        {panoAnnotationBridge ? (
          <div
            className="absolute inset-0 z-[5] min-h-[200px]"
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0">
              <PanoEquirectLazyView
                ref={assignPanoViewerRef}
                imageSrc={imageSrc!}
                className="h-full w-full rounded-none border-0"
                panoPreserveViewKey={innerLayoutStableKey?.trim() || undefined}
              />
              <div ref={panoOverlayHostRef} className="pointer-events-none absolute inset-0 z-[10] min-h-0">
                <div className="relative h-full min-h-0 w-full">
                  <img
                    key={imageSrc}
                    src={imageSrc!}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute left-0 top-0 opacity-0"
                    style={{ width: 1, height: 1 }}
                    onContextMenu={(e) => e.preventDefault()}
                    onLoad={handleImgLoadGeneral}
                    onError={handleImgErrorGeneral}
                    ref={imgRef}
                  />
                  {flatImageOverlay && !uiHidden ? (
                    // eslint-disable-next-line react-hooks/refs -- 将 ref 对象传入子 render 回调；不在此读取 .current
                    flatImageOverlay({
                      imgRef,
                      panoOverlayContainerRef: panoOverlayHostRef,
                      panoProjectionRef: panoViewerRef,
                      panoViewerBindEpoch: panoViewerBindEpoch,
                      previewLayout,
                    })
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!centerSlot && hasModel3DMode && previewLayout === 'model3d' ? (
          <div ref={webglPreviewHostRef} className="absolute inset-0 z-[5] min-h-0" onWheel={(e) => e.stopPropagation()}>
            <PreviewViewerErrorBoundary mode="image.model3d" label="3D">
              <Suspense fallback={<PreviewViewerFallback label="3D 模块加载中…" />}>
                <LazyImageModel3DViewer
                  imageSrc={imageSrc!}
                  modelSrc={previewModelSrc ?? undefined}
                  modelFileName={modelFileName}
                  model3dDisplayMode={model3dDisplayMode}
                  className="h-full w-full min-h-0"
                />
              </Suspense>
            </PreviewViewerErrorBoundary>
          </div>
        ) : null}

        {!centerSlot && hasHeightfieldMode && previewLayout === 'heightfield' ? (
          <div ref={webglPreviewHostRef} className="absolute inset-0 z-[5] min-h-0" onWheel={(e) => e.stopPropagation()}>
            <PreviewViewerErrorBoundary mode="image.heightfield" label="高度 3D">
              <Suspense fallback={<PreviewViewerFallback label="高度 3D 模块加载中…" />}>
                <LazyImageHeightfieldViewer
                  imageSrc={imageSrc!}
                  className="h-full w-full min-h-0"
                  toolbarPortalEl={!uiHidden ? heightfieldToolbarHostEl : null}
                />
              </Suspense>
            </PreviewViewerErrorBoundary>
          </div>
        ) : null}

        {centerSlot ? (
          contentRightInset !== '0px' || contentLeftInset !== '0px' ? (
            <div
              className="absolute top-1/2 z-[4] box-border flex min-w-0 items-stretch justify-center px-4"
              style={{
                left:
                  contentLeftInset !== '0px'
                    ? `calc(max(1rem, env(safe-area-inset-left, 0px)) + ${contentLeftInset} + 0.75rem)`
                    : 'max(1rem, env(safe-area-inset-left, 0px))',
                right:
                  useSplitLayout
                    ? 'max(1rem, env(safe-area-inset-right, 0px))'
                    : contentRightInset !== '0px'
                      ? `calc(1rem + ${contentRightInset} + 0.75rem)`
                      : 'max(1rem, env(safe-area-inset-right, 0px))',
                transform: 'translateY(-50%)',
              }}
            >
              {centerSlot}
            </div>
          ) : (
            <div
              className="absolute top-1/2 z-[4] box-border flex w-[min(80rem,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] items-center justify-center px-4"
              style={{
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              {centerSlot}
            </div>
          )
        ) : null}

        {flatAnnotationColumnOutsidePanoStack ? (
          <div
            className={`absolute top-1/2 ${panoAnnotationBridge ? 'flex items-center justify-center pointer-events-none' : useFrameLock ? 'flex items-center justify-center' : ''}`}
            style={panoAnnotationBridge ? panoFlatStackStyle : shellStyle}
          >
            <div
              ref={innerWrapRef}
              className={`relative inline-block max-w-full max-h-full ${panoAnnotationBridge ? 'pointer-events-none rounded-xl ring-1 ring-white/[0.12]' : ''}`}
              style={panoAnnotationBridge ? undefined : innerRotateStyle}
            >
              <img
                key={imageSrc}
                src={imageSrc!}
                className={
                  useFrameLock
                    ? `block max-h-full max-w-full object-contain rounded-xl select-none ${flatPrimaryImgRevealClass} ${
                        panoAnnotationBridge
                          ? 'pointer-events-none cursor-default opacity-0'
                          : splitStretchEnabled
                            ? 'pointer-events-none opacity-0'
                            : suppressFlatImageInteraction
                              ? 'pointer-events-none'
                              : canvasPanArmed
                                ? 'cursor-grab active:cursor-grabbing'
                                : 'cursor-zoom-in'
                      }`
                    : `block max-h-[88vh] ${useSplitLayout ? 'max-w-full' : 'max-w-[92vw]'} object-contain rounded-xl select-none ${flatPrimaryImgRevealClass} ${
                        panoAnnotationBridge
                          ? 'pointer-events-none cursor-default opacity-0'
                          : splitStretchEnabled
                            ? 'pointer-events-none opacity-0'
                            : suppressFlatImageInteraction
                              ? 'pointer-events-none'
                              : canvasPanArmed
                                ? 'cursor-grab active:cursor-grabbing'
                                : 'cursor-zoom-in'
                      }`
                }
                style={lockedImgStyle}
                alt=""
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onLoad={handleImgLoadGeneral}
                onError={handleImgErrorGeneral}
                onDoubleClick={
                  panoAnnotationBridge || suppressFlatImageInteraction
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setScale(1);
                        setOffset({ x: 0, y: 0 });
                        setFlatRotationDeg(0);
                        setRotOriginLocal(null);
                        dragRef.current = null;
                        panRef.current = null;
                        zoomPivotRef.current = null;
                        zoomLastScaleRef.current = 1;
                        rotateDragRef.current = null;
                      }
                }
                ref={imgRef}
                onMouseDown={
                  panoAnnotationBridge || suppressFlatImageInteraction || splitStretchEnabled
                    ? undefined
                    : handleImgMouseDown
                }
              />
              {splitStretchUiOk && splitStretchEnabled && !uiHidden ? (
                <ImagePreviewSplitStretchOverlay
                  imgRef={imgRef}
                  active
                  resetKey={`${resetKey}\u001f${imageSrc ?? ''}`}
                  exportStateRef={splitStretchExportRef}
                />
              ) : null}
              {flatImageOverlay && !uiHidden ? (
                // eslint-disable-next-line react-hooks/refs -- 将 ref 对象传入子 render 回调；不在此读取 .current
                flatImageOverlay({
                  imgRef,
                  panoOverlayContainerRef: undefined,
                  panoProjectionRef: undefined,
                  panoViewerBindEpoch: undefined,
                  previewLayout,
                })
              ) : null}
            </div>
          </div>
        ) : null}

        {!uiHidden ? (
        <div className="absolute top-4 left-4 z-10 max-w-[min(300px,calc(100vw-6rem))] pointer-events-none text-left text-[8px] leading-relaxed text-gray-500/70 space-y-1">
          {enablePanoramaMode && previewLayout === 'pano' ? (
            <>
              {showModeCycleHint ? <div>Q：循环切换显示模式（平面 / 全景 / 高度 3D / 3D 模型，仅显示已启用的项）</div> : null}
              <div>拖拽：旋转视角（360° 全景）</div>
              <div>双击 WebGL 画面：复原默认朝向与视野（局部重绘前可先对齐视角）</div>
              <div>滚轮：调整视野宽窄</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              {flatImageOverlay ? (
                <div>
                  标注 / 裁切 / 局部重绘：笔迹与框随全景视角贴球面；矩形裁切为当前视口所见区域。工具为「关闭」时手势仍作用在全景上
                </div>
              ) : null}
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : hasHeightfieldMode && previewLayout === 'heightfield' ? (
            <>
              {showModeCycleHint ? (
                <div>Q：循环切换显示模式（平面 / 全景 / 高度 3D / 3D 模型，仅显示已启用的项）</div>
              ) : null}
              <div>拖拽：旋转视角（按图片灰度抬升表面）</div>
              <div>滚轮：缩放视角距离</div>
              <div>表面：灰 MatCap（ZBrush 式 sculpt 明暗，无原图着色）</div>
              <div>右侧详情上方（工作流）或顶栏旁：性能↔画质、置换强度、卷成圆柱、「导出模型」选格式下载（含 FBX）</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : hasModel3DMode && previewLayout === 'model3d' ? (
            <>
              {showModeCycleHint ? <div>Q：循环切换显示模式（平面 / 全景 / 高度 3D / 3D 模型，仅显示已启用的项）</div> : null}
              <div>拖拽：旋转模型</div>
              <div>滚轮：缩放距离</div>
              <div>切回「平面」后可滚轮切图 / 缩放平移</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : centerSlot ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>Shift+滚轮：上一资产 / 下一资产</div>
              <div>Tab：隐藏/显示界面</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
            </>
          ) : typeof onWheelInnerNavigate === 'function' ? (
            <>
              <div>滚轮：本卡片多版本时切换显示</div>
              <div>Shift+滚轮：上一资产 / 下一资产</div>
              {showModeCycleHint ? <div>Q：循环切换显示模式（平面 / 全景 / 高度 3D / 3D 模型，仅显示已启用的项）</div> : null}
              <div>W：移动画布模式（开时左键拖移；再按 W 关闭）</div>
              <div>按住空格：临时移动画布（左键拖移）</div>
              <div>Z / X：放大 / 缩小</div>
              <div>R 按住并拖拽：绕按下点旋转；同时 Shift：每档 10°</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
              <div>双击：复原缩放、位置与旋转</div>
              <div>左键：缩放拖移</div>
              <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
              <div className="text-gray-500 pt-0.5 border-t border-white/10">
                当前缩放 {Math.round(scale * 100)}%
                {Math.abs(flatRotationDeg) > 0.05 ? ` · 旋转 ${Math.round(flatRotationDeg)}°` : ''}
                {canvasPanArmed ? ' · 移动画布' : ''}
              </div>
              {splitStretchUiOk && splitStretchEnabled ? (
                <div className="text-amber-200/90 pt-0.5 border-t border-white/10">
                  线分割：拖蓝色条调整上下占比；琥珀虚线为垂直中线参考。写入工作流请点标注条「写回」确认；「下载 PNG」仅导出本地文件。
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div>滚轮：上一张 / 下一张</div>
              {showModeCycleHint ? <div>Q：循环切换显示模式（平面 / 全景 / 高度 3D / 3D 模型，仅显示已启用的项）</div> : null}
              <div>W：移动画布模式（开时左键拖移；再按 W 关闭）</div>
              <div>按住空格：临时移动画布（左键拖移）</div>
              <div>Z / X：放大 / 缩小</div>
              <div>R 按住并拖拽：绕按下点旋转；同时 Shift：每档 10°</div>
              <div>Tab：隐藏/显示界面（仅看图片）</div>
              <div>1～4：切换预览背景（毛玻璃 / 黑 / 50%灰 / 白）</div>
              <div>Esc：关闭预览</div>
              <div>双击：复原缩放、位置与旋转</div>
              <div>左键：缩放拖移</div>
              <div>空格+左键 / Shift+左键 / 右键：平移画布</div>
              <div className="text-gray-500 pt-0.5 border-t border-white/10">
                当前缩放 {Math.round(scale * 100)}%
                {Math.abs(flatRotationDeg) > 0.05 ? ` · 旋转 ${Math.round(flatRotationDeg)}°` : ''}
                {canvasPanArmed ? ' · 移动画布' : ''}
              </div>
              {splitStretchUiOk && splitStretchEnabled ? (
                <div className="text-amber-200/90 pt-0.5 border-t border-white/10">
                  线分割：拖蓝色条调整上下占比；琥珀虚线为垂直中线参考。写入工作流请点标注条「写回」确认；「下载 PNG」仅导出本地文件。
                </div>
              ) : null}
            </>
          )}
        </div>
        ) : null}

        {!uiHidden ? (
        <div
          className="absolute right-4 z-10 flex max-w-[calc(100vw-2rem)] flex-row flex-wrap items-start justify-end gap-2"
          style={{ top: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
        >
          {showToolbarHeavyChrome && heightfieldLayoutActive && !heightfieldToolbarHostRef ? (
            <div
              ref={heightfieldToolbarSlotRef}
              className={`${WORKFLOW_IMAGE_PREVIEW_RAIL} max-w-[min(78vw,38rem)] min-w-0 shrink`}
              role="region"
              aria-label="高度 3D 控件"
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          <div
            className={`${WORKFLOW_IMAGE_PREVIEW_RAIL} shrink-0`}
            onClick={(e) => e.stopPropagation()}
            role="toolbar"
            aria-label="预览工具"
          >
            {showToolbarExtended && topRightExtra ? (
              <>
                <div className="inline-flex items-center gap-1">{topRightExtra}</div>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
              </>
            ) : null}
            {showToolbarExtended && modeSwitchRail ? (
              <>
                {modeSwitchRail}
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
              </>
            ) : null}
            {showToolbarExtended ? (
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
                triggerAriaLabel="切换画板颜色"
                triggerClassName={IMAGE_LIGHTBOX_TOOL_ICON_BTN_IDLE}
                renderTrigger={() => <Contrast {...PV_MODE_IC} aria-hidden />}
                portalZIndex={{ backdrop: 2700, list: 2701 }}
              />
            ) : null}
            {showToolbarExtended && !canvasAdjustControl && (splitStretchUiOk || resizeWriteBackUiOk) ? (
              <>
                <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
                {splitResizeToolbarInner}
              </>
            ) : null}
            {showToolbarExtended ? (
              <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />
            ) : null}
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

        {!uiHidden && resizeWriteBackUiOk && resizeWriteBackPopOpen && imageResizeWriteBack ? (
          <ImagePreviewWorkflowResizePopover
            open
            onClose={() => setResizeWriteBackPopOpen(false)}
            flatActive={previewLayout === 'flat'}
            imgRef={imgRef}
            splitExportRef={splitStretchExportRef}
            onCommit={imageResizeWriteBack.onCommit}
          />
        ) : null}
        {!uiHidden &&
        splitStretchUiOk &&
        splitStretchWriteBackPopOpen &&
        imageResizeWriteBack &&
        splitStretchEnabled ? (
          <ImagePreviewSplitStretchWriteBackPopover
            open
            onClose={() => setSplitStretchWriteBackPopOpen(false)}
            flatActive={previewLayout === 'flat'}
            imgRef={imgRef}
            splitExportRef={splitStretchExportRef}
            onCommit={async (payload) => {
              await Promise.resolve(imageResizeWriteBack.onCommit(payload));
              setSplitStretchWriteBackPopOpen(false);
              setSplitStretchEnabled(false);
            }}
          />
        ) : null}
    </>
  );

  return (
    <PreviewShell
      open={open}
      onClose={onClose}
      focusKey={resetKey}
      zIndexClassName={shellZIndexClassName ?? 'z-[2000]'}
      backdropTintClassName={
        backdropImageSrc
          ? LIGHTBOX_BACKDROP_OVER_LIST_CLASS[lightboxBackdropId]
          : LIGHTBOX_BACKDROP_CLASS[lightboxBackdropId]
      }
      backdropImageSrc={backdropImageSrc}
      shellRightGutter={shellRightGutter}
    >
      {useSplitLayout ? (
        <div className="flex h-full w-full min-h-0">
          <div
            className="relative min-h-0 min-w-0 flex-1 h-full overflow-hidden"
            data-lightbox-main-stage
          >
            {mainStageContent}
          </div>
          <div
            className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
            style={{ width: contentRightInset }}
            data-lightbox-right-rail
          >
            {!uiHidden ? rightRail : null}
          </div>
        </div>
      ) : (
        mainStageContent
      )}
    </PreviewShell>
  );
}
