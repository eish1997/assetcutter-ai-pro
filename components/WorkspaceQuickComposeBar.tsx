import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon } from 'lucide-react';
import { SUPPORTED_IMAGE_SIZES } from '../types';
import { useEffectiveImageGearRows } from '../hooks/useEffectiveImageGearRows';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
} from '../services/workflowDragPipeline';
import { WORKFLOW_QUICK_COMPOSE_BAR_SHELL } from './workflow/workflowSectionUiConstants';

export type WorkspaceQuickComposeGenSettings = {
  gearId: string;
  onGearId: (v: string) => void;
  aspectRatio: string;
  onAspectRatio: (v: string) => void;
  imageSize: string;
  onImageSize: (v: string) => void;
  count: number;
  onCount: (v: number) => void;
};

/** 从功能区/能力列拖入文本框的预设：展示为卡片，入队时与输入文案合并为提示词 */
export type WorkspaceQuickComposePromptCard = {
  key: string;
  presetId: string;
  label: string;
  instruction: string;
};

export type WorkspaceQuickComposeComposeMode = 'text' | 'image' | '3d';

export type WorkspaceQuickComposeBarProps = {
  visible: boolean;
  /**
   * `floating`：可拖动，默认贴底居中附近。
   * `lightbox`：大图预览内固定贴底水平居中，禁用拖动 / 加图 / 拖入，附图由外层提交逻辑注入。
   */
  placement?: 'floating' | 'lightbox';
  /** 非空时覆盖根据模式推导的输入框 placeholder */
  placeholderOverride?: string;
  /** 无拖入预设卡片时生效；有卡片时提交以卡片能力为准 */
  composeMode: WorkspaceQuickComposeComposeMode;
  onComposeModeChange: (m: WorkspaceQuickComposeComposeMode) => void;
  /** 已拖入能力预设卡片（输入框预设优先） */
  inputPresetsActive: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  attachedImages: string[];
  /** 由当前快捷能力对应生图模型的参考图上限推导 */
  maxAttachedImages: number;
  onAddImage: (dataUrl: string) => void;
  onRemoveImageAt: (index: number) => void;
  onClearAttachments: () => void;
  onSubmit: () => void;
  genSettings: WorkspaceQuickComposeGenSettings;
  /** 展示档位 / 比例 / 输出尺寸（生图引擎） */
  showGenImageSettings: boolean;
  /** 展示生成数量 1～4 */
  allowBatchCount: boolean;
  /** 拖入「文本框」区域时：切换快捷能力并追加预设提示词卡片（功能区/能力列 MIME） */
  onComposeInputCapabilityDrop?: (presetId: string) => void;
  /** 拖入工作区资产（大纲/画布 `DT_AC_WORKFLOW_EXPORT` + 与能力区一致的拖拽 state） */
  onComposeInputWorkflowDrop?: (e: React.DragEvent) => void;
  promptCards: WorkspaceQuickComposePromptCard[];
  onRemovePromptCard: (key: string) => void;
};

/** 参考常见生图产品：主比例一行 */
const QC_ASPECT_PRIMARY = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;

const VIEW_MARGIN = 8;

