import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, Maximize2, Minimize2 } from 'lucide-react';
import { imageSizeSelectOptionsForRegistryModel } from '../services/openaiAdapter';
import { useEffectiveImageModelRows } from '../hooks/useEffectiveImageGearRows';
import { useEffectiveTextModelRows } from '../hooks/useEffectiveTextModelRows';
import {
  DT_AC_CAPABILITY_ACTION,
  DT_AC_CAPABILITY_FROM_EDITOR,
  DT_AC_WORKFLOW_EXPORT,
} from '../services/workflowDragPipeline';
import {
  labelForImageModelRegistryId,
  shortLabelForImageModelRegistryId,
} from '../services/modelRegistry/imageModels';
import {
  labelForTextModelRegistryId,
  shortLabelForTextModelRegistryId,
} from '../services/modelRegistry/textModels';
import {
  WORKFLOW_QUICK_COMPOSE_BAR_SHELL,
  WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS,
} from './workflow/workflowSectionUiConstants';
import {
  DROPDOWN_OPTION_CHIP_ACTIVE,
  DROPDOWN_OPTION_CHIP_DISABLED,
  DROPDOWN_OPTION_CHIP_IDLE,
} from './ui/CustomDropdown';
import QuickComposeDropTray from './workflow/QuickComposeDropTray';
import QuickComposeMentionField, {
  type QuickComposeMentionFieldHandle,
} from './workflow/QuickComposeMentionField';
import ProjectAgentDock, {
  type ProjectAgentDockProps,
} from './project-agent/ProjectAgentDock';
import type {
  QuickComposeDropSlot,
  QuickComposeDropZone,
  QuickComposeMentionCandidate,
  QuickComposeSegment,
} from '../services/quickComposeMention';
import { mentionsFromSegments, mergeQuickComposeDropSlotsForMentions, newQuickComposeTextSegment } from '../services/quickComposeMention';
import { parseWorkflowAssetIdsFromClipboardData } from '../services/workflowDragPipeline';
import {
  clampQuickComposeBarPosition,
  computeQuickComposeExpandedTextMaxHeight,
  QUICK_COMPOSE_VIEW_MARGIN,
} from '../services/quickComposeBarViewport';

export type WorkspaceQuickComposeGenSettings = {
  imageModelRegistryId: string;
  onImageModelRegistryId: (v: string) => void;
  textModelRegistryId: string;
  onTextModelRegistryId: (v: string) => void;
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

export type WorkspaceQuickComposeComposeMode = 'text' | 'image' | '3d' | 'auto';

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
  /** 主图区（每张主图 = 一条任务的图1） */
  mainDropSlots: QuickComposeDropSlot[];
  /** 参考图区（所有主图任务共用，图2、图3…） */
  referenceDropSlots: QuickComposeDropSlot[];
  onRemoveMainDropSlot: (assetId: string) => void;
  onRemoveReferenceDropSlot: (assetId: string) => void;
  /** 托盘内拖动：在主图区 / 参考图区之间换区 */
  onMoveDropSlot?: (assetId: string, toZone: QuickComposeDropZone) => void;
  /** 同区内拖动调整顺序 */
  onReorderDropSlot?: (assetId: string, zone: QuickComposeDropZone, toIndex: number) => void;
  /** 参考图（@ 引用）数量上限 */
  maxMentions: number;
  /** 积分不足等：禁用 composer 输入（不含空 draft） */
  inputDisabled?: boolean;
  /** 积分不足、空 draft、或助手进行中：禁用发送 */
  submitDisabled?: boolean;
  submitDisabledReason?: string;
  onSubmit: () => void;
  genSettings: WorkspaceQuickComposeGenSettings;
  /** 展示档位 / 比例 / 输出尺寸（生图引擎） */
  showGenImageSettings: boolean;
  /** 展示文字模型选择（文模式） */
  showGenTextSettings: boolean;
  /** 展示生成数量 1～4 */
  allowBatchCount: boolean;
  /** 拖入「文本框」区域时：切换快捷能力并追加预设提示词卡片（功能区/能力列 MIME） */
  onComposeInputCapabilityDrop?: (presetId: string) => void;
  /** 拖入工作区资产；zone 区分主图区 / 参考图区 */
  onComposeInputWorkflowDrop?: (e: React.DragEvent, zone: QuickComposeDropZone) => void;
  /** 粘贴自缩略图/列表「复制 ID」的资产引用（不新建卡片） */
  onPasteAssetRefs?: (assetIds: string[], zone: QuickComposeDropZone) => void;
  /** 粘贴引用默认落入的拖入区；大图预览为 reference（当前图固定主图） */
  pasteAssetRefZone?: QuickComposeDropZone;
  /** 仅 lightbox：隐藏主图区（当前画面即主图） */
  hideMainDropZone?: boolean;
  /** 展开态：portal 到外层右侧挂载点（工作区 / 大图左右分栏） */
  expandedDockHostRef?: React.RefObject<HTMLDivElement | null>;
  /** 内嵌展开态变化（供外层收窄主区域） */
  onInputExpandedChange?: (expanded: boolean) => void;
  promptCards: WorkspaceQuickComposePromptCard[];
  onRemovePromptCard: (key: string) => void;
  /**
   * 展开 dock 且提供时：右侧内嵌区渲染 `QuickComposeChatDock`（对话线程 + composer），
   * 替代 mention 大输入区；未提供时保持原有 dock 布局（fallback）。
   */
  chatDockProps?: Pick<
    ProjectAgentDockProps,
    | 'messages'
    | 'onRetryMessage'
    | 'onMessageAction'
    | 'onCancelMessage'
    | 'onResultPreview'
    | 'selectionStatusLabel'
    | 'selectionStatusTone'
    | 'onOpenPanel'
    | 'onClearChat'
    | 'onLoadEarlier'
    | 'canLoadEarlier'
    | 'onExportChat'
    | 'threadEmptyTitle'
    | 'threadEmptyHint'
    | 'minimizeDisabled'
    | 'className'
    | 'expertStudio'
    | 'onTryRunPrompt'
    | 'memoryEntries'
    | 'onToggleMemory'
    | 'onDeleteMemory'
    | 'skillEntries'
    | 'onToggleSkill'
    | 'onDeleteSkill'
    | 'onInstallSampleSkill'
    | 'onImportSkillPreview'
  >;
};

