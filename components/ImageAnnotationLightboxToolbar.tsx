import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ImageFlatAnnotationTool } from './ImageFlatAnnotationOverlay';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Crosshair,
  Grid3x3,
  Crop,
  GripHorizontal,
  ImagePlus,
  ImageMinus,
  Lasso,
  Minus,
  Eraser,
  MousePointer2,
  Move,
  Paintbrush,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scaling,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import {
  TITLE_ROW_STEPPER_SHELL,
  TITLE_ROW_STEPPER_BTN,
  TITLE_ROW_STEPPER_VALUE,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
  resolveLightboxToolbarCenterRightGutterPx,
} from './workflow/workflowSectionUiConstants';
import type { ImagePreviewLayoutMode } from './preview';
import {
  LOCAL_INPAINT_EXPAND_PRESETS,
  type LocalInpaintExpandMode,
} from '../services/lightboxLocalInpaintExpandPrefs';

type AnnotationToolbarMenuKey = 'annotate' | 'crop' | 'local' | 'sam' | 'removeBg';

const VIEW_MARGIN = 8;

const SAM_BACKEND_UNREADY_HINT =
  '未探测到本机分割引擎：请打开桌面伴侣 → 设置 →「分割引擎（SAM / SamLocal）」→ 一键安装高精度引擎，完成后回到网站重试。';

/** 主栏图标 */
const ic = { size: 17, strokeWidth: 1.75, className: 'shrink-0' as const };
/** 弹出层内更紧凑 */
const icSm = { size: 15, strokeWidth: 1.75, className: 'shrink-0' as const };

/** 与主栏同系：禁止浅玻璃/白底，避免与 WORKFLOW_IMAGE_PREVIEW_RAIL 割裂 */
const PANEL_SURFACE =
  'max-h-[min(220px,38vh)] w-max max-w-[min(280px,92vw)] overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12]/95 px-1 py-1 shadow-xl ring-1 ring-white/[0.05] backdrop-blur-[2px]';

const TOOL_BTN_BASE =
  'flex shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]';

const ANNOTATE_DRAW_TOOLS = new Set<ImageFlatAnnotationTool>(['select', 'annotate_rect', 'brush', 'text']);
const CROP_TOOLS = new Set<ImageFlatAnnotationTool>(['crop_rect', 'crop_lasso']);
const LOCAL_EDIT_TOOLS = new Set<ImageFlatAnnotationTool>([
  'local_edit_rect',
  'local_edit_ellipse',
  'local_edit_lasso',
]);

function clampBarToViewport(
  pos: { left: number; top: number },
  el: HTMLElement | null,
  vw: number,
  vh: number,
  rightGutterPx = 0
): { left: number; top: number } {
  const w = el?.offsetWidth ?? 320;
  const h = el?.offsetHeight ?? 48;
  const maxL = Math.max(VIEW_MARGIN, vw - rightGutterPx - w - VIEW_MARGIN);
  const maxT = Math.max(VIEW_MARGIN, vh - h - VIEW_MARGIN);
  return {
    left: Math.max(VIEW_MARGIN, Math.min(maxL, pos.left)),
    top: Math.max(VIEW_MARGIN, Math.min(maxT, pos.top)),
  };
}

/** 下方剩余空间不小于上方时向下展开，避免贴底时菜单挤出视口 */
function computeMenuPlacement(barEl: HTMLElement): 'below' | 'above' {
  const rect = barEl.getBoundingClientRect();
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  return spaceBelow >= spaceAbove ? 'below' : 'above';
}