/** 将 fixed 定位的 left/top 限制在当前视口内（随窗口缩放更新） */
function clampBarToViewport(
  pos: { left: number; top: number },
  barEl: HTMLElement | null,
  vw: number,
  vh: number
): { left: number; top: number } {
  let w: number;
  let h: number;
  if (barEl) {
    const r = barEl.getBoundingClientRect();
    w = r.width;
    h = r.height;
  } else {
    w = Math.min(704, Math.max(280, vw - 24));
    h = 64;
  }
  const maxLeft = Math.max(VIEW_MARGIN, vw - w - VIEW_MARGIN);
  const maxTop = Math.max(VIEW_MARGIN, vh - h - VIEW_MARGIN);
  return {
    left: Math.max(VIEW_MARGIN, Math.min(maxLeft, pos.left)),
    top: Math.max(VIEW_MARGIN, Math.min(maxTop, pos.top)),
  };
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/**
 * 工作区底部居中：与预览工具栏同系实色条快捷输入；支持多图、生成参数摘要条与弹出设置。
 */
export default function WorkspaceQuickComposeBar({
  visible,
  placement = 'floating',
  placeholderOverride,
  composeMode,
  onComposeModeChange,
  inputPresetsActive,
  draft,
  onDraftChange,
  attachedImages,
  maxAttachedImages,
  onAddImage,
  onRemoveImageAt,
  onClearAttachments,
  onSubmit,
  genSettings,
  showGenImageSettings,
  allowBatchCount,
  onComposeInputCapabilityDrop,
  onComposeInputWorkflowDrop,
  promptCards,
  onRemovePromptCard,
}: WorkspaceQuickComposeBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    /** 与触发药丸水平居中对齐：样式 left + translateX(-50%) */
    anchorX: number;
    top: number;
    transform: string;
  } | null>(null);

  const { rows: effectiveGearRows, coerceGearId } = useEffectiveImageGearRows();

  useLayoutEffect(() => {
    if (!showGenImageSettings) return;
    const next = coerceGearId(genSettings.gearId);
    if (next !== genSettings.gearId) genSettings.onGearId(next);
  }, [showGenImageSettings, effectiveGearRows, coerceGearId, genSettings]);

  const resetToDefaultPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(576, Math.max(320, vw - 24));
    const left = Math.max(VIEW_MARGIN, Math.floor((vw - width) / 2));
    const topDesired = vh - 92;
    const estH = 64;
    const top = Math.max(VIEW_MARGIN, Math.min(vh - estH - VIEW_MARGIN, topDesired));
    setPosition(clampBarToViewport({ left, top }, null, vw, vh));
  }, []);

  const canAddMore = attachedImages.length < maxAttachedImages;
  const isLightbox = placement === 'lightbox';

  const modeLockedByInputPresets = inputPresetsActive;
  const modeChipCls = (active: boolean) =>
    `shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
      modeLockedByInputPresets
        ? 'cursor-not-allowed opacity-40 ring-1 ring-white/[0.06] text-gray-500'
        : active
          ? 'bg-white text-[#0a0a0c] ring-1 ring-white'
          : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1]'
    }`;

  const dragHasCapabilityPreset = useCallback((e: React.DragEvent) => {
    try {
      const t = e.dataTransfer?.types;
      if (!t) return false;
      for (let i = 0; i < t.length; i++) {
        const x = t[i];
        if (x === DT_AC_CAPABILITY_FROM_EDITOR || x === DT_AC_CAPABILITY_ACTION) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const dragHasWorkflowExport = useCallback((e: React.DragEvent) => {
    try {
      const t = e.dataTransfer?.types;
      if (!t) return false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === DT_AC_WORKFLOW_EXPORT) return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }, []);

  const readDroppedCapabilityPresetId = useCallback((dt: DataTransfer | null): string => {
    if (!dt) return '';
    try {
      return (
        dt.getData(DT_AC_CAPABILITY_FROM_EDITOR) ||
        dt.getData(DT_AC_CAPABILITY_ACTION) ||
        dt.getData('text/plain') ||
        ''
      ).trim();
    } catch {
      return '';
    }
  }, []);

  const handleComposeInputDragOver = useCallback(
    (e: React.DragEvent) => {
      const allowCap = Boolean(onComposeInputCapabilityDrop) && dragHasCapabilityPreset(e);
      const allowWf = Boolean(onComposeInputWorkflowDrop) && dragHasWorkflowExport(e);
      if (!allowCap && !allowWf) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* ignore */
      }
    },
    [
      dragHasCapabilityPreset,
      dragHasWorkflowExport,
      onComposeInputCapabilityDrop,
      onComposeInputWorkflowDrop,
    ]
  );

  const handleComposeInputDrop = useCallback(
    (e: React.DragEvent) => {
      if (onComposeInputCapabilityDrop && dragHasCapabilityPreset(e)) {
        e.preventDefault();
        e.stopPropagation();
        const id = readDroppedCapabilityPresetId(e.dataTransfer);
        if (id) onComposeInputCapabilityDrop(id);
        return;
      }
      if (onComposeInputWorkflowDrop && dragHasWorkflowExport(e)) {
        e.preventDefault();
        e.stopPropagation();
        onComposeInputWorkflowDrop(e);
      }
    },
    [
      dragHasCapabilityPreset,
      dragHasWorkflowExport,
      onComposeInputCapabilityDrop,
      onComposeInputWorkflowDrop,
      readDroppedCapabilityPresetId,
    ]
  );

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      for (const f of list) {
        try {
          const url = await readImageFileAsDataUrl(f);
          if (url.startsWith('data:image/')) onAddImage(url);
        } catch {
          /* ignore */
        }
      }
      if (fileRef.current) fileRef.current.value = '';
    },
    [onAddImage]
  );

  const collectClipboardImageFiles = useCallback((dt: DataTransfer | null): File[] => {
    if (!dt) return [];
    const out: File[] = [];
    const seen = new Set<string>();
    const push = (f: File | null) => {
      if (!f || !f.type.startsWith('image/')) return;
      const k = `${f.name}:${f.size}:${f.lastModified}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(f);
    };
    try {
      if (dt.files?.length) {
        for (let i = 0; i < dt.files.length; i += 1) push(dt.files.item(i));
      }
    } catch {
      /* ignore */
    }
    try {
      const items = dt.items;
      if (items?.length) {
        for (let i = 0; i < items.length; i += 1) {
          const it = items[i];
          if (it?.kind !== 'file') continue;
          push(it.getAsFile());
        }
      }
    } catch {
      /* ignore */
    }
    return out;
  }, []);

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!canAddMore) return;
      const files = collectClipboardImageFiles(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      for (const f of files) {
        try {
          const url = await readImageFileAsDataUrl(f);
          if (url.startsWith('data:image/')) onAddImage(url);
        } catch {
          /* ignore */
        }
      }
    },
    [canAddMore, collectClipboardImageFiles, onAddImage]
  );

  useEffect(() => {
    if (!visible) {
      setSettingsOpen(false);
      return;
    }
    if (isLightbox) return;
    if (position) return;
    resetToDefaultPosition();
  }, [position, resetToDefaultPosition, visible, isLightbox]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const offset = dragOffsetRef.current;
      if (!offset) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rawLeft = e.clientX - offset.x;
      const rawTop = e.clientY - offset.y;
      setPosition(
        clampBarToViewport({ left: rawLeft, top: rawTop }, barRef.current, vw, vh)
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

  useLayoutEffect(() => {
    if (!settingsOpen || typeof window === 'undefined') return;
    const measure = () => {
      const tr = settingsTriggerRef.current;
      if (!tr) return;
      const rect = tr.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;

      const gap = 6;
      const measuredH = panelRef.current?.getBoundingClientRect().height ?? 0;
      // 首次挂载前 measuredH 为 0，用保守高度估占位，避免下一帧 rAF 因高度变化翻转上下侧导致跳闪
      const estH = Math.max(measuredH, 200);
      const roomBelow = window.innerHeight - rect.bottom - gap;
      const roomAbove = rect.top - gap;
      const preferBelow = roomBelow >= estH || roomBelow >= roomAbove;

      if (preferBelow) {
        setPanelPos({ anchorX, top: rect.bottom + gap, transform: 'translateX(-50%)' });
      } else {
        setPanelPos({ anchorX, top: rect.top - gap, transform: 'translateX(-50%) translateY(-100%)' });
      }
    };
    measure();
    const rafId = requestAnimationFrame(() => measure());
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
    };
  }, [settingsOpen, position]);

  /** 关闭时清空，避免下次打开用旧坐标先渲染一帧再纠正（观感像闪屏） */
  useEffect(() => {
    if (!settingsOpen) setPanelPos(null);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [settingsOpen]);

  const clampPositionToViewport = useCallback(() => {
    setPosition((prev) => {
      if (!prev) return prev;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return clampBarToViewport(prev, barRef.current, vw, vh);
    });
  }, []);

  useEffect(() => {
    if (!visible || isLightbox) return;
    const scheduleClamp = () => {
      requestAnimationFrame(() => clampPositionToViewport());
    };
    window.addEventListener('resize', scheduleClamp);
    const vv = typeof window !== 'undefined' && window.visualViewport;
    vv?.addEventListener('resize', scheduleClamp);
    vv?.addEventListener('scroll', scheduleClamp);
    return () => {
      window.removeEventListener('resize', scheduleClamp);
      vv?.removeEventListener('resize', scheduleClamp);
      vv?.removeEventListener('scroll', scheduleClamp);
    };
  }, [visible, isLightbox, clampPositionToViewport]);

  if (!visible) return null;

  const disabled = false;
  const trimmedOverride = placeholderOverride?.trim();
  const placeholder = trimmedOverride
    ? trimmedOverride
    : (() => {
        if (composeMode === '3d') {
          return maxAttachedImages > 1
            ? `生成 3D：请附图，可附最多 ${maxAttachedImages} 张参考图`
            : '生成 3D：请附图并可选填说明';
        }
        if (composeMode === 'text') {
          return '输入问题或指令（文模式不支持附图）';
        }
        return maxAttachedImages > 1
          ? `想创作什么？可附最多 ${maxAttachedImages} 张参考图`
          : '想创作什么？可输入文字或附图';
      })();

  const gearSummary =
    effectiveGearRows.find((g) => g.id === genSettings.gearId && !g.disabled)?.label ??
    effectiveGearRows.find((g) => !g.disabled)?.label ??
    '标准';
  const aspectSummary =
    genSettings.aspectRatio === 'adaptive' ? '自' : genSettings.aspectRatio || '自';
  const sizeSummary =
    genSettings.imageSize && SUPPORTED_IMAGE_SIZES.some((s) => s.value === genSettings.imageSize)
      ? genSettings.imageSize
      : '';
  const countSummary = allowBatchCount ? Math.min(4, Math.max(1, genSettings.count)) : 1;

  /** 第一行（比例）：自然宽度，与整表同宽后作为「最宽行」基准 */
  const chipCls = (on: boolean) =>
    `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-bold tabular-nums ring-1 transition-colors ${
      on ? 'bg-white/[0.16] text-white ring-white/[0.22]' : 'bg-white/[0.04] text-gray-400 ring-white/[0.07] hover:bg-white/[0.08]'
    }`;

  /** 其余行：与表同宽，芯片均分填满（左右对齐） */
  const chipClsStretch = (on: boolean) =>
    `flex min-h-[1.5rem] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-md px-1 py-0.5 text-[9px] font-bold tabular-nums ring-1 transition-colors ${
      on ? 'bg-white/[0.16] text-white ring-white/[0.22]' : 'bg-white/[0.04] text-gray-400 ring-white/[0.07] hover:bg-white/[0.08]'
    }`;

  const countChipClsStretch = (on: boolean) =>
    `flex min-h-[1.5rem] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-md px-1 py-0.5 text-[9px] font-black ring-1 transition-colors ${
      on ? 'bg-white text-[#0a0a0c] ring-white' : 'bg-white/[0.05] text-gray-300 ring-white/[0.07] hover:bg-white/[0.1]'
    }`;

  const settingsPanel =
    settingsOpen && panelPos && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div
              ref={panelRef}
              className="fixed z-[2601] inline-table max-w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(70vh,320px)] border-separate border-spacing-y-1 border-spacing-x-0 overflow-y-auto rounded-xl border border-white/10 bg-[#0f0f12] p-1.5 shadow-xl ring-1 ring-white/[0.05]"
              style={{
                left: panelPos.anchorX,
                top: panelPos.top,
                transform: panelPos.transform,
              }}
              role="dialog"
              aria-label="本次生成参数"
            >
              {showGenImageSettings ? (
                <>
                  <div className="table-row">
                    <div className="table-cell p-0 align-middle">
                      <div className="flex flex-nowrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => genSettings.onAspectRatio('adaptive')}
                          className={chipCls(genSettings.aspectRatio === 'adaptive')}
                        >
                          自
                        </button>
                        {QC_ASPECT_PRIMARY.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => genSettings.onAspectRatio(r)}
                            className={chipCls(genSettings.aspectRatio === r)}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="table-row">
                    <div className="table-cell w-full min-w-0 p-0 align-middle">
                      <div className="flex min-w-0 w-full flex-nowrap items-stretch gap-1">
                        <button
                          type="button"
                          onClick={() => genSettings.onImageSize('')}
                          className={chipClsStretch(!genSettings.imageSize)}
                          title="不指定输出尺寸"
                        >
                          —
                        </button>
                        {SUPPORTED_IMAGE_SIZES.map((s) => (
                          <button
                            key={s.value}
                            type="button"
                            onClick={() => genSettings.onImageSize(s.value)}
                            className={chipClsStretch(genSettings.imageSize === s.value)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="table-row">
                    <div className="table-cell w-full min-w-0 p-0 align-middle">
                      <div className="flex min-w-0 w-full flex-nowrap items-stretch gap-1">
                        {effectiveGearRows.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            disabled={g.disabled}
                            title={g.disabled ? g.disabledReason : undefined}
                            onClick={() => {
                              if (!g.disabled) genSettings.onGearId(g.id);
                            }}
                            className={chipClsStretch(genSettings.gearId === g.id && !g.disabled)}
                          >
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {allowBatchCount ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex min-w-0 w-full flex-nowrap items-stretch gap-1">
                      {([1, 2, 3, 4] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => genSettings.onCount(n)}
                          className={countChipClsStretch(genSettings.count === n)}
                        >
                          {n === 1 ? '1x' : `x${n}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {attachedImages.length > 0 ? (
                <div className="table-row">
                  <div className="table-cell p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        onClearAttachments();
                        setSettingsOpen(false);
                      }}
                      className="mt-0.5 w-full rounded-md py-1 text-[9px] font-semibold text-gray-500 ring-1 ring-white/[0.07] hover:bg-white/[0.05] hover:text-gray-300"
                    >
                      清图
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>,
          document.body
        )
      : null;

  const barPositionStyle: React.CSSProperties | undefined = isLightbox
    ? {
        left: '50%',
        bottom: '1.25rem',
        top: 'auto',
        transform: 'translateX(-50%)',
        userSelect: 'auto',
      }
    : position
      ? { left: `${position.left}px`, top: `${position.top}px`, userSelect: dragging ? 'none' : 'auto' }
      : undefined;

  return (
    <>
      <div
        ref={barRef}
        className={`pointer-events-auto fixed w-[min(44rem,calc(100vw-1.5rem))] max-w-[96vw] px-2 ${
          isLightbox ? 'z-[2500]' : 'z-[1600]'
        }`}
        style={barPositionStyle}
        onPaste={isLightbox ? undefined : onPaste}
        onClick={isLightbox ? (e) => e.stopPropagation() : undefined}
        onWheel={isLightbox ? (e) => e.stopPropagation() : undefined}
        {...(isLightbox ? ({ 'data-image-preview-no-wheel': '' } as const) : {})}
      >
        {/* 预设卡片绝对定位在药丸上方，不参与文档流，避免添加/移除卡片时输入条上下跳动 */}
        <div className="relative min-w-0 overflow-visible">
          {promptCards.length > 0 ? (
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-[1] mb-2 flex flex-wrap items-center gap-2 px-0.5"
              onDragOver={isLightbox ? undefined : handleComposeInputDragOver}
              onDrop={isLightbox ? undefined : handleComposeInputDrop}
            >
              {promptCards.map((c) => (
                <div
                  key={c.key}
                  className={`group inline-flex max-w-[min(18rem,calc(100vw-3rem))] min-w-0 shrink-0 items-center gap-1.5 px-2.5 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
                  title={c.instruction.trim() ? c.instruction : c.label}
                >
                  <span className="min-w-0 truncate text-[13px] text-gray-100">{c.label}</span>
                  <button
                    type="button"
                    onClick={() => onRemovePromptCard(c.key)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    aria-label={`移除 ${c.label}`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={`flex items-center gap-2 px-2 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
            role="search"
          >
            {!isLightbox ? (
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple={maxAttachedImages >= 2}
                className="hidden"
                onChange={(e) => void onPickFiles(e.target.files)}
              />
            ) : null}
            {isLightbox ? (
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-400"
                title="附图已固定为当前大图预览（含平面标注），提交时合成"
              >
                <ImageIcon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} aria-hidden />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onDoubleClick={() => {
                    dragOffsetRef.current = null;
                    setDragging(false);
                    resetToDefaultPosition();
                  }}
                  onPointerDown={(e) => {
                    const rect = barRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    setSettingsOpen(false);
                    setDragging(true);
                  }}
                  className="flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white active:cursor-grabbing disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  title="拖动输入框（双击回到默认位置）"
                  aria-label="拖动输入框"
                >
                  <span className="select-none text-xs leading-none">⋮⋮</span>
                </button>

                <button
                  type="button"
                  disabled={disabled || !canAddMore}
                  onClick={() => fileRef.current?.click()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-300 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  title={canAddMore ? '添加参考图' : `已达上限（${maxAttachedImages} 张）`}
                  aria-label="添加参考图"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[1.125rem] w-[1.125rem]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>

                {attachedImages.length > 0 ? (
                  <div className="flex max-w-[min(200px,28vw)] shrink-0 items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]">
                    {attachedImages.map((src, i) => (
                      <div
                        key={`${i}-${src.slice(0, 48)}`}
                        className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.12]"
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => onRemoveImageAt(i)}
                          className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white opacity-0 transition-opacity hover:opacity-100"
                          title="移除此图"
                          aria-label="移除此图"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            <div
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]"
              onDragOver={isLightbox ? undefined : handleComposeInputDragOver}
              onDrop={isLightbox ? undefined : handleComposeInputDrop}
              onPaste={isLightbox ? undefined : onPaste}
            >
              <input
                type="text"
                value={draft}
                disabled={disabled}
                onChange={(e) => onDraftChange(e.target.value)}
                onPaste={isLightbox ? undefined : onPaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!disabled) onSubmit();
                  }
                }}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-gray-100 placeholder:text-gray-500 outline-none disabled:opacity-45"
                aria-label={isLightbox ? '大图预览快捷生成描述' : '快捷生成描述'}
              />
            </div>

            <div
              className="flex shrink-0 items-center gap-0.5"
              title={
                modeLockedByInputPresets
                  ? '已拖入预设卡片，提交时以卡片能力为准（模式切换已锁定）'
                  : '快捷模式：文 · 图 · 3D（无拖入预设时使用）'
              }
            >
              {(['text', 'image', '3d'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={disabled || modeLockedByInputPresets}
                  onClick={() => {
                    if (modeLockedByInputPresets) return;
                    onComposeModeChange(m);
                  }}
                  className={modeChipCls(composeMode === m)}
                >
                  {m === 'text' ? '文' : m === 'image' ? '图' : '3D'}
                </button>
              ))}
            </div>

            <button
            ref={settingsTriggerRef}
            type="button"
            disabled={disabled}
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex max-w-[min(11rem,36%)] shrink-0 items-center gap-1 overflow-hidden rounded-md bg-white/[0.06] py-1 pl-2 pr-1.5 text-left ring-1 ring-white/[0.08] outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45"
            title="生成参数"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
          >
            <span className="truncate text-[9px] font-semibold text-gray-200">{gearSummary}</span>
            <span className="shrink-0 text-[9px] text-gray-600">·</span>
            <span className="shrink-0 text-[9px] text-gray-400">{aspectSummary}</span>
            {sizeSummary ? (
              <>
                <span className="shrink-0 text-[9px] text-gray-600">·</span>
                <span className="shrink-0 text-[9px] font-mono text-gray-400">{sizeSummary}</span>
              </>
            ) : null}
            {allowBatchCount ? (
              <>
                <span className="shrink-0 text-[9px] text-gray-600">·</span>
                <span className="shrink-0 text-[9px] font-bold tabular-nums text-gray-400">x{countSummary}</span>
              </>
            ) : null}
            <span className="ml-px shrink-0 text-[8px] text-gray-600">{settingsOpen ? '▲' : '▼'}</span>
            </button>

            <button
            type="button"
            disabled={disabled}
            onClick={onSubmit}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
            title="加入队列并执行"
            aria-label="加入队列并执行"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
            </button>
          </div>
        </div>
      </div>
      {settingsPanel}
    </>
  );
}
