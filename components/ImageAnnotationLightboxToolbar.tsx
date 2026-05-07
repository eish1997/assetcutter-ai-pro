import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ImageFlatAnnotationTool } from './ImageFlatAnnotationOverlay';
import {
  ChevronDown,
  Crop,
  ImagePlus,
  Lasso,
  Minus,
  MousePointer2,
  Move,
  Paintbrush,
  PenLine,
  Plus,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import {
  TITLE_ROW_STEPPER_SHELL,
  TITLE_ROW_STEPPER_BTN,
  TITLE_ROW_STEPPER_VALUE,
  WORKFLOW_IMAGE_PREVIEW_RAIL,
  WORKFLOW_IMAGE_PREVIEW_RAIL_DIVIDER,
} from './workflow/workflowSectionUiConstants';

const VIEW_MARGIN = 8;

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

function clampBarToViewport(
  pos: { left: number; top: number },
  el: HTMLElement | null,
  vw: number,
  vh: number
): { left: number; top: number } {
  const w = el?.offsetWidth ?? 320;
  const h = el?.offsetHeight ?? 48;
  const maxL = Math.max(VIEW_MARGIN, vw - w - VIEW_MARGIN);
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
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  dense?: boolean;
}) {
  const sz = dense ? 'h-6 w-6' : 'h-7 w-7';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        TOOL_BTN_BASE,
        sz,
        active
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
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'amber' | 'danger';
  dense?: boolean;
}) {
  const sz = dense ? 'h-6 w-6' : 'h-7 w-7';
  const cls =
    variant === 'amber'
      ? 'text-amber-200/95 hover:bg-amber-500/12 active:bg-amber-500/18'
      : variant === 'danger'
        ? 'text-red-400 hover:bg-red-950/45 active:bg-red-950/55'
        : 'text-gray-300 hover:bg-white/[0.08] active:bg-white/[0.12] hover:text-white';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${TOOL_BTN_BASE} ${sz} ${cls}`}
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
}: ImageAnnotationLightboxToolbarProps) {
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  /** 打开后不因点空白/滚动收起；再点同一分类或切换「标注/裁切」时收起/切换 */
  const [openMenu, setOpenMenu] = useState<null | 'annotate' | 'crop'>(null);
  /** 菜单相对主栏：下方或上方（按视口剩余空间） */
  const [menuPlacement, setMenuPlacement] = useState<'below' | 'above'>('below');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const resetToDefaultPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    requestAnimationFrame(() => {
      const el = barRef.current;
      const w = el?.offsetWidth ?? 360;
      const h = el?.offsetHeight ?? 44;
      setPosition(
        clampBarToViewport(
          {
            left: Math.max(VIEW_MARGIN, (vw - w) / 2),
            top: VIEW_MARGIN,
          },
          el,
          vw,
          vh
        )
      );
    });
  }, []);

  useLayoutEffect(() => {
    if (position !== null) return;
    const el = barRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    if (r.width < 2) return;
    setPosition(
      clampBarToViewport(
        { left: (vw - r.width) / 2, top: VIEW_MARGIN },
        el,
        vw,
        vh
      )
    );
  }, [position]);

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
        clampBarToViewport({ left: e.clientX - off.x, top: e.clientY - off.y }, barRef.current, vw, vh)
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
  }, [dragging]);

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        return clampBarToViewport(prev, barRef.current, window.innerWidth, window.innerHeight);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleMenu = useCallback((key: 'annotate' | 'crop') => {
    setOpenMenu((prev) => (prev === key ? null : key));
  }, []);

  const annotateActive = ANNOTATE_DRAW_TOOLS.has(tool);
  const cropActive = CROP_TOOLS.has(tool);

  const categoryBtn = (which: 'annotate' | 'crop', active: boolean) => {
    const open = openMenu === which;
    const chevronOpenClass = open && menuPlacement === 'above' ? 'rotate-180' : '';
    return (
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu(which);
        }}
        className={[
          'inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]',
          open || active
            ? 'bg-blue-600 text-white ring-1 ring-blue-400/35 hover:bg-blue-500'
            : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.1] hover:bg-white/[0.11] hover:text-gray-100',
        ].join(' ')}
      >
        {which === 'annotate' ? <PenLine {...ic} /> : <Crop {...ic} />}
        <span className="text-[8px] font-black uppercase tracking-wide">{which === 'annotate' ? '标注' : '裁切'}</span>
        <ChevronDown className={`h-3 w-3 opacity-85 transition-transform ${chevronOpenClass}`} strokeWidth={2} />
      </button>
    );
  };

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
        <ToolShell dense title="画笔" active={tool === 'brush'} onClick={() => onToolChange('brush')}>
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
        <ToolShell dense title="矩形裁切区" active={tool === 'crop_rect'} onClick={() => onToolChange('crop_rect')}>
          <Crop {...icSm} />
        </ToolShell>
        <ToolShell dense title="套索裁切" active={tool === 'crop_lasso'} onClick={() => onToolChange('crop_lasso')}>
          <Lasso {...icSm} />
        </ToolShell>
      </div>
      <div className="flex flex-wrap gap-0.5 border-t border-white/[0.06] pt-1">
        <ActionBtn dense title="生成裁切资产（透明 PNG，含标注合成）" onClick={onApplyCrops} variant="amber">
          <ImagePlus {...icSm} />
        </ActionBtn>
        <ActionBtn dense title="移除全部裁切区" onClick={onClearCrops}>
          <X {...icSm} />
        </ActionBtn>
      </div>
    </div>
  );

  return (
    <div
      ref={barRef}
      className="pointer-events-auto fixed z-[2200]"
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
            {openMenu === 'annotate' ? annotatePanel : cropPanel}
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
        {categoryBtn('annotate', annotateActive)}
        {categoryBtn('crop', cropActive)}
        <RailDivider />
        <ActionBtn title="撤销 (Ctrl/⌘+Z)" onClick={onUndo}>
          <Undo2 {...ic} />
        </ActionBtn>
        <ActionBtn title="重做 (⇧Ctrl/⇧⌘+Z)" onClick={onRedo}>
          <Redo2 {...ic} />
        </ActionBtn>
        </div>
      </div>
    </div>
  );
}