export type WorkspaceQuickComposeChatDockProps = NonNullable<
  WorkspaceQuickComposeBarProps['chatDockProps']
>;

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

const VIEW_MARGIN = QUICK_COMPOSE_VIEW_MARGIN;
/** 快捷条默认贴底：底边距视口底约 28px（与旧逻辑 top≈vh−92、高≈64 一致：92−64=28） */
const QUICK_COMPOSE_BAR_BOTTOM_GAP = 28;

/** 将 fixed 定位的 left/top 限制在当前视口内（含上方浮层 overhang） */
function clampBarToViewport(
  pos: { left: number; top: number },
  barEl: HTMLElement | null,
  vw: number,
  vh: number
): { left: number; top: number } {
  return clampQuickComposeBarPosition(pos, barEl, vw, vh, VIEW_MARGIN);
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
  mainDropSlots,
  referenceDropSlots,
  onRemoveMainDropSlot,
  onRemoveReferenceDropSlot,
  onMoveDropSlot,
  onReorderDropSlot,
  maxMentions,
  onSubmit,
  inputDisabled: inputDisabledProp,
  submitDisabled = false,
  submitDisabledReason,
  genSettings,
  showGenImageSettings,
  showGenTextSettings,
  allowBatchCount,
  onComposeInputCapabilityDrop,
  onComposeInputWorkflowDrop,
  onPasteAssetRefs,
  pasteAssetRefZone = 'main',
  hideMainDropZone = false,
  expandedDockHostRef,
  onInputExpandedChange,
  promptCards,
  onRemovePromptCard,
  chatDockProps,
}: WorkspaceQuickComposeBarProps) {
  const mentions = useMemo(() => mentionsFromSegments(segments), [segments]);
  const mentionFieldRef = useRef<QuickComposeMentionFieldHandle | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const textModelTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelAnchor, setPanelAnchor] = useState<'model' | 'textModel' | 'params'>('params');
  /** 展开输入区前记录条形容器底边（视口 Y），用于增高时固定底边、向上延伸 */
  const expandAnchorBottomRef = useRef<number | null>(null);
  /** 收起前记录底边，用于变矮时固定底边、向上收合（与展开对称） */
  const collapseAnchorBottomRef = useRef<number | null>(null);
  /** 展开期间固定底边，输入增高时向上延伸且不超出视口 */
  const expandedBarBottomRef = useRef<number | null>(null);
  const prevInputExpandedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 展开：输入区变高、整条变窄，便于编辑长文案 */
  const [inputExpanded, setInputExpanded] = useState(false);
  const [composeTextMaxHeightPx, setComposeTextMaxHeightPx] = useState<number | undefined>(undefined);
  const [panelPos, setPanelPos] = useState<{
    /** 与触发药丸水平居中对齐：样式 left + translateX(-50%) */
    anchorX: number;
    top: number;
    transform: string;
  } | null>(null);

  const { rows: effectiveModelRows, coerceModelId } = useEffectiveImageModelRows();
  const { rows: effectiveTextModelRows, coerceModelId: coerceTextModelId } = useEffectiveTextModelRows();
  /** 勿将整颗 `genSettings` 放进 deps：父级每次 render 都是新对象，会导致 layout effect 每帧跑一遍并可能级联 setState → 栈溢出。 */
  const coerceModelTargetId = genSettings.imageModelRegistryId;
  const onImageModelChange = genSettings.onImageModelRegistryId;
  const coerceTextModelTargetId = genSettings.textModelRegistryId;
  const onTextModelChange = genSettings.onTextModelRegistryId;

  useLayoutEffect(() => {
    if (!showGenImageSettings) return;
    const next = coerceModelId(coerceModelTargetId);
    if (next !== coerceModelTargetId) onImageModelChange(next);
  }, [showGenImageSettings, coerceModelId, coerceModelTargetId, onImageModelChange]);

  useLayoutEffect(() => {
    if (!showGenTextSettings) return;
    const next = coerceTextModelId(coerceTextModelTargetId);
    if (next !== coerceTextModelTargetId) onTextModelChange(next);
  }, [showGenTextSettings, coerceTextModelId, coerceTextModelTargetId, onTextModelChange]);

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
  const isLightboxInlineChatExpanded = inputExpanded && isLightbox && Boolean(chatDockProps);
  const isWorkspaceDockedExpanded =
    inputExpanded && expandedDockHostRef?.current != null && !isLightbox;

  useLayoutEffect(() => {
    onInputExpandedChange?.(inputExpanded);
  }, [inputExpanded, onInputExpandedChange]);

  const [dockHostRev, setDockHostRev] = useState(0);
  useLayoutEffect(() => {
    if (!isWorkspaceDockedExpanded) return;
    if (!expandedDockHostRef?.current) return;
    setDockHostRev((n) => n + 1);
  }, [isWorkspaceDockedExpanded, expandedDockHostRef]);

  const collapseInputExpanded = useCallback(() => {
    const r = barRef.current?.getBoundingClientRect();
    collapseAnchorBottomRef.current = r != null && r.height > 0 ? r.bottom : null;
    setInputExpanded(false);
  }, []);

  const modeLockedByInputPresets = inputPresetsActive;
  const modeChipCls = (active: boolean) =>
    `${QUICK_COMPOSE_MODE_CHIP_BASE} ${
      modeLockedByInputPresets
        ? 'cursor-not-allowed opacity-40 ring-1 ring-white/[0.06] text-gray-500'
        : active
          ? 'bg-white text-[#0a0a0c] ring-1 ring-white'
          : 'bg-white/[0.06] text-gray-300 ring-1 ring-white/[0.08] hover:bg-white/[0.1]'
    }`;

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
      // 与悬浮条一致：只要挂了能力/资产回调就允许放置。
      // 部分浏览器 dragover 阶段不暴露自定义 MIME，不能靠 types 卡死。
      const allowCap = Boolean(onComposeInputCapabilityDrop);
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
    [dragHasWorkflowExport, onComposeInputCapabilityDrop, onComposeInputWorkflowDrop]
  );

  const handleComposeInputDrop = useCallback(
    (e: React.DragEvent, zone: QuickComposeDropZone = 'main') => {
      // 资产拖放优先
      if (onComposeInputWorkflowDrop && dragHasWorkflowExport(e)) {
        e.preventDefault();
        e.stopPropagation();
        onComposeInputWorkflowDrop(e, zone);
        return;
      }
      // 与悬浮条一致：drop 时直接读 id，不依赖 types 门闩
      if (onComposeInputCapabilityDrop) {
        const id = readDroppedCapabilityPresetId(e.dataTransfer);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          onComposeInputCapabilityDrop(id);
        }
      }
    },
    [
      dragHasWorkflowExport,
      onComposeInputCapabilityDrop,
      onComposeInputWorkflowDrop,
      readDroppedCapabilityPresetId,
    ]
  );

  const handleMainZoneDragOver = useCallback(
    (e: React.DragEvent) => {
      const allowCap = Boolean(onComposeInputCapabilityDrop);
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
    [dragHasWorkflowExport, onComposeInputCapabilityDrop, onComposeInputWorkflowDrop]
  );

  const handlePresetOnlyDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onComposeInputCapabilityDrop) return;
      const id = readDroppedCapabilityPresetId(e.dataTransfer);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      onComposeInputCapabilityDrop(id);
    },
    [onComposeInputCapabilityDrop, readDroppedCapabilityPresetId]
  );

  const bindQuickComposeDropZone = useCallback(
    (zone: QuickComposeDropZone) => ({
      onDragOver: isLightbox
        ? undefined
        : (e: React.DragEvent) => {
            e.stopPropagation();
            handleMainZoneDragOver(e);
          },
      onDrop: isLightbox
        ? undefined
        : (e: React.DragEvent) => {
            e.stopPropagation();
            handleComposeInputDrop(e, zone);
          },
    }),
    [handleComposeInputDrop, handleMainZoneDragOver, isLightbox]
  );

  const pasteRefZone: QuickComposeDropZone =
    pasteAssetRefZone ?? (hideMainDropZone ? 'reference' : 'main');

  const handlePasteAssetRefs = useCallback(
    (e: React.ClipboardEvent, zone: QuickComposeDropZone = pasteRefZone) => {
      if (!onPasteAssetRefs) return;
      const assetIds = parseWorkflowAssetIdsFromClipboardData(e.clipboardData);
      if (assetIds.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onPasteAssetRefs(assetIds, zone);
    },
    [onPasteAssetRefs, pasteRefZone]
  );

  const handleDropSlotClick = useCallback(
    (slot: QuickComposeDropSlot) => {
      mentionFieldRef.current?.stashCaretBeforeBlur();
      const merged = mergeQuickComposeDropSlotsForMentions(mainDropSlots, referenceDropSlots);
      const mergedSlot = merged.find((s) => s.assetId === slot.assetId);
      const fromCandidates = mentionCandidates.find(
        (c): c is Extract<QuickComposeMentionCandidate, { kind: 'asset' }> =>
          c.kind === 'asset' && c.assetId === slot.assetId
      );
      const candidate: QuickComposeMentionCandidate = fromCandidates ?? {
        kind: 'asset',
        assetId: slot.assetId,
        label: mergedSlot?.label ?? slot.label,
        previewSrc: slot.previewSrc,
      };
      mentionFieldRef.current?.insertMentionCandidate(candidate);
    },
    [mainDropSlots, referenceDropSlots, mentionCandidates]
  );

  /** 仅在有拖入图片时展示主图/参考图两区；大图模式始终展示参考图区（当前图固定为主图） */
  const showSplitDropZones =
    hideMainDropZone || mainDropSlots.length > 0 || referenceDropSlots.length > 0;

  const hasMainDropSlots = mainDropSlots.length > 0;
  const hasReferenceDropSlots = referenceDropSlots.length > 0;
  /** 参考区有图时需保留主区作跨区拖放目标；主区有图时保留参考区作空拖入位 */
  const showMainDropColumn = !hideMainDropZone && (hasMainDropSlots || hasReferenceDropSlots);
  const showReferenceDropColumn =
    hideMainDropZone || hasReferenceDropSlots || (!hideMainDropZone && hasMainDropSlots);
  /** 双列布局时始终显示分割线（含仅一侧有图、另一侧为空拖入位） */
  const showZoneDivider =
    !hideMainDropZone && showMainDropColumn && showReferenceDropColumn;
  const splitDropZoneGridCols = hideMainDropZone
    ? 'grid-cols-1'
    : showZoneDivider
      ? 'grid-cols-[auto_2px_auto]'
      : 'grid-cols-1';

  const hasDropZones = showSplitDropZones || promptCards.length > 0;

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
    if (!visible || placement !== 'lightbox' || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded) return;
    if (lightboxAnchorClient) return;
    resetToDefaultPosition();
  }, [visible, placement, lightboxAnchorClient, lightboxLayoutResetNonce, resetToDefaultPosition, isWorkspaceDockedExpanded, isLightboxInlineChatExpanded]);

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

  const clampPositionToViewport = useCallback(() => {
    setPosition((prev) => {
      if (!prev) return prev;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return clampBarToViewport(prev, barRef.current, vw, vh);
    });
  }, []);

  const syncExpandedBarViewport = useCallback(() => {
    const el = barRef.current;
    if (!el || !inputExpanded || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded) {
      setComposeTextMaxHeightPx(undefined);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    const maxBottom = vh - VIEW_MARGIN;

    if (placement === 'lightbox') {
      setComposeTextMaxHeightPx(
        computeQuickComposeExpandedTextMaxHeight(el, {
          anchorBottom: Math.min(rect.bottom, maxBottom),
        })
      );
      if (lightboxAnchorRef.current) {
        applyLightboxBarToAnchor();
      } else {
        clampPositionToViewport();
      }
      return;
    }

    if (expandedBarBottomRef.current == null) {
      expandedBarBottomRef.current = Math.min(rect.bottom, maxBottom);
    }
    const bottom = Math.min(expandedBarBottomRef.current, maxBottom);
    const h = rect.height;
    const nextTop = bottom - h;

    setComposeTextMaxHeightPx(
      computeQuickComposeExpandedTextMaxHeight(el, { anchorBottom: bottom })
    );

    setPosition((prev) => {
      if (!prev) return prev;
      const clamped = clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
      expandedBarBottomRef.current = Math.min(clamped.top + h, maxBottom);
      if (Math.abs(clamped.top - prev.top) < 0.5 && Math.abs(clamped.left - prev.left) < 0.5) {
        return prev;
      }
      return clamped;
    });
  }, [inputExpanded, placement, applyLightboxBarToAnchor, clampPositionToViewport, isWorkspaceDockedExpanded, isLightboxInlineChatExpanded]);

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
      if (inputExpanded && barRef.current) {
        expandedBarBottomRef.current = barRef.current.getBoundingClientRect().bottom;
        syncExpandedBarViewport();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, inputExpanded, syncExpandedBarViewport]);

  const activeGenPanelTriggerRef =
    panelAnchor === 'model'
      ? modelTriggerRef
      : panelAnchor === 'textModel'
        ? textModelTriggerRef
        : settingsTriggerRef;

  useLayoutEffect(() => {
    if (!settingsOpen || typeof window === 'undefined') return;
    const measure = () => {
      const tr = activeGenPanelTriggerRef.current;
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
  }, [settingsOpen, position, panelAnchor]);

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

  useLayoutEffect(() => {
    if (!visible || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded) return;
    const el = barRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wasExpanded = prevInputExpandedRef.current;
    prevInputExpandedRef.current = inputExpanded;

    if (inputExpanded && !wasExpanded) {
      const bottom = expandAnchorBottomRef.current;
      expandAnchorBottomRef.current = null;
      if (bottom != null) expandedBarBottomRef.current = bottom;
      setPosition((prev) => {
        if (bottom == null || prev == null) return prev;
        const h = el.getBoundingClientRect().height;
        const nextTop = bottom - h;
        return clampBarToViewport({ left: prev.left, top: nextTop }, el, vw, vh);
      });
      requestAnimationFrame(() => syncExpandedBarViewport());
      return;
    }

    if (!inputExpanded && wasExpanded) {
      expandedBarBottomRef.current = null;
      setComposeTextMaxHeightPx(undefined);
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
  }, [inputExpanded, visible, clampPositionToViewport, syncExpandedBarViewport, isWorkspaceDockedExpanded, isLightboxInlineChatExpanded]);

  useLayoutEffect(() => {
    if (!visible || !inputExpanded || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded) return;
    const el = barRef.current;
    if (!el) return;
    syncExpandedBarViewport();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncExpandedBarViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, inputExpanded, syncExpandedBarViewport, segments, isWorkspaceDockedExpanded, isLightboxInlineChatExpanded]);

  useEffect(() => {
    if (!visible || !inputExpanded || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded) return;
    const onResize = () => syncExpandedBarViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visible, inputExpanded, syncExpandedBarViewport, isWorkspaceDockedExpanded, isLightboxInlineChatExpanded]);

  useEffect(() => {
    if (!visible) return;

    const RESIZE_RESET_DEBOUNCE_MS = 400;
    const RESIZE_RESET_MIN_DELTA_PX = 16;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCommittedVw = window.innerWidth;
    let lastCommittedVh = window.innerHeight;

    const scheduleClamp = () => {
      requestAnimationFrame(() => clampPositionToViewport());
    };

    const scheduleResetToDefaultOnResize = () => {
      if (dragOffsetRef.current !== null) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (
        Math.abs(vw - lastCommittedVw) < RESIZE_RESET_MIN_DELTA_PX &&
        Math.abs(vh - lastCommittedVh) < RESIZE_RESET_MIN_DELTA_PX
      ) {
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        lastCommittedVw = window.innerWidth;
        lastCommittedVh = window.innerHeight;
        if (placement === 'lightbox' && lightboxAnchorRef.current) {
          applyLightboxBarToAnchor();
        } else {
          resetToDefaultPosition();
        }
      }, RESIZE_RESET_DEBOUNCE_MS);
    };

    window.addEventListener('resize', scheduleResetToDefaultOnResize);
    const vv = typeof window !== 'undefined' && window.visualViewport;
    vv?.addEventListener('resize', scheduleClamp);
    vv?.addEventListener('scroll', scheduleClamp);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', scheduleResetToDefaultOnResize);
      vv?.removeEventListener('resize', scheduleClamp);
      vv?.removeEventListener('scroll', scheduleClamp);
    };
  }, [
    visible,
    placement,
    clampPositionToViewport,
    resetToDefaultPosition,
    applyLightboxBarToAnchor,
  ]);

  const imageSizeOptions = useMemo(
    () => imageSizeSelectOptionsForRegistryModel(genSettings.imageModelRegistryId),
    [genSettings.imageModelRegistryId]
  );

  useLayoutEffect(() => {
    if (!visible) return;
    const allowed = imageSizeOptions.map((s) => s.value);
    if (genSettings.imageSize && !allowed.includes(genSettings.imageSize)) {
      genSettings.onImageSize('');
    }
  }, [visible, genSettings.imageModelRegistryId, genSettings.imageSize, genSettings.onImageSize, imageSizeOptions]);

  if (!visible) return null;

  const inputDisabled = inputDisabledProp === true;
  const controlsDisabled = inputDisabled;
  const submitDisabledTitle = submitDisabled ? submitDisabledReason : undefined;
  const trimmedOverride = placeholderOverride?.trim();
  const placeholder = trimmedOverride
    ? trimmedOverride
    : (() => {
        if (composeMode === '3d') {
          return '说说你想把哪些资产转成 3D...';
        }
        if (composeMode === 'text') {
          return '说说你想整理、分析或说明什么...';
        }
        if (composeMode === 'auto') {
          return '说说你想完成什么，Agent 会自动选择方式...';
        }
        return `说说你想完成什么... 可 @ 资产/项目/专家（最多 ${maxMentions} 个）`;
      })();

  const aspectSummary =
    genSettings.aspectRatio === 'adaptive' ? '自' : genSettings.aspectRatio || '自';
  const sizeSummary =
    genSettings.imageSize && imageSizeOptions.some((s) => s.value === genSettings.imageSize)
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
  const textModelShortLabel = shortLabelForTextModelRegistryId(genSettings.textModelRegistryId);
  const textModelFullLabel = labelForTextModelRegistryId(genSettings.textModelRegistryId);

  const modelPickerControl = showGenImageSettings ? (
    <button
      ref={modelTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('model');
        setSettingsOpen((open) => (open && panelAnchor === 'model' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-gray-300`}
      title={`生图模型：${modelFullLabel}`}
      aria-expanded={settingsOpen && panelAnchor === 'model'}
      aria-haspopup="dialog"
    >
      <span className="tabular-nums font-semibold text-gray-200" title={modelFullLabel}>
        {modelShortLabel}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'model' ? '▲' : '▼'}
      </span>
    </button>
  ) : null;

  const textModelPickerControl = showGenTextSettings ? (
    <button
      ref={textModelTriggerRef}
      type="button"
      disabled={controlsDisabled}
      onClick={() => {
        setPanelAnchor('textModel');
        setSettingsOpen((open) => (open && panelAnchor === 'textModel' ? false : true));
      }}
      className={`${QUICK_COMPOSE_PILL_TRIGGER} font-bold text-emerald-300/90`}
      title={`文字模型：${textModelFullLabel}`}
      aria-expanded={settingsOpen && panelAnchor === 'textModel'}
      aria-haspopup="dialog"
    >
      <span className="tabular-nums font-semibold text-emerald-200/90" title={textModelFullLabel}>
        {textModelShortLabel}
      </span>
      <span className="shrink-0 text-[7px] leading-none text-gray-600">
        {settingsOpen && panelAnchor === 'textModel' ? '▲' : '▼'}
      </span>
    </button>
  ) : null;

  const modelOptionChipCls = (on: boolean, disabled?: boolean) =>
    disabled ? DROPDOWN_OPTION_CHIP_DISABLED : on ? DROPDOWN_OPTION_CHIP_ACTIVE : DROPDOWN_OPTION_CHIP_IDLE;

  const openGenParamsPanel = () => {
    setPanelAnchor('params');
    setSettingsOpen((open) => (open && panelAnchor === 'params' ? false : true));
  };

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
            : '快捷模式：文 · 图 · 3D · 自动（无拖入预设时使用；自动可推断，芯片可覆盖）'
        }
      >
        {(['text', 'image', '3d', 'auto'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={controlsDisabled || modeLockedByInputPresets}
            onClick={() => {
              if (modeLockedByInputPresets) return;
              onComposeModeChange(m);
            }}
            className={modeChipCls(composeMode === m)}
          >
            {m === 'text' ? '文' : m === 'image' ? '图' : m === '3d' ? '3D' : '自动'}
          </button>
        ))}
      </div>

      {modelPickerControl}
      {textModelPickerControl}

      <button
        ref={settingsTriggerRef}
        type="button"
        disabled={controlsDisabled}
        onClick={openGenParamsPanel}
        className={`${QUICK_COMPOSE_PILL_TRIGGER} max-w-[min(11rem,36vw)] overflow-hidden text-left`}
        title="生成参数"
        aria-expanded={settingsOpen && panelAnchor === 'params'}
        aria-haspopup="dialog"
      >
        {genParamsSummary}
        <span className="ml-px shrink-0 text-[7px] leading-none text-gray-600">
          {settingsOpen && panelAnchor === 'params' ? '▲' : '▼'}
        </span>
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
              aria-label={
                panelAnchor === 'model'
                  ? '选择生图模型'
                  : panelAnchor === 'textModel'
                    ? '选择文字模型'
                    : '本次生成参数'
              }
            >
              {panelAnchor === 'model' && showGenImageSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveModelRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onImageModelRegistryId(g.registryId);
                            const allowed = imageSizeSelectOptionsForRegistryModel(g.registryId).map(
                              (s) => s.value
                            );
                            if (genSettings.imageSize && !allowed.includes(genSettings.imageSize)) {
                              genSettings.onImageSize('');
                            }
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(
                            genSettings.imageModelRegistryId === g.registryId,
                            g.disabled
                          )}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'textModel' && showGenTextSettings ? (
                <div className="table-row">
                  <div className="table-cell w-full min-w-0 p-0 align-middle">
                    <div className="flex flex-col gap-1">
                      {effectiveTextModelRows.map((g) => (
                        <button
                          key={g.registryId}
                          type="button"
                          disabled={g.disabled}
                          title={g.disabled ? g.disabledReason : g.label}
                          onClick={() => {
                            if (g.disabled) return;
                            genSettings.onTextModelRegistryId(g.registryId);
                            setSettingsOpen(false);
                          }}
                          className={modelOptionChipCls(
                            genSettings.textModelRegistryId === g.registryId,
                            g.disabled
                          )}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {panelAnchor === 'params' && showGenImageSettings ? (
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
                        {imageSizeOptions.map((s) => (
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

              {panelAnchor === 'params' && allowBatchCount ? (
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

              {panelAnchor === 'params' && mentions.length > 0 ? (
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

  const barPositionStyle: React.CSSProperties | undefined =
    isWorkspaceDockedExpanded || isLightboxInlineChatExpanded
      ? undefined
      : position
        ? { left: `${position.left}px`, top: `${position.top}px`, userSelect: dragging ? 'none' : 'auto' }
        : isLightbox
          ? { visibility: 'hidden' as const }
          : undefined;

  const dockHostEl = expandedDockHostRef?.current ?? null;
  const dockTitle = isLightbox ? '大图 · 项目 Agent' : '项目 Agent';
  const useChatDock = Boolean(
    inputExpanded && (chatDockProps || isWorkspaceDockedExpanded || isLightboxInlineChatExpanded)
  );

  const barShell = (
      <div
        ref={barRef}
        data-workflow-quick-compose-bar
        data-ac-block-workflow-marquee
        data-workflow-quick-compose-docked={isWorkspaceDockedExpanded || isLightboxInlineChatExpanded ? '' : undefined}
        className={
          isWorkspaceDockedExpanded
            ? useChatDock
              ? 'pointer-events-auto flex h-full min-h-0 w-full flex-col'
              : `pointer-events-auto flex h-full min-h-0 w-full flex-col border-l border-white/[0.08] bg-[#0f0f12] px-3 py-3`
            : isLightboxInlineChatExpanded
              ? `pointer-events-auto fixed right-0 top-0 bottom-0 z-[2500] flex flex-col ${WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_CLASS}`
              : `pointer-events-auto fixed max-w-[96vw] px-2 w-[min(44rem,calc(100vw-1.5rem))] ${isLightbox ? 'z-[2500]' : 'z-[1600]'}`
        }
        style={barPositionStyle}
        onClick={isLightbox ? (e) => e.stopPropagation() : undefined}
        onWheel={isLightbox ? (e) => e.stopPropagation() : undefined}
        onPasteCapture={(e) => handlePasteAssetRefs(e, pasteRefZone)}
        {...(isLightbox ? ({ 'data-image-preview-no-wheel': '' } as const) : {})}
      >
        <div
          className={`relative min-w-0 ${
            isWorkspaceDockedExpanded || isLightboxInlineChatExpanded
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'overflow-visible'
          }`}
        >
          {!isWorkspaceDockedExpanded && !isLightboxInlineChatExpanded && hasDropZones ? (
            <div
              className="pointer-events-auto absolute bottom-full left-0 right-0 z-[1] mb-2 flex flex-col items-center gap-2 px-0.5"
              data-quick-compose-above
              onDragOver={
                isLightbox || showSplitDropZones ? undefined : handleMainZoneDragOver
              }
              onDrop={isLightbox ? undefined : showSplitDropZones ? handlePresetOnlyDrop : (e) => handleComposeInputDrop(e, 'main')}
            >
              {promptCards.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
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

              {showSplitDropZones ? (
                <div className={`grid gap-x-0 gap-y-1 px-0.5 py-1 ${splitDropZoneGridCols}`}>
                  {showMainDropColumn ? (
                    hasMainDropSlots ? (
                      <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">
                        主图（待修改）
                      </span>
                    ) : (
                      <div className="px-1.5" aria-hidden />
                    )
                  ) : null}
                  {showZoneDivider ? <div className="pointer-events-none" aria-hidden /> : null}
                  {showReferenceDropColumn ? (
                    <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">
                      {hideMainDropZone ? '参考图（当前图为主图）' : '参考图'}
                    </span>
                  ) : null}

                  {showMainDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="main"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('main')}
                    >
                      <QuickComposeDropTray
                        zone="main"
                        slots={mainDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveMainDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'main', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot ? (assetId) => onMoveDropSlot(assetId, 'reference') : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint="拖入主图"
                      />
                    </div>
                  ) : null}
                  {showZoneDivider ? (
                    <div
                      className="pointer-events-none mx-0.5 w-[2px] self-stretch justify-self-center rounded-full bg-white/35 shadow-[0_0_6px_rgba(255,255,255,0.12)]"
                      aria-hidden
                    />
                  ) : null}
                  {showReferenceDropColumn ? (
                    <div
                      data-quick-compose-drop-zone="reference"
                      className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5"
                      {...bindQuickComposeDropZone('reference')}
                    >
                      <QuickComposeDropTray
                        zone="reference"
                        slots={referenceDropSlots}
                        disabled={false}
                        onRemoveSlot={onRemoveReferenceDropSlot}
                        onReorderSlot={
                          onReorderDropSlot
                            ? (assetId, toIndex) => onReorderDropSlot(assetId, 'reference', toIndex)
                            : undefined
                        }
                        onMoveSlotToZone={
                          onMoveDropSlot && showMainDropColumn
                            ? (assetId) => onMoveDropSlot(assetId, 'main')
                            : undefined
                        }
                        onSlotClick={handleDropSlotClick}
                        onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()}
                        emptyHint={
                          hideMainDropZone ? '粘贴或 @ 引用其它资产' : '拖入参考图'
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {inputExpanded ? (
            useChatDock ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ProjectAgentDock
                    title={dockTitle}
                    onMinimize={collapseInputExpanded}
                    minimizeDisabled={chatDockProps?.minimizeDisabled}
                    className={chatDockProps?.className}
                    messages={chatDockProps?.messages ?? []}
                    onRetryMessage={chatDockProps?.onRetryMessage}
                    onMessageAction={chatDockProps?.onMessageAction}
                    onCancelMessage={chatDockProps?.onCancelMessage}
                    onResultPreview={chatDockProps?.onResultPreview}
                    selectionStatusLabel={chatDockProps?.selectionStatusLabel}
                    selectionStatusTone={chatDockProps?.selectionStatusTone}
                    onClearChat={chatDockProps?.onClearChat}
                    onLoadEarlier={chatDockProps?.onLoadEarlier}
                    canLoadEarlier={chatDockProps?.canLoadEarlier}
                    onExportChat={chatDockProps?.onExportChat}
                    expertStudio={chatDockProps?.expertStudio}
                    onTryRunPrompt={chatDockProps?.onTryRunPrompt}
                    skillEntries={chatDockProps?.skillEntries}
                    onToggleSkill={chatDockProps?.onToggleSkill}
                    onDeleteSkill={chatDockProps?.onDeleteSkill}
                    onInstallSampleSkill={chatDockProps?.onInstallSampleSkill}
                    onImportSkillPreview={chatDockProps?.onImportSkillPreview}
                    memoryEntries={chatDockProps?.memoryEntries}
                    onToggleMemory={chatDockProps?.onToggleMemory}
                    onDeleteMemory={chatDockProps?.onDeleteMemory}
                    threadEmptyTitle={chatDockProps?.threadEmptyTitle ?? '工作区 Agent'}
                    threadEmptyHint={
                      chatDockProps?.threadEmptyHint ??
                      '说说你想完成什么。Agent 会读取当前项目、资产和选择。'
                    }
                    segments={segments}
                    onSegmentsChange={onSegmentsChange}
                    mentionCandidates={mentionCandidates}
                    maxMentions={maxMentions}
                    placeholder={placeholder}
                    mainDropSlots={mainDropSlots}
                    referenceDropSlots={referenceDropSlots}
                    onRemoveMainDropSlot={onRemoveMainDropSlot}
                    onRemoveReferenceDropSlot={onRemoveReferenceDropSlot}
                    onMoveDropSlot={onMoveDropSlot}
                    onReorderDropSlot={onReorderDropSlot}
                    hideMainDropZone={hideMainDropZone}
                    onComposeInputDragOver={handleComposeInputDragOver}
                    onComposeInputDrop={handleComposeInputDrop}
                    onDropSlotClick={handleDropSlotClick}
                    promptCards={[]}
                    onRemovePromptCard={onRemovePromptCard}
                    inputDisabled={inputDisabled}
                    submitDisabled={submitDisabled}
                    submitDisabledReason={submitDisabledReason}
                    onSubmit={onSubmit}
                    composeMode={composeMode}
                    onComposeModeChange={onComposeModeChange}
                    modeLockedByInputPresets={inputPresetsActive}
                    genControls={genActionControls}
                  />
                </div>
              </div>
            ) : isWorkspaceDockedExpanded ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" role="search">
                  <div className="flex shrink-0 items-center justify-between gap-2 pr-1">
                    <span className="text-[10px] font-black uppercase tracking-wide text-gray-400">
                      {dockTitle}
                    </span>
                    <button
                      type="button"
                      onClick={collapseInputExpanded}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                      title="收起为底部输入条"
                      aria-label="收起输入区"
                      aria-pressed
                    >
                      <Minimize2 className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain no-scrollbar">
                    <div className="flex flex-col gap-3 pr-1">
                      {hasDropZones ? (
                        <div className="flex flex-col gap-2">
                          {promptCards.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {promptCards.map((c) => (
                                <div
                                  key={c.key}
                                  className={`group inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 px-2.5 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
                                  title={c.instruction.trim() ? c.instruction : c.label}
                                >
                                  <span className="min-w-0 truncate text-[13px] text-gray-100">{c.label}</span>
                                  <button
                                    type="button"
                                    onClick={() => onRemovePromptCard(c.key)}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
                                    aria-label={`移除 ${c.label}`}
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                                      <path d="M18 6 6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {showSplitDropZones ? (
                            <div className={`grid gap-x-0 gap-y-1 px-0.5 py-1 ${splitDropZoneGridCols}`}>
                              {showMainDropColumn ? (
                                hasMainDropSlots ? (
                                  <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">主图（待修改）</span>
                                ) : (
                                  <div className="px-1.5" aria-hidden />
                                )
                              ) : null}
                              {showZoneDivider ? <div className="pointer-events-none" aria-hidden /> : null}
                              {showReferenceDropColumn ? (
                                <span className="justify-self-center px-1.5 text-[9px] font-semibold text-gray-500">
                                  {hideMainDropZone ? '参考图（当前图为主图）' : '参考图'}
                                </span>
                              ) : null}
                              {showMainDropColumn ? (
                                <div data-quick-compose-drop-zone="main" className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5" {...bindQuickComposeDropZone('main')}>
                                  <QuickComposeDropTray zone="main" slots={mainDropSlots} disabled={false} onRemoveSlot={onRemoveMainDropSlot} onReorderSlot={onReorderDropSlot ? (assetId, toIndex) => onReorderDropSlot(assetId, 'main', toIndex) : undefined} onMoveSlotToZone={onMoveDropSlot ? (assetId) => onMoveDropSlot(assetId, 'reference') : undefined} onSlotClick={handleDropSlotClick} onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()} emptyHint="拖入主图" />
                                </div>
                              ) : null}
                              {showZoneDivider ? (
                                <div className="pointer-events-none mx-auto h-[2px] w-full max-w-[12rem] justify-self-center rounded-full bg-white/35 shadow-[0_0_6px_rgba(255,255,255,0.12)]" aria-hidden />
                              ) : null}
                              {showReferenceDropColumn ? (
                                <div data-quick-compose-drop-zone="reference" className="inline-flex w-fit max-w-full shrink-0 justify-self-center px-1.5" {...bindQuickComposeDropZone('reference')}>
                                  <QuickComposeDropTray zone="reference" slots={referenceDropSlots} disabled={false} onRemoveSlot={onRemoveReferenceDropSlot} onReorderSlot={onReorderDropSlot ? (assetId, toIndex) => onReorderDropSlot(assetId, 'reference', toIndex) : undefined} onMoveSlotToZone={onMoveDropSlot && showMainDropColumn ? (assetId) => onMoveDropSlot(assetId, 'main') : undefined} onSlotClick={handleDropSlotClick} onStashCaret={() => mentionFieldRef.current?.stashCaretBeforeBlur()} emptyHint={hideMainDropZone ? '粘贴或 @ 引用其它资产' : '拖入参考图'} />
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <QuickComposeMentionField
                        ref={mentionFieldRef}
                        segments={segments}
                        onSegmentsChange={onSegmentsChange}
                        mentionCandidates={mentionCandidates}
                        maxMentions={maxMentions}
                        placeholder={placeholder}
                        disabled={inputDisabled}
                        multiline
                        rows={10}
                        ariaLabel={isLightbox ? '大图预览快捷生成描述' : '快捷生成描述'}
                        onSubmit={onSubmit}
                        onDragOver={handleComposeInputDragOver}
                        onDrop={(e) => handleComposeInputDrop(e, 'main')}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 border-t border-white/[0.06] pt-3 pr-1">
                    <div className="flex flex-wrap items-center gap-2">{genActionControls}</div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={submitDisabled}
                        onClick={onSubmit}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
                        title={submitDisabledTitle ?? '加入队列并执行'}
                        aria-label={submitDisabledTitle ?? '加入队列并执行'}
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M5 12h14M13 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null
          ) : (
            <div
              className={`flex items-center gap-2 px-2 py-1.5 ${WORKFLOW_QUICK_COMPOSE_BAR_SHELL}`}
              role="search"
            >
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
                  title="输入 @ 可引用当前画面或其它资产"
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
                disabled={inputDisabled}
                ariaLabel={isLightbox ? '大图预览快捷生成描述' : '快捷生成描述'}
                onSubmit={onSubmit}
                onDragOver={handleComposeInputDragOver}
                onDrop={(e) => handleComposeInputDrop(e, 'main')}
              />

              <button
                type="button"
                onClick={() => {
                  const r = barRef.current?.getBoundingClientRect();
                  expandAnchorBottomRef.current = r != null && r.height > 0 ? r.bottom : null;
                  setSettingsOpen(false);
                  setInputExpanded(true);
                }}
                className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-gray-400 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500/50"
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
                  disabled={submitDisabled}
                  onClick={onSubmit}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0c] shadow-md outline-none transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-blue-500/55"
                  title={submitDisabledTitle ?? '加入队列并执行'}
                  aria-label={submitDisabledTitle ?? '加入队列并执行'}
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
  );

  return (
    <>
      {isWorkspaceDockedExpanded && dockHostEl && typeof document !== 'undefined'
        ? createPortal(barShell, dockHostEl)
        : barShell}
      {settingsPanel}
    </>
  );
}