function ToolShell({
  active,
  onClick,
  title,
  children,
  dense,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  dense?: boolean;
  disabled?: boolean;
}) {
  const sz = dense ? 'h-6 w-6' : 'h-7 w-7';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={[
        TOOL_BTN_BASE,
        sz,
        disabled
          ? 'cursor-not-allowed opacity-35 ring-1 ring-white/[0.06]'
          : active
            ? 'bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500'
            : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  onClick,
  title,
  children,
  variant = 'default',
  dense,
  disabled,
  ariaLabel,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'amber' | 'danger' | 'primary';
  dense?: boolean;
  disabled?: boolean;
  /** 读屏短名；缺省与 title 相同 */
  ariaLabel?: string;
}) {
  const sz = dense ? 'h-6 w-6' : 'h-7 w-7';
  const cls =
    variant === 'amber'
      ? 'text-amber-200/95 hover:bg-amber-500/12 active:bg-amber-500/18'
      : variant === 'danger'
        ? 'text-red-400 hover:bg-red-950/45 active:bg-red-950/55'
        : variant === 'primary'
          ? 'text-emerald-100 hover:bg-emerald-600/22 active:bg-emerald-600/30 ring-1 ring-emerald-400/30'
          : 'text-gray-300 hover:bg-white/[0.08] active:bg-white/[0.12] hover:text-white';
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={[
        `${TOOL_BTN_BASE} ${sz} ${cls}`,
        disabled ? 'cursor-not-allowed opacity-35 pointer-events-none' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function RailDivider() {
  return <div className={WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER} aria-hidden />;
}

export type ImageAnnotationLightboxToolbarProps = {
  tool: ImageFlatAnnotationTool;
  onToolChange: (t: ImageFlatAnnotationTool) => void;
  color: string;
  onColorChange: (c: string) => void;
  brushWidth: number;
  onBrushWidthChange: (n: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPersist: () => void;
  onClearAnnotations: () => void;
  onApplyCrops: () => void;
  onClearCrops: () => void;
  onClearLocalEdit: () => void;
  /** 局部重绘裁切送生图时的四边外扩像素（`auto` = 约 18%） */
  localInpaintExpandMode?: LocalInpaintExpandMode;
  onLocalInpaintExpandModeChange?: (mode: LocalInpaintExpandMode) => void;
  /** 清空标注、裁切、全景视口裁切、局部重绘与撤销栈，并写入当前显示版本 */
  onResetAll: () => void;
  /** 本机菜单是否展开（供 Esc：先关菜单再解除武装） */
  lightboxSamToolbarMenuOpenRef?: React.MutableRefObject<boolean>;
  /** 本机伴侣 SAM 分割（平面大图） */
  samSegment?: {
    busy: boolean;
    armed: boolean;
    disabled: boolean;
    disabledTitle?: string;
    /** 下拉打开/关闭或其它菜单切换时同步武装（打开本机菜单即进入点选） */
    onSamMenuOpenChange?: (open: boolean) => void;
    /** 经伴侣探测 SamLocal：stub 时仅为小圆，非抠物 */
    samBackendMode?: 'unknown' | 'stub' | 'sam';
    /** 伴侣已连但 SamLocal 健康未就绪（未装/未起/探测失败）— 按钮短提示 */
    samBackendUnready?: boolean;
    samPickSubmode?: 'point' | 'box';
    onSamPickSubmodeChange?: (m: 'point' | 'box') => void;
    canRunSam?: boolean;
    onRunSam?: () => void;
    /** 清空全部点与框 */
    canClearSamPrompts?: boolean;
    onSamClearPrompts?: () => void;
    /** 运行后有预览但未写入资产 */
    canSaveSam?: boolean;
    onSaveSam?: () => void;
    /** 点选 / 自动选区 */
    samUxMode?: 'prompt' | 'auto';
    onAutoSegment?: () => void;
    canMergeAutoPick?: boolean;
    onMergeAutoPick?: () => void;
    onExitAuto?: () => void;
    canClearSamPreview?: boolean;
    onClearSamPreview?: () => void;
    multimask?: { total: number; index: number; onPrev: () => void; onNext: () => void };
  };
  /** rembg 去背景（平面大图 + 本机伴侣） */
  removeBg?: {
    busy: boolean;
    disabled: boolean;
    disabledTitle?: string;
    hasPreview: boolean;
    onRun: () => void;
    onApply: () => void;
    onDiscard: () => void;
  };
  /**
   * 由 `WorkflowSection` 注入：线分割变形 / 改尺寸写回（与 `ImagePreviewOverlay` 共用 state）；主栏为两颗独立图标按钮。
   */
  canvasAdjust?: {
    splitUiOk: boolean;
    resizeUiOk: boolean;
    previewLayout: ImagePreviewLayoutMode;
    splitStretchEnabled: boolean;
    setSplitStretchEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    splitStretchWriteBackPopOpen: boolean;
    setSplitStretchWriteBackPopOpen: React.Dispatch<React.SetStateAction<boolean>>;
    resizeWriteBackPopOpen: boolean;
    setResizeWriteBackPopOpen: React.Dispatch<React.SetStateAction<boolean>>;
    imageResizeWriteBackAvailable: boolean;
  } | null;
  /**
   * 预览区右侧占位：工具条默认居中于扣除 App 快捷侧栏或缩略图条后的区域。
   */
  composeDockExpanded?: boolean;
  lightboxChromeReady?: boolean;
};

/**
 * 大图标注条：可拖动；默认**顶部居中**；分类菜单按视口空间在栏**下方或上方**自适应展开（absolute），不改变主栏 fixed 位置；不因点空白/滚动自动收起。
 */
export function ImageAnnotationLightboxToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  brushWidth,
  onBrushWidthChange,
  onUndo,
  onRedo,
  onPersist,
  onClearAnnotations,
  onApplyCrops,
  onClearCrops,
  onClearLocalEdit,
  localInpaintExpandMode = 'auto',
  onLocalInpaintExpandModeChange,
  onResetAll,
  lightboxSamToolbarMenuOpenRef,
  samSegment,
  removeBg,
  canvasAdjust,
  composeDockExpanded = false,
  lightboxChromeReady = false,
}: ImageAnnotationLightboxToolbarProps) {
  const resolveRightGutterPx = useCallback(
    () =>
      resolveLightboxToolbarCenterRightGutterPx({
        composeDockExpanded,
        chromeReady: lightboxChromeReady,
      }),
    [composeDockExpanded, lightboxChromeReady]
  );

  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  /** 打开后不因点空白/滚动收起；再点同一分类或切换「标注/裁切/本机」时收起/切换 */
  const [openMenu, setOpenMenu] = useState<AnnotationToolbarMenuKey | null>(null);
  /** 菜单相对主栏：下方或上方（按视口剩余空间） */
  const [menuPlacement, setMenuPlacement] = useState<'below' | 'above'>('below');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const resetToDefaultPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gutter = resolveRightGutterPx();
    requestAnimationFrame(() => {
      const el = barRef.current;
      const w = el?.offsetWidth ?? 360;
      const h = el?.offsetHeight ?? 44;
      setPosition(
        clampBarToViewport(
          {
            left: Math.max(VIEW_MARGIN, (vw - gutter - w) / 2),
            top: VIEW_MARGIN,
          },
          el,
          vw,
          vh,
          gutter
        )
      );
    });
  }, [resolveRightGutterPx]);

  useLayoutEffect(() => {
    if (position !== null) return;
    resetToDefaultPosition();
  }, [position, resetToDefaultPosition]);

  useLayoutEffect(() => {
    resetToDefaultPosition();
  }, [composeDockExpanded, lightboxChromeReady, resetToDefaultPosition]);

  /** 菜单打开或主栏移动后：下方空间更大则向下展开，否则向上，减少贴顶/贴底时溢出 */
  useLayoutEffect(() => {
    if (!openMenu) return;
    const bar = barRef.current;
    if (!bar) return;
    setMenuPlacement(computeMenuPlacement(bar));
  }, [openMenu, position, dragging]);

  useEffect(() => {
    if (!openMenu) return;
    const onResize = () => {
      const bar = barRef.current;
      if (!bar) return;
      setMenuPlacement(computeMenuPlacement(bar));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [openMenu, position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const off = dragOffsetRef.current;
      if (!off) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setPosition(
        clampBarToViewport(
          { left: e.clientX - off.x, top: e.clientY - off.y },
          barRef.current,
          vw,
          vh,
          resolveRightGutterPx()
        )
      );
    };
    const onUp = () => {
      dragOffsetRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, resolveRightGutterPx]);

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        return clampBarToViewport(
          prev,
          barRef.current,
          window.innerWidth,
          window.innerHeight,
          resolveLightboxToolbarCenterRightGutterPx({
            composeDockExpanded,
            chromeReady: lightboxChromeReady,
          })
        );
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [composeDockExpanded, lightboxChromeReady]);

  const toggleMenu = useCallback((key: AnnotationToolbarMenuKey) => {
    setOpenMenu((prev) => (prev === key ? null : key));
  }, []);

  useLayoutEffect(() => {
    if (lightboxSamToolbarMenuOpenRef) {
      lightboxSamToolbarMenuOpenRef.current = openMenu === 'sam';
    }
  }, [openMenu, lightboxSamToolbarMenuOpenRef]);

  /** 本机：仅在下拉打开/从本机切走时同步武装，避免与快捷键 S（不关菜单）打架 */
  const samMenuPrevRef = useRef<typeof openMenu>(null);
  useEffect(() => {
    const prev = samMenuPrevRef.current;
    samMenuPrevRef.current = openMenu;
    const sync = samSegment?.onSamMenuOpenChange;
    if (!sync) return;
    if (samSegment.disabled) {
      sync(false);
      return;
    }
    if (openMenu === 'sam') {
      sync(!samSegment.busy);
    } else if (prev === 'sam') {
      sync(false);
    }
  }, [openMenu, samSegment?.onSamMenuOpenChange, samSegment?.disabled, samSegment?.busy]);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openMenu]);

  const annotateActive = ANNOTATE_DRAW_TOOLS.has(tool);
  const cropActive = CROP_TOOLS.has(tool);
  const localActive = LOCAL_EDIT_TOOLS.has(tool);

  const categoryBtn = (which: 'annotate' | 'crop' | 'local', active: boolean) => {
    const open = openMenu === which;
    const chevronOpenClass = open && menuPlacement === 'above' ? 'rotate-180' : '';
    const categoryTitle =
      which === 'annotate'
        ? '标注（子工具见菜单；画笔快捷键 B）'
        : which === 'crop'
          ? '裁切（快捷键 C，沿用上次矩形或套索）'
          : '局部重绘（快捷键 A，沿用上次选区形状）';
    return (
      <button
        type="button"
        title={categoryTitle}
        aria-label={which === 'annotate' ? '标注' : which === 'crop' ? '裁切' : '局部重绘'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu(which);
        }}
        className={[
          'inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]',
          open || active
            ? 'bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500'
            : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100',
        ].join(' ')}
      >
        {which === 'annotate' ? <PenLine {...ic} /> : which === 'crop' ? <Crop {...ic} /> : <Sparkles {...ic} />}
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-85 transition-transform ${chevronOpenClass}`} strokeWidth={2} />
      </button>
    );
  };

  const samCategoryBtn = () => {
    if (!samSegment) return null;
    const open = openMenu === 'sam';
    const chevronOpenClass = open && menuPlacement === 'above' ? 'rotate-180' : '';
    const active = samSegment.armed || open;
    const defaultSamTitle =
      '分割（子工具见菜单；快捷键 S 切换点选；Esc 关闭菜单并退出点选）';
    const categoryTitle = samSegment.disabled
      ? samSegment.disabledTitle || '当前不可用'
      : samSegment.samBackendUnready
        ? `${defaultSamTitle} ${SAM_BACKEND_UNREADY_HINT}`
        : defaultSamTitle;
    return (
      <button
        type="button"
        title={categoryTitle}
        aria-label="分割"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={samSegment.disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (samSegment.disabled) return;
          toggleMenu('sam');
        }}
        className={[
          'inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]',
          samSegment.disabled
            ? 'cursor-not-allowed opacity-35 ring-1 ring-white/[0.08]'
            : open || active
              ? 'bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500'
              : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100',
        ].join(' ')}
      >
        <Crosshair {...ic} />
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-85 transition-transform ${chevronOpenClass}`} strokeWidth={2} />
      </button>
    );
  };

  const removeBgCategoryBtn = () => {
    if (!removeBg) return null;
    const open = openMenu === 'removeBg';
    const chevronOpenClass = open && menuPlacement === 'above' ? 'rotate-180' : '';
    const active = open || removeBg.hasPreview;
    const titleBase =
      removeBg.disabled
        ? removeBg.disabledTitle || '当前不可用'
        : removeBg.hasPreview
          ? '去背景预览中：可写入新版本或丢弃'
          : '去背景（本机 rembg）';
    return (
      <button
        type="button"
        title={titleBase}
        aria-label="去背景"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={removeBg.disabled && !removeBg.hasPreview}
        onClick={(e) => {
          e.stopPropagation();
          if (removeBg.disabled && !removeBg.hasPreview) return;
          toggleMenu('removeBg');
        }}
        className={[
          'inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]',
          removeBg.disabled && !removeBg.hasPreview
            ? 'cursor-not-allowed opacity-35 ring-1 ring-white/[0.08]'
            : open || active
              ? 'bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500'
              : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100',
        ].join(' ')}
      >
        <ImageMinus {...ic} aria-hidden />
        <ChevronDown className={`h-3 w-3 shrink-0 opacity-85 transition-transform ${chevronOpenClass}`} strokeWidth={2} />
      </button>
    );
  };

  const removeBgPanel = removeBg ? (
    <div className="flex flex-col gap-1" role="menu">
      <div className="flex flex-wrap gap-0.5">
        <ActionBtn
          title={
            removeBg.disabled
              ? removeBg.disabledTitle || '当前不可用'
              : removeBg.hasPreview
                ? '重新运行去背景（替换当前预览）'
                : '运行去背景（本机 rembg）'
          }
          disabled={removeBg.disabled || removeBg.busy}
          onClick={() => {
            if (removeBg.disabled || removeBg.busy) return;
            removeBg.onRun();
          }}
        >
          <ImageMinus {...ic} aria-hidden />
        </ActionBtn>
      </div>
      {removeBg.hasPreview ? (
        <div className="flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1">
          <ActionBtn
            dense
            title="将抠图预览写入为新版本"
            variant="primary"
            disabled={removeBg.busy || removeBg.disabled}
            onClick={() => removeBg.onApply()}
          >
            <Save {...icSm} />
          </ActionBtn>
          <ActionBtn
            dense
            title="丢弃抠图预览"
            variant="danger"
            disabled={removeBg.busy}
            onClick={() => removeBg.onDiscard()}
          >
            <Trash2 {...icSm} />
          </ActionBtn>
        </div>
      ) : null}
    </div>
  ) : null;

  const samPanel = samSegment ? (
    <div className="flex flex-col gap-1" role="menu">
      {samSegment.samUxMode === 'auto' ? (
        <div className="flex flex-wrap gap-0.5">
          <ActionBtn
            title="返回点/框提示分割"
            dense
            disabled={samSegment.disabled || samSegment.busy}
            onClick={() => samSegment.onExitAuto?.()}
          >
            <RotateCcw {...icSm} />
          </ActionBtn>
          <ActionBtn
            title="将勾选区域叠入预览（可多次运行叠加）"
            dense
            variant="amber"
            disabled={samSegment.disabled || samSegment.busy || !samSegment.canMergeAutoPick}
            onClick={() => samSegment.onMergeAutoPick?.()}
          >
            <ImagePlus {...icSm} />
          </ActionBtn>
        </div>
      ) : (
        <div className="flex flex-wrap gap-0.5">
          <ToolShell
            dense
            active={samSegment.samPickSubmode === 'point'}
            title="点提示：左键前景点、右键背景点"
            disabled={samSegment.disabled || samSegment.busy}
            onClick={() => samSegment.onSamPickSubmodeChange?.('point')}
          >
            <MousePointer2 {...icSm} />
          </ToolShell>
          <ToolShell
            dense
            active={samSegment.samPickSubmode === 'box'}
            title="框提示：拖拽矩形"
            disabled={samSegment.disabled || samSegment.busy}
            onClick={() => samSegment.onSamPickSubmodeChange?.('box')}
          >
            <Square {...icSm} />
          </ToolShell>
          <ActionBtn
            title={
              samSegment.samBackendUnready
                ? SAM_BACKEND_UNREADY_HINT
                : samSegment.samBackendMode === 'stub'
                  ? samSegment.canRunSam
                    ? '运行（stub 为小圆联调）'
                    : '请先添加点或框'
                  : samSegment.canRunSam
                    ? '运行提示分割'
                    : '请先添加点或框选区域'
            }
            disabled={samSegment.disabled || samSegment.busy || !samSegment.canRunSam}
            onClick={() => samSegment.onRunSam?.()}
          >
            <Sparkles {...ic} />
          </ActionBtn>
          <ActionBtn
            title="清空提示点与框"
            dense
            disabled={samSegment.disabled || samSegment.busy || !samSegment.canClearSamPrompts}
            onClick={() => samSegment.onSamClearPrompts?.()}
          >
            <Eraser {...icSm} />
          </ActionBtn>
          <ActionBtn
            title={
              samSegment.samBackendUnready
                ? SAM_BACKEND_UNREADY_HINT
                : '全图自动拆分（官方式多区域，悬停高亮、点击勾选）'
            }
            disabled={samSegment.disabled || samSegment.busy}
            onClick={() => samSegment.onAutoSegment?.()}
          >
            <Grid3x3 {...ic} />
          </ActionBtn>
        </div>
      )}
      {samSegment.multimask && samSegment.multimask.total > 1 ? (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-white/[0.06] pt-1">
          <span className="text-[9px] font-medium uppercase tracking-wide text-white/40">多候选</span>
          <span
            className="text-[10px] font-medium tabular-nums text-white/65"
            title="当前 mask 候选序号"
          >
            {samSegment.multimask.index + 1} / {samSegment.multimask.total}
          </span>
          <ActionBtn
            title="上一候选"
            dense
            disabled={samSegment.multimask.index <= 0}
            onClick={samSegment.multimask.onPrev}
          >
            <ChevronLeft {...icSm} />
          </ActionBtn>
          <ActionBtn
            title="下一候选"
            dense
            disabled={samSegment.multimask.index >= samSegment.multimask.total - 1}
            onClick={samSegment.multimask.onNext}
          >
            <ChevronRight {...icSm} />
          </ActionBtn>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1">
        {samSegment.canClearSamPreview ? (
          <ActionBtn
            dense
            title="清空分割预览叠层"
            variant="danger"
            disabled={samSegment.busy}
            onClick={() => samSegment.onClearSamPreview?.()}
          >
            <Trash2 {...icSm} />
          </ActionBtn>
        ) : null}
        {samSegment.canSaveSam ? (
          <ActionBtn
            dense
            title="将当前预览 mask 保存为新版本（PNG）"
            onClick={() => samSegment.onSaveSam?.()}
            variant="primary"
            disabled={samSegment.busy}
          >
            <Save {...icSm} />
          </ActionBtn>
        ) : null}
      </div>
    </div>
  ) : null;

  const annotatePanel = (
    <div className="flex flex-col gap-1" role="menu">
      <div className="flex flex-wrap gap-0.5">
        <ToolShell
          dense
          title="选择 / 拖动（Del 删除 · Esc 取消 · ⌘D 复制）"
          active={tool === 'select'}
          onClick={() => onToolChange('select')}
        >
          <MousePointer2 {...icSm} />
        </ToolShell>
        <ToolShell dense title="矩形标注" active={tool === 'annotate_rect'} onClick={() => onToolChange('annotate_rect')}>
          <Square {...icSm} />
        </ToolShell>
        <ToolShell
          dense
          title="画笔（快捷键 B）"
          active={tool === 'brush'}
          onClick={() => onToolChange('brush')}
        >
          <Paintbrush {...icSm} />
        </ToolShell>
        <ToolShell dense title="文字（在图上点击后直接输入）" active={tool === 'text'} onClick={() => onToolChange('text')}>
          <Type {...icSm} />
        </ToolShell>
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-t border-white/[0.06] pt-1">
        <button
          type="button"
          title="描边 / 文字颜色"
          aria-label="选择颜色"
          onClick={() => colorInputRef.current?.click()}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.08]"
        >
          <span
            className="h-3.5 w-3.5 rounded-full ring-1 ring-white/25 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{ backgroundColor: color }}
          />
          <input
            ref={colorInputRef}
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            tabIndex={-1}
          />
        </button>
        <div className={`${TITLE_ROW_STEPPER_SHELL} !h-6 scale-[0.92] origin-left`}>
          <button
            type="button"
            title="减小线宽"
            aria-label="减小线宽"
            className={`${TITLE_ROW_STEPPER_BTN} !h-6 inline-flex shrink-0 items-center justify-center p-0`}
            onClick={() => onBrushWidthChange(Math.max(1, brushWidth - 1))}
          >
            <Minus size={12} strokeWidth={2} className="text-gray-300" aria-hidden />
          </button>
          <span className={`${TITLE_ROW_STEPPER_VALUE} !h-6 !text-[8px]`} title="线宽（像素）">
            {brushWidth}
          </span>
          <button
            type="button"
            title="增大线宽"
            aria-label="增大线宽"
            className={`${TITLE_ROW_STEPPER_BTN} !h-6 inline-flex shrink-0 items-center justify-center p-0`}
            onClick={() => onBrushWidthChange(Math.min(80, brushWidth + 1))}
          >
            <Plus size={12} strokeWidth={2} className="text-gray-300" aria-hidden />
          </button>
        </div>
        <ActionBtn dense title="保存标注到当前版本" onClick={onPersist}>
          <Save {...icSm} />
        </ActionBtn>
        <ActionBtn dense title="清空全部标注层" onClick={onClearAnnotations} variant="danger">
          <Trash2 {...icSm} />
        </ActionBtn>
      </div>
    </div>
  );

  const cropPanel = (
    <div className="flex flex-col gap-1" role="menu">
      <div className="flex flex-wrap gap-0.5">
        <ToolShell
          dense
          title="矩形裁切区（快捷键 C 默认记忆上次裁切方式）"
          active={tool === 'crop_rect'}
          onClick={() => onToolChange('crop_rect')}
        >
          <Crop {...icSm} />
        </ToolShell>
        <ToolShell
          dense
          title="套索裁切（选用后按 C 可回到套索）"
          active={tool === 'crop_lasso'}
          onClick={() => onToolChange('crop_lasso')}
        >
          <Lasso {...icSm} />
        </ToolShell>
      </div>
      <div className="flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1">
        <ActionBtn dense title="生成裁切资产（透明 PNG，含标注合成）" onClick={onApplyCrops} variant="amber">
          <ImagePlus {...icSm} />
        </ActionBtn>
        <ActionBtn dense title="移除全部裁切区" onClick={onClearCrops} variant="danger">
          <Trash2 {...icSm} />
        </ActionBtn>
      </div>
    </div>
  );

  const localPanel = (
    <div className="flex flex-col gap-1" role="menu">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolShell
          dense
          title="矩形局部重绘（快捷键 A 默认记忆上次选区形状；提交时扩边裁切 → 生成 → 贴回）"
          active={tool === 'local_edit_rect'}
          onClick={() => onToolChange('local_edit_rect')}
        >
          <Square {...icSm} />
        </ToolShell>
        <ToolShell
          dense
          title="椭圆局部重绘（选用后按 A 可回到椭圆）"
          active={tool === 'local_edit_ellipse'}
          onClick={() => onToolChange('local_edit_ellipse')}
        >
          <Circle {...icSm} />
        </ToolShell>
        <ToolShell
          dense
          title="套索局部重绘（选用后按 A 可回到套索）"
          active={tool === 'local_edit_lasso'}
          onClick={() => onToolChange('local_edit_lasso')}
        >
          <Lasso {...icSm} />
        </ToolShell>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-white/10" aria-hidden />
        <div
          className={`${TITLE_ROW_STEPPER_SHELL} !h-6 scale-[0.92] origin-left`}
          title="裁切送生图时选区四边外扩像素（自动 ≈ 18%）"
        >
          <button
            type="button"
            title="减小扩边"
            aria-label="减小扩边像素"
            className={`${TITLE_ROW_STEPPER_BTN} !h-6 inline-flex shrink-0 items-center justify-center p-0`}
            onClick={() => {
              if (!onLocalInpaintExpandModeChange) return;
              const idx = LOCAL_INPAINT_EXPAND_PRESETS.findIndex((p) => p.mode === localInpaintExpandMode);
              const next =
                LOCAL_INPAINT_EXPAND_PRESETS[
                  (idx <= 0 ? LOCAL_INPAINT_EXPAND_PRESETS.length : idx) - 1
                ] ?? LOCAL_INPAINT_EXPAND_PRESETS[0];
              onLocalInpaintExpandModeChange(next.mode);
            }}
          >
            <Minus size={12} strokeWidth={2} className="text-gray-300" aria-hidden />
          </button>
          <span
            className={`${TITLE_ROW_STEPPER_VALUE} !h-6 !min-w-[2.25rem] !text-[8px]`}
            title="扩边像素（四边各外扩）"
          >
            {LOCAL_INPAINT_EXPAND_PRESETS.find((p) => p.mode === localInpaintExpandMode)?.label ?? '自动'}
          </span>
          <button
            type="button"
            title="增大扩边"
            aria-label="增大扩边像素"
            className={`${TITLE_ROW_STEPPER_BTN} !h-6 inline-flex shrink-0 items-center justify-center p-0`}
            onClick={() => {
              if (!onLocalInpaintExpandModeChange) return;
              const idx = LOCAL_INPAINT_EXPAND_PRESETS.findIndex((p) => p.mode === localInpaintExpandMode);
              const next =
                LOCAL_INPAINT_EXPAND_PRESETS[(idx + 1) % LOCAL_INPAINT_EXPAND_PRESETS.length] ??
                LOCAL_INPAINT_EXPAND_PRESETS[0];
              onLocalInpaintExpandModeChange(next.mode);
            }}
          >
            <Plus size={12} strokeWidth={2} className="text-gray-300" aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1">
        <ActionBtn dense title="清除局部重绘选区" onClick={onClearLocalEdit} variant="danger">
          <Trash2 {...icSm} />
        </ActionBtn>
      </div>
    </div>
  );

  return (
    <div
      ref={barRef}
      className="pointer-events-auto fixed z-[2400]"
      style={
        position
          ? { left: position.left, top: position.top, userSelect: dragging ? 'none' : 'auto', opacity: 1 }
          : { opacity: 0, pointerEvents: 'none' }
      }
      data-image-preview-no-wheel
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative inline-block">
        {openMenu ? (
          <div
            className={[
              'pointer-events-auto absolute left-1/2 z-10 -translate-x-1/2',
              menuPlacement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1',
              PANEL_SURFACE,
            ].join(' ')}
            role="presentation"
          >
            {openMenu === 'annotate'
              ? annotatePanel
              : openMenu === 'crop'
                ? cropPanel
                : openMenu === 'local'
                  ? localPanel
                  : openMenu === 'sam'
                    ? samPanel
                    : openMenu === 'removeBg'
                      ? removeBgPanel
                      : null}
          </div>
        ) : null}

        <div className={WORKFLOW_IMAGE_PREVIEW_RAIL} role="toolbar" aria-label="标注与裁切">
        <button
          type="button"
          onDoubleClick={() => {
            dragOffsetRef.current = null;
            setDragging(false);
            resetToDefaultPosition();
          }}
          onPointerDown={(e) => {
            const rect = barRef.current?.getBoundingClientRect();
            if (!rect) return;
            dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            setDragging(true);
          }}
          className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-gray-500 outline-none transition-colors hover:bg-white/[0.08] hover:text-gray-200 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-blue-500/50"
          title="拖动工具条（双击回到默认位置）"
          aria-label="拖动工具条"
        >
          <span className="select-none text-[10px] leading-none tracking-tighter">⋮⋮</span>
        </button>
        <ToolShell title="移动画布（缩放/平移，不画标注）" active={tool === 'off'} onClick={() => onToolChange('off')}>
          <Move {...ic} />
        </ToolShell>
        <RailDivider />
        <div className="flex flex-wrap items-center gap-1">
          {categoryBtn('annotate', annotateActive)}
          {categoryBtn('local', localActive)}
          {categoryBtn('crop', cropActive)}
          {samSegment ? samCategoryBtn() : null}
          {removeBg ? removeBgCategoryBtn() : null}
          {canvasAdjust && (canvasAdjust.splitUiOk || canvasAdjust.resizeUiOk) ? (
            <>
              {canvasAdjust.splitUiOk ? (
                <>
                  <ToolShell
                    title="线分割变形：拖蓝色条调整上下区域纵向比例；再次点击关闭"
                    active={canvasAdjust.splitStretchEnabled}
                    onClick={() => {
                      canvasAdjust.setResizeWriteBackPopOpen(false);
                      canvasAdjust.setSplitStretchEnabled((v) => !v);
                    }}
                  >
                    <GripHorizontal {...ic} aria-hidden />
                  </ToolShell>
                  {canvasAdjust.splitStretchEnabled && canvasAdjust.imageResizeWriteBackAvailable ? (
                    <ActionBtn
                      title="确认将线分割变形写回当前工作流版本"
                      variant="amber"
                      onClick={() => {
                        canvasAdjust.setResizeWriteBackPopOpen(false);
                        canvasAdjust.setSplitStretchWriteBackPopOpen(true);
                      }}
                    >
                      <Save {...ic} aria-hidden />
                    </ActionBtn>
                  ) : null}
                </>
              ) : null}
              {canvasAdjust.resizeUiOk ? (
                <ToolShell
                  title={
                    canvasAdjust.previewLayout !== 'flat'
                      ? '请切换到「平面」预览后再改尺寸写回'
                      : '改尺寸写回当前版本（等比缩放；写回后清除本版本标注）'
                  }
                  active={canvasAdjust.resizeWriteBackPopOpen}
                  disabled={canvasAdjust.previewLayout !== 'flat'}
                  onClick={() => {
                    if (canvasAdjust.previewLayout !== 'flat') return;
                    canvasAdjust.setSplitStretchWriteBackPopOpen(false);
                    canvasAdjust.setResizeWriteBackPopOpen((o) => !o);
                  }}
                >
                  <Scaling {...ic} aria-hidden />
                </ToolShell>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="mx-0.5 w-px shrink-0 self-stretch bg-white/12" aria-hidden />
        <div className="flex items-center gap-0.5">
          <ActionBtn title="撤回（Ctrl/⌘+Z）" ariaLabel="撤回" onClick={onUndo}>
            <Undo2 {...ic} />
          </ActionBtn>
          <ActionBtn title="重做（⇧Ctrl/⇧⌘+Z）" ariaLabel="重做" onClick={onRedo}>
            <Redo2 {...ic} />
          </ActionBtn>
        </div>
        <RailDivider />
        <ActionBtn
          title="一键清空：标注、裁切、局部重绘、全景裁切框（写入当前版本）"
          ariaLabel="一键清空"
          onClick={onResetAll}
          variant="danger"
        >
          <RotateCcw {...ic} />
        </ActionBtn>
        </div>
      </div>
    </div>
  );
}
