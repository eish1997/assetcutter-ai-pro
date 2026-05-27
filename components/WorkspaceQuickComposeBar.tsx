import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Maximize2, Minimize2 } from 'lucide-react';
import { SUPPORTED_IMAGE_SIZES } from '../types';
import { useEffectiveImageModelRows } from '../hooks/useEffectiveImageGearRows';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
} from '../services/workflowDragPipeline';
import { CustomDropdown } from './ui/CustomDropdown';
import {
  labelForImageModelRegistryId,
  shortLabelForImageModelRegistryId,
} from '../services/modelRegistry/imageModels';
import { WORKFLOW_QUICK_COMPOSE_BAR_SHELL } from './workflow/workflowSectionUiConstants';
import QuickComposeDropTray from './workflow/QuickComposeDropTray';
import QuickComposeMentionField, {
  type QuickComposeMentionFieldHandle,
} from './workflow/QuickComposeMentionField';
import type {
  QuickComposeDropSlot,
  QuickComposeMentionCandidate,
  QuickComposeSegment,
} from '../services/quickComposeMention';
import { mentionsFromSegments, newQuickComposeTextSegment } from '../services/quickComposeMention';

export type WorkspaceQuickComposeGenSettings = {
  imageModelRegistryId: string;
  onImageModelRegistryId: (v: string) => void;
  aspectRatio: string;
  onAspectRatio: (v: string) => void;
  imageSize: string;
  onImageSize: (v: string) => void;
  /** true = 先理解再生成；false = 直发提示词（与侧栏分组「解」一致） */
  understand: boolean;
  onUnderstand: (v: boolean) => void;
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
   * `lightbox`：大图预览内 portal；可拖动定位（与全局相同），禁用加图 / 拖入，附图由外层提交逻辑注入。
   */
  placement?: 'floating' | 'lightbox';
  /**
   * 仅 `lightbox`：选区底边中点（视口 CSS 像素）。非空时输入条移到该点下方；`null` 时恢复默认贴底居中。
   */
  lightboxAnchorClient?: { x: number; y: number } | null;
  /** 仅 `lightbox`：递增时强制将输入条复位到默认贴底（提交后即时归位） */
  lightboxLayoutResetNonce?: number;
  /** 非空时覆盖根据模式推导的输入框 placeholder */
  placeholderOverride?: string;
  /** 无拖入预设卡片时生效；有卡片时提交以卡片能力为准 */
  composeMode: WorkspaceQuickComposeComposeMode;
  onComposeModeChange: (m: WorkspaceQuickComposeComposeMode) => void;
  /** 已拖入能力预设卡片（输入框预设优先） */
  inputPresetsActive: boolean;
  segments: QuickComposeSegment[];
  onSegmentsChange: (next: QuickComposeSegment[]) => void;
  mentionCandidates: QuickComposeMentionCandidate[];
  /** 拖入输入区、待点击 @ 的缩略图 */
  dropSlots: QuickComposeDropSlot[];
  onRemoveDropSlot: (assetId: string) => void;
  /** 参考图（@ 引用）数量上限 */
  maxMentions: number;
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

/** 快捷条右侧控件统一高度（模式 / 模型 / 参数 pill） */
const QUICK_COMPOSE_CTRL_H = 'h-6';

/** 快捷条内 pill 按钮（模型 / 参数）统一高度与内边距 */
const QUICK_COMPOSE_PILL_TRIGGER =
  `inline-flex ${QUICK_COMPOSE_CTRL_H} min-h-6 max-h-6 shrink-0 items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 text-[9px] leading-none ring-1 ring-white/[0.08] outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-blue-500/45`;

/** 快捷条模式 chip（文 / 图 / 3D） */
const QUICK_COMPOSE_MODE_CHIP_BASE =
  `inline-flex ${QUICK_COMPOSE_CTRL_H} min-h-6 max-h-6 shrink-0 items-center justify-center rounded-md px-1.5 text-[9px] font-bold leading-none transition-colors box-border`;

const VIEW_MARGIN = 8;
/** 快捷条默认贴底：底边距视口底约 28px（与旧逻辑 top≈vh−92、高≈64 一致：92−64=28） */
const QUICK_COMPOSE_BAR_BOTTOM_GAP = 28;

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

/**
 * 工作区底部居中：与预览工具栏同系实色条快捷输入；支持多图、生成参数摘要条与弹出设置。
 */
export default function WorkspaceQuickComposeBar({
  visible,
  placement = 'floating',
  lightboxAnchorClient = null,
  lightboxLayoutResetNonce = 0,
  placeholderOverride,
  composeMode,
  onComposeModeChange,
  inputPresetsActive,
  segments,
  onSegmentsChange,
  mentionCandidates,
  dropSlots,
  onRemoveDropSlot,
  maxMentions,
  onSubmit,
  genSettings,
  showGenImageSettings,
  allowBatchCount,
  onComposeInputCapabilityDrop,
  onComposeInputWorkflowDrop,
  promptCards,
  onRemovePromptCard,
}: WorkspaceQuickComposeBarProps) {
  const mentions = useMemo(() => mentionsFromSegments(segments), [segments]);
  const mentionFieldRef = useRef<QuickComposeMentionFieldHandle | null>(null);
  const mentionedAssetIds = useMemo(
    () => new Set(mentions.filter((m) => m.kind === 'asset').map((m) => m.assetId)),
    [mentions]
  );
  const pendingDropSlots = useMemo(
    () => dropSlots.filter((s) => !mentionedAssetIds.has(s.assetId)),
    [dropSlots, mentionedAssetIds]
  );
  const barRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** 展开输入区前记录条形容器底边（视口 Y），用于增高时固定底边、向上延伸 */
  const expandAnchorBottomRef = useRef<number | null>(null);
  /** 收起前记录底边，用于变矮时固定底边、向上收合（与展开对称） */
  const collapseAnchorBottomRef = useRef<number | null>(null);
  const prevInputExpandedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 展开：输入区变高、整条变窄，便于编辑长文案 */
  const [inputExpanded, setInputExpanded] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    /** 与触发药丸水平居中对齐：样式 left + translateX(-50%) */
    anchorX: number;
    top: number;
    transform: string;
  } | null>(null);

  const { rows: effectiveModelRows, coerceModelId } = useEffectiveImageModelRows();
  /** 勿将整颗 `genSettings` 放进 deps：父级每次 render 都是新对象，会导致 layout effect 每帧跑一遍并可能级联 setState → 栈溢出。 */
  const coerceModelTargetId = genSettings.imageModelRegistryId;
  const onImageModelChange = genSettings.onImageModelRegistryId;

  useLayoutEffect(() => {
    if (!showGenImageSettings) return;
    const next = coerceModelId(coerceModelTargetId);
    if (next !== coerceModelTargetId) onImageModelChange(next);
  }, [showGenImageSettings, coerceModelId, coerceModelTargetId, onImageModelChange]);

  const resetToDefaultPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = barRef.current;
    const maxWCollapsed = Math.min(704, Math.max(280, vw - 24));
    const maxWExpanded = Math.min(448, Math.max(280, vw - 24));
    let w: number;
    let h: number;
    if (el) {
      const r = el.getBoundingClientRect();
      w = r.width > 1 ? Math.round(r.width) : inputExpanded ? maxWExpanded : maxWCollapsed;
      h = r.height > 1 ? Math.round(r.height) : inputExpanded ? 140 : 64;
    } else {
      w = inputExpanded ? maxWExpanded : maxWCollapsed;
      h = inputExpanded ? 140 : 64;
    }
    const left = Math.max(VIEW_MARGIN, Math.floor((vw - w) / 2));
    const top = vh - QUICK_COMPOSE_BAR_BOTTOM_GAP - h;
    setPosition(clampBarToViewport({ left, top }, el, vw, vh));
  }, [inputExpanded]);

  const isLightbox = placement === 'lightbox';

  const modeLockedByInputPresets = inputPresetsActive;
  const modeChipCls = (active: boolean) =>
    `${QUICK_COMPOSE_MODE_CHIP_BASE} ${
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

  useEffect(() => {
    if (!visible) {
      setSettingsOpen(false);
      return;
    }
    if (placement === 'lightbox') return;
    if (position) return;
    resetToDefaultPosition();
  }, [position, resetToDefaultPosition, visible, placement]);

  useLayoutEffect(() => {
    if (!visible || placement !== 'lightbox') return;
    if (lightboxAnchorClient) return;
    resetToDefaultPosition();
  }, [visible, placement, lightboxAnchorClient, lightboxLayoutResetNonce, resetToDefaultPosition]);

  const lightboxAnchorRef = useRef(lightboxAnchorClient);
  lightboxAnchorRef.current = lightboxAnchorClient;

  const applyLightboxBarToAnchor = useCallback(() => {
    const anchor = lightboxAnchorRef.current;
    if (!visible || placement !== 'lightbox' || !anchor) return;
    const gap = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = barRef.current;
    const r = el?.getBoundingClientRect();
    const w = r && r.width > 1 ? r.width : Math.min(576, Math.max(320, vw - 24));
    const left = anchor.x - w / 2;
    const top = anchor.y + gap;
    const next = clampBarToViewport({ left, top }, el ?? null, vw, vh);
    setPosition((prev) => {
      if (prev != null && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.top - next.top) < 1) return prev;
      return next;
    });
  }, [visible, placement]);

  useLayoutEffect(() => {
    if (!visible || placement !== 'lightbox' || !lightboxAnchorClient) return;
    applyLightboxBarToAnchor();
    const raf = requestAnimationFrame(() => applyLightboxBarToAnchor());
    return () => cancelAnimationFrame(raf);
  }, [visible, placement, lightboxAnchorClient, lightboxLayoutResetNonce, inputExpanded, applyLightboxBarToAnchor]);

  useEffect(() => {
    if (!visible || placement !== 'lightbox' || !lightboxAnchorClient) return;
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => applyLightboxBarToAnchor());
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, placement, lightboxAnchorClient, applyLightboxBarToAnchor]);

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

  useLayoutEffect(() => {
    if (!visible) return;
    const el = barRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wasExpanded = prevInputExpandedRef.current;
    prevInputExpandedRef.current = inputExpanded;

    if (inputExpanded && !wasExpanded) {
      const bottom = expandAnchorBottomRef.current;
      expandAnchorBottomRef.current = null;
      setPosition((prev) => {
        if (bottom == null || prev == null) return prev;
        const h = el.getBoundingClientRect().height;
        const nextTop = bottom - h;
        return clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
      });
      return;
    }

    if (!inputExpanded && wasExpanded) {
      const bottom = collapseAnchorBottomRef.current;
      collapseAnchorBottomRef.current = null;
      if (bottom != null) {
        setPosition((prev) => {
          if (prev == null) return prev;
          const h = el.getBoundingClientRect().height;
          const nextTop = bottom - h;
          return clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
        });
        return;
      }
    }

    clampPositionToViewport();
  }, [inputExpanded, visible, clampPositionToViewport]);

  useEffect(() => {
    if (!visible) return;
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
  }, [visible, clampPositionToViewport]);

  if (!visible) return null;

  const disabled = false;
  const trimmedOverride = placeholderOverride?.trim();
  const placeholder = trimmedOverride
    ? trimmedOverride
    : (() => {
        if (composeMode === '3d') {
          return '生成 3D：请 @ 引用图片资产并可选填说明';
        }
        if (composeMode === 'text') {
          return '输入问题或指令（文模式请 @ 文字资产）';
        }
        return `想创作什么？输入 @ 引用参考图（最多 ${maxMentions} 张）`;
      })();

  const aspectSummary =
    genSettings.aspectRatio === 'adaptive' ? '自' : genSettings.aspectRatio || '自';
  const sizeSummary =
    genSettings.imageSize && SUPPORTED_IMAGE_SIZES.some((s) => s.value === genSettings.imageSize)
      ? genSettings.imageSize
      : '';
  const countSummary = allowBatchCount ? Math.min(4, Math.max(1, genSettings.count)) : 1;
  const understandSummary = showGenImageSettings ? (genSettings.understand ? '解' : '直发') : '';

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

  const modelShortLabel = shortLabelForImageModelRegistryId(genSettings.imageModelRegistryId);
  const modelFullLabel = labelForImageModelRegistryId(genSettings.imageModelRegistryId);

  const modelPickerControl = showGenImageSettings ? (
    <CustomDropdown
      options={effectiveModelRows.map((g) => ({
        value: g.registryId,
        label: g.label,
        disabled: g.disabled,
        title: g.disabled ? g.disabledReason : undefined,
      }))}
      value={genSettings.imageModelRegistryId}
      onChange={(v) => {
        const row = effectiveModelRows.find((g) => g.registryId === v);
        if (row && !row.disabled) genSettings.onImageModelRegistryId(v);
      }}
      triggerClassName={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-gray-300`}
      portalZIndex={{ backdrop: 2602, list: 2603 }}
      triggerAriaLabel={`生图模型：${modelFullLabel}`}
      listMinWidth={176}
      renderTrigger={({ open }) => (
        <>
          <span className="tabular-nums font-semibold text-gray-200" title={modelFullLabel}>
            {modelShortLabel}
          </span>
          <span className="shrink-0 text-[7px] leading-none text-gray-600">{open ? '▲' : '▼'}</span>
        </>
      )}
    />
  ) : null;

  const genParamsSummary = (
    <>
      {showGenImageSettings ? (
        <>
          <span className="shrink-0 text-[9px] text-gray-400">{aspectSummary}</span>
          {sizeSummary ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">·</span>
              <span className="shrink-0 text-[9px] font-mono text-gray-400">{sizeSummary}</span>
            </>
          ) : null}
          {understandSummary ? (
            <>
              <span className="shrink-0 text-[9px] text-gray-600">·</span>
              <span className="shrink-0 text-[9px] font-semibold text-gray-400">{understandSummary}</span>
            </>
          ) : null}
        </>
      ) : null}
      {allowBatchCount ? (
        <>
          {showGenImageSettings ? (
            <span className="shrink-0 text-[9px] text-gray-600">·</span>
          ) : null}
          <span className="shrink-0 text-[9px] font-bold tabular-nums text-gray-400">x{countSummary}</span>
        </>
      ) : null}
    </>
  );

  const genActionControls = (
    <div className="flex shrink-0 items-center gap-2.5">
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

      {modelPickerControl}

      <button
        ref={settingsTriggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setSettingsOpen((o) => !o)}
        className={`${QUICK_COMPOSE_PILL_TRIGGER} max-w-[min(11rem,36vw)] overflow-hidden text-left`}
        title="生成参数"
        aria-expanded={settingsOpen}
        aria-haspopup="dialog"
      >
        {genParamsSummary}
        <span className="ml-px shrink-0 text-[7px] leading-none text-gray-600">{settingsOpen ? '▲' : '▼'}</span>
      </button>
    </div>
  );

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
                        <button
                          type="button"
                          onClick={() => genSettings.onUnderstand(true)}
                          className={chipClsStretch(genSettings.understand)}
                          title="先理解用户意图，再生成画面"
                        >
                          理解
                        </button>
                        <button
                          type="button"
                          onClick={() => genSettings.onUnderstand(false)}
                          className={chipClsStretch(!genSettings.understand)}
                          title="跳过理解，直发提示词到生图"
                        >
                          直发
                        </button>
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

              {mentions.length > 0 ? (
                <div className="table-row">
                  <div className="table-cell p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => {
                        onSegmentsChange([newQuickComposeTextSegment('')]);
                        setSettingsOpen(false);
                      }}
                      className="mt-0.5 w-full rounded-md py-1 text-[9px] font-semibold text-gray-500 ring-1 ring-white/[0.07] hover:bg-white/[0.05] hover:text-gray-300"
                    >
                      清空 @ 引用
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>,
          document.body
        )
      : null;

  const barPositionStyle: React.CSSProperties | undefined = position
    ? { left: `${position.left}px`, top: `${position.top}px`, userSelect: dragging ? 'none' : 'auto' }
    : isLightbox
      ? { visibility: 'hidden' as const }
      : undefined;

  return (
    <>
      <div
        ref={barRef}
        className={`pointer-events-auto fixed max-w-[96vw] px-2 ${
          inputExpanded
            ? 'w-[min(28rem,calc(100vw-1.5rem))]'
            : 'w-[min(44rem,calc(100vw-1.5rem))]'
        } ${isLightbox ? 'z-[2500]' : 'z-[1600]'}`}
        style={barPositionStyle}
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

          {pendingDropSlots.length > 0 ? (
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-[1] mb-2"
              onDragOver={isLightbox ? undefined : handleComposeInputDragOver}
              onDrop={isLightbox ? undefined : handleComposeInputDrop}
            >
              <QuickComposeDropTray
                slots={pendingDropSlots}
                disabled={disabled}
                atMentionLimit={mentions.length >= maxMentions}
                onActivate={(assetId) => {
                  const slot = dropSlots.find((s) => s.assetId === assetId);
                  if (!slot) return;
                  mentionFieldRef.current?.insertMentionCandidate({
                    kind: 'asset',
                    assetId: slot.assetId,
                    label: slot.label,
                    previewSrc: slot.previewSrc,
                  });
                }}
                onRemoveSlot={onRemoveDropSlot}
                onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
              />
            </div>
          ) : null}

          {inputExpanded ? (
            <div
              className={`flex flex-col gap-2 px-2 py-2 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
              role="search"
            >
              <div className="flex min-w-0 items-start gap-1.5">
                <QuickComposeMentionField
                  ref={mentionFieldRef}
                  segments={segments}
                  onSegmentsChange={onSegmentsChange}
                  mentionCandidates={mentionCandidates}
                  maxMentions={maxMentions}
                  placeholder={placeholder}
                  disabled={disabled}
                  multiline
                  rows={5}
                  ariaLabel={isLightbox ? '大图预览快捷生成描述' : '快捷生成描述'}
                  onSubmit={onSubmit}
                  onDragOver={handleComposeInputDragOver}
                  onDrop={handleComposeInputDrop}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const r = barRef.current?.getBoundingClientRect();
                    collapseAnchorBottomRef.current = r != null && r.height > 0 ? r.bottom : null;
                    setInputExpanded(false);
                  }}
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  title="收起为单行"
                  aria-label="收起输入区"
                  aria-pressed
                >
                  <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                </button>
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-white/[0.06] pt-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                  {isLightbox ? (
                    <div
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-400"
                      title="默认 @当前画面；可再 @ 其它资产作额外参考"
                    >
                      <ImageIcon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} aria-hidden />
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  {genActionControls}

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
                      strokeWidth={2.2}
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
          ) : (
            <div
              className={`flex items-center gap-2 px-2 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
              role="search"
            >
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
              {isLightbox ? (
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-400"
                  title="默认 @当前画面；可再 @ 其它资产作额外参考"
                >
                  <ImageIcon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.2} aria-hidden />
                </div>
              ) : null}

              <QuickComposeMentionField
                ref={mentionFieldRef}
                segments={segments}
                onSegmentsChange={onSegmentsChange}
                mentionCandidates={mentionCandidates}
                maxMentions={maxMentions}
                placeholder={placeholder}
                disabled={disabled}
                ariaLabel={isLightbox ? '大图预览快捷生成描述' : '快捷生成描述'}
                onSubmit={onSubmit}
                onDragOver={handleComposeInputDragOver}
                onDrop={handleComposeInputDrop}
              />

              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const r = barRef.current?.getBoundingClientRect();
                  expandAnchorBottomRef.current = r != null && r.height > 0 ? r.bottom : null;
                  setInputExpanded(true);
                }}
                className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                title="展开多行（条宽变窄）；多行时 Ctrl+Enter 提交"
                aria-label="展开输入区"
                aria-pressed={false}
              >
                <Maximize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
              </button>

              <div className="ml-2 flex shrink-0 items-center gap-3">
                {genActionControls}

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
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {settingsPanel}
    </>
  );
}
