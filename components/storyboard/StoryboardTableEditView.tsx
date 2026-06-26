import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../../types';
import type { StoryboardGeneratedAssetItem } from '../../services/storyboardGeneratedAssets';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  STORYBOARD_EDIT_CANVAS_FILTER_KEY,
  computeStoryboardEditCanvasFilterState,
  parseStoryboardEditCanvasFilterPill,
  storyboardEditCanvasFilterEmptyHint,
  type StoryboardEditCanvasFilterCounts,
  type StoryboardEditCanvasFilterPill,
} from '../../services/storyboardEditCanvasFilter';
import {
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
} from '../../services/storyboardVirtualScroll';
import {
  isStoryboardFeedbackCollageLimitPreset,
  normalizeFeedbackCollageLimit,
  STORYBOARD_FEEDBACK_COLLAGE_LIMIT_CUSTOM_OPTION,
  STORYBOARD_FEEDBACK_COLLAGE_LIMIT_MAX,
} from '../../services/storyboardFeedbackSheetRedraw';
import { rowHasSheetGenPrompt } from '../../services/storyboardTableSheetGen';
import { useStoryboardVirtualList } from '../../hooks/useStoryboardVirtualList';
import StoryboardConnectedRowEditor from './StoryboardConnectedRowEditor';
import StoryboardEditCanvasGrid, {
  type StoryboardCanvasSelectModifiers,
} from './StoryboardEditCanvasGrid';
import StoryboardCanvasSelectionBar from './StoryboardCanvasSelectionBar';
import StoryboardFeedbackRedrawHistoryBar from './StoryboardFeedbackRedrawHistoryBar';
import { storyboardRowHasEditFeedback, storyboardRowIsPassed } from './storyboardRowDisplay';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { StoryboardFeedbackRedrawBatchRecord } from '../../services/storyboardFeedbackSheetRedraw';
import { STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS } from '../../services/storyboardFeedbackSheetRedraw';
import { StoryboardRowInteractionProvider } from './StoryboardRowInteractionContext';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import StoryboardTableOutlineSidebar from './StoryboardTableOutlineSidebar';
import StoryboardFrameRoleMarkPanel from './StoryboardFrameRoleMarkPanel';
import StoryboardEditCanvasFilterBar from './StoryboardEditCanvasFilterBar';
import { storyboardCanvasTileDomId, storyboardRowDomId } from './storyboardTableDom';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_EDIT_EDITOR_RAIL_W,
  STORYBOARD_EDIT_VIEW_LAYOUT,
  STORYBOARD_GRID_ROOT,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_SIDE_RAIL,
  STORYBOARD_TOOL_BTN_NEUTRAL,
  STORYBOARD_TOOL_BTN_PRIMARY,
  STORYBOARD_VIEW_TOGGLE,
  STORYBOARD_EDIT_DROPDOWN_Z,
  storyboardCollageProcessingStatusTone,
  type StoryboardCollageProcessingKind,
} from './storyboardTableUi';

export type StoryboardEditDisplayMode = 'full' | 'feedback';

const STORYBOARD_EDIT_DISPLAY_MODE_KEY = 'ac_storyboard_edit_display_mode_v1';

export type StoryboardTableEditViewHandle = {
  scrollToRow: (rowId: string, behavior?: ScrollBehavior) => void;
};

type Props = {
  assetId: string;
  rows: StoryboardTableRow[];
  generatedImageAssets?: StoryboardGeneratedAssetItem[];
  onPreviewGeneratedImage?: (src: string) => void;
  onGenHistoryPanelVisible?: () => void;
  onGeneratedImageHistoryLoadError?: () => void;
  roleAssets?: StoryboardRoleAsset[];
  activeRowId: string | null;
  imageBusyRowId: string | null;
  redrawBusyRowId: string | null;
  collageProcessing?: {
    kind: StoryboardCollageProcessingKind;
    rowIds: string[];
    queuedRowIds?: string[];
  } | null;
  feedbackBatchBusy?: boolean;
  feedbackBatchProgress?: { done: number; total: number } | null;
  feedbackRedrawEligibleCount?: number;
  feedbackRedrawUnderstand?: boolean;
  onToggleFeedbackRedrawUnderstand?: () => void;
  onFeedbackBatchRedraw?: () => void;
  onClearAllFeedback?: () => void;
  feedbackCollageLimit?: number;
  onFeedbackCollageLimitChange?: (limit: number) => void;
  feedbackRedrawHistory?: StoryboardFeedbackRedrawBatchRecord[];
  selectedFeedbackHistoryId?: string | null;
  onSelectFeedbackHistory?: (id: string | null) => void;
  interaction: StoryboardRowInteractionValue;
  onActiveRowIdChange: (rowId: string) => void;
  onPatchRows?: (rowIds: string[], patch: Partial<StoryboardTableRow>) => void;
  onRemoveRows?: (rowIds: string[]) => boolean;
  onReorderRows?: (fromIndex: number, toIndex: number) => void;
  onInsertShotBefore?: (rowIndex: number) => void;
  onInsertShotAfter?: (rowIndex: number) => void;
  onAddFrameRoleMark?: (
    rowId: string,
    mark: { name: string; x: number; y: number; roleAssetId?: string }
  ) => void;
  onUpdateFrameRoleMark?: (
    rowId: string,
    markId: string,
    patch: { x?: number; y?: number }
  ) => void;
  onRemoveFrameRoleMark?: (rowId: string, markId: string) => void;
  onRebindFrameRoleMark?: (
    rowId: string,
    markId: string,
    asset: StoryboardRoleAsset
  ) => void;
  onSetFrameRoleMarkCustomName?: (rowId: string, markId: string, name: string) => void;
  roleReplaceEligibleCount?: number;
  roleReplaceBatchBusy?: boolean;
  roleReplaceBatchProgress?: { done: number; total: number } | null;
  onRoleReplaceBatch?: () => void;
  selectedSheetGenBatchBusy?: boolean;
  selectedSheetGenBatchProgress?: { done: number; total: number } | null;
  onSelectedSheetGen?: (rowIds: string[]) => void;
  readOnly?: boolean;
  redrawRowDisabledReason: (row: StoryboardTableRow) => string | undefined;
  footerAddRow?: React.ReactNode;
  editScrollRef?: React.Ref<StoryboardTableEditViewHandle>;
};

export default function StoryboardTableEditView({
  assetId,
  rows,
  generatedImageAssets = [],
  onPreviewGeneratedImage,
  onGenHistoryPanelVisible,
  onGeneratedImageHistoryLoadError,
  roleAssets = [],
  activeRowId,
  imageBusyRowId,
  redrawBusyRowId,
  collageProcessing = null,
  feedbackBatchBusy = false,
  feedbackBatchProgress = null,
  feedbackRedrawEligibleCount = 0,
  feedbackRedrawUnderstand = true,
  onToggleFeedbackRedrawUnderstand,
  onFeedbackBatchRedraw,
  onClearAllFeedback,
  feedbackCollageLimit = 9,
  onFeedbackCollageLimitChange,
  feedbackRedrawHistory = [],
  selectedFeedbackHistoryId = null,
  onSelectFeedbackHistory,
  interaction,
  onActiveRowIdChange,
  onPatchRows,
  onRemoveRows,
  onReorderRows,
  onInsertShotBefore,
  onInsertShotAfter,
  onAddFrameRoleMark,
  onUpdateFrameRoleMark,
  onRemoveFrameRoleMark,
  onRebindFrameRoleMark,
  onSetFrameRoleMarkCustomName,
  roleReplaceEligibleCount = 0,
  roleReplaceBatchBusy = false,
  roleReplaceBatchProgress = null,
  onRoleReplaceBatch,
  selectedSheetGenBatchBusy = false,
  selectedSheetGenBatchProgress = null,
  onSelectedSheetGen,
  readOnly = false,
  redrawRowDisabledReason,
  footerAddRow,
  editScrollRef,
}: Props) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const feedbackWrittenCount = useMemo(
    () => rows.filter((row) => storyboardRowHasEditFeedback(row)).length,
    [rows]
  );
  const highlightedRowIds = useMemo(() => {
    if (!selectedFeedbackHistoryId) return null;
    const record = feedbackRedrawHistory.find((item) => item.id === selectedFeedbackHistoryId);
    if (!record) return null;
    return new Set(record.rowIds);
  }, [feedbackRedrawHistory, selectedFeedbackHistoryId]);
  const previewRowImages = useMemo(() => {
    if (!selectedFeedbackHistoryId) return null;
    const record = feedbackRedrawHistory.find((item) => item.id === selectedFeedbackHistoryId);
    if (!record?.rowImages) return null;
    const hasPreview = record.rowIds.some((rowId) => record.rowImages?.[rowId]);
    return hasPreview ? record.rowImages : null;
  }, [feedbackRedrawHistory, selectedFeedbackHistoryId]);
  const normalizedCollageLimit = normalizeFeedbackCollageLimit(feedbackCollageLimit);
  const [forceCustomCollageLimit, setForceCustomCollageLimit] = useState(
    () => !isStoryboardFeedbackCollageLimitPreset(normalizedCollageLimit)
  );
  const [customCollageLimitDraft, setCustomCollageLimitDraft] = useState(() =>
    String(normalizedCollageLimit)
  );
  const showCustomCollageLimitInput =
    forceCustomCollageLimit || !isStoryboardFeedbackCollageLimitPreset(normalizedCollageLimit);
  const collageLimitOptions = useMemo(
    () => [
      ...STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS.map((n) => ({
        value: String(n),
        label: `${n} 镜/张`,
      })),
      { value: STORYBOARD_FEEDBACK_COLLAGE_LIMIT_CUSTOM_OPTION, label: '自定义' },
    ],
    []
  );
  const collageLimitTriggerClassName =
    '!h-[1.625rem] !min-w-[5rem] !rounded-md !border-0 !bg-transparent !px-2 !text-[10px] !shadow-none !ring-0 hover:!bg-white/[0.06]';

  useEffect(() => {
    const next = normalizeFeedbackCollageLimit(feedbackCollageLimit);
    setCustomCollageLimitDraft(String(next));
    if (isStoryboardFeedbackCollageLimitPreset(next)) {
      setForceCustomCollageLimit(false);
    }
  }, [feedbackCollageLimit]);

  const commitCustomCollageLimit = useCallback(() => {
    const next = normalizeFeedbackCollageLimit(customCollageLimitDraft);
    setCustomCollageLimitDraft(String(next));
    onFeedbackCollageLimitChange?.(next);
    if (isStoryboardFeedbackCollageLimitPreset(next)) {
      setForceCustomCollageLimit(false);
    }
  }, [customCollageLimitDraft, onFeedbackCollageLimitChange]);
  const [editDisplayMode, setEditDisplayMode] = useState<StoryboardEditDisplayMode>(() =>
    readLocalJson(STORYBOARD_EDIT_DISPLAY_MODE_KEY, 'full', (v) =>
      v === 'full' || v === 'feedback' ? v : null
    )
  );
  const [canvasFilterPill, setCanvasFilterPill] = useState<StoryboardEditCanvasFilterPill>(() =>
    readLocalJson(STORYBOARD_EDIT_CANVAS_FILTER_KEY, 'all', parseStoryboardEditCanvasFilterPill)
  );
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<string | null>(activeRowId);
  const outlineFlashTimerRef = useRef<number | null>(null);
  const [outlineFlashRowId, setOutlineFlashRowId] = useState<string | null>(null);
  const [canvasSelectedRowIds, setCanvasSelectedRowIds] = useState<Set<string>>(() =>
    activeRowId ? new Set([activeRowId]) : new Set()
  );
  const [selectedFrameRoleMarkId, setSelectedFrameRoleMarkId] = useState<string | null>(null);

  const filterState = useMemo(
    () => computeStoryboardEditCanvasFilterState(rows, canvasFilterPill, roleAssets),
    [canvasFilterPill, roleAssets, rows]
  );
  const filterMatchedRowIds = filterState.matchedRowIds;
  const filterMatchCount = filterMatchedRowIds?.size ?? rows.length;
  const roleReplaceEligibleRowIds = filterState.roleReplaceEligibleRowIds;
  const filterCountsForBar = useMemo((): StoryboardEditCanvasFilterCounts => {
    return {
      ...filterState.counts,
      feedback: feedbackWrittenCount,
      feedbackRedraw: feedbackRedrawEligibleCount,
      roleReplace: roleReplaceEligibleCount,
    };
  }, [
    feedbackRedrawEligibleCount,
    feedbackWrittenCount,
    filterState.counts,
    roleReplaceEligibleCount,
  ]);

  const handleCanvasFilterChange = useCallback((pill: StoryboardEditCanvasFilterPill) => {
    setCanvasFilterPill(pill);
    writeLocalJson(STORYBOARD_EDIT_CANVAS_FILTER_KEY, pill);
  }, []);

  const flashOutlineRow = useCallback((rowId: string) => {
    if (outlineFlashTimerRef.current != null) {
      window.clearTimeout(outlineFlashTimerRef.current);
    }
    setOutlineFlashRowId(rowId);
    outlineFlashTimerRef.current = window.setTimeout(() => {
      setOutlineFlashRowId(null);
      outlineFlashTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(
    () => () => {
      if (outlineFlashTimerRef.current != null) {
        window.clearTimeout(outlineFlashTimerRef.current);
      }
    },
    []
  );

  const feedbackBatchTitleSuffix =
    canvasFilterPill !== 'all' &&
    filterMatchCount !== feedbackRedrawEligibleCount &&
    feedbackRedrawEligibleCount > 0
      ? `（当前筛选 ${filterMatchCount} 镜，全表 ${feedbackRedrawEligibleCount} 镜可改图）`
      : '';
  const roleReplaceBatchTitleSuffix =
    canvasFilterPill !== 'all' &&
    filterMatchCount !== roleReplaceEligibleCount &&
    roleReplaceEligibleCount > 0
      ? `（当前筛选 ${filterMatchCount} 镜，全表 ${roleReplaceEligibleCount} 镜可换角色）`
      : '';

  useEffect(() => {
    if (!activeRowId) return;
    setCanvasSelectedRowIds((prev) => {
      if (prev.size === 0 || (prev.size === 1 && prev.has(activeRowId))) {
        return new Set([activeRowId]);
      }
      return prev;
    });
    selectionAnchorRef.current = activeRowId;
  }, [activeRowId]);

  useEffect(() => {
    if (!activeRowId) {
      setSelectedFrameRoleMarkId(null);
      return;
    }
    if (!selectedFrameRoleMarkId) return;
    const row = rows.find((item) => item.id === activeRowId);
    if (!row?.frameRoleMarks?.some((mark) => mark.id === selectedFrameRoleMarkId)) {
      setSelectedFrameRoleMarkId(null);
    }
  }, [activeRowId, rows, selectedFrameRoleMarkId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!activeRowId || !selectedFrameRoleMarkId || !onRemoveFrameRoleMark) return;
      const row = rows.find((item) => item.id === activeRowId);
      if (!row || storyboardRowIsPassed(row)) return;
      event.preventDefault();
      onRemoveFrameRoleMark(activeRowId, selectedFrameRoleMarkId);
      setSelectedFrameRoleMarkId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRowId, onRemoveFrameRoleMark, rows, selectedFrameRoleMarkId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || canvasSelectedRowIds.size <= 1) return;
      if (activeRowId) {
        setCanvasSelectedRowIds(new Set([activeRowId]));
      } else {
        setCanvasSelectedRowIds(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRowId, canvasSelectedRowIds.size]);

  const handleOutlineSelect = useCallback(
    (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => {
      onActiveRowIdChange(rowId);

      if (modifiers?.range && selectionAnchorRef.current) {
        const anchorIndex = rows.findIndex((row) => row.id === selectionAnchorRef.current);
        const targetIndex = rows.findIndex((row) => row.id === rowId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const lo = Math.min(anchorIndex, targetIndex);
          const hi = Math.max(anchorIndex, targetIndex);
          const rangeIds = rows.slice(lo, hi + 1).map((row) => row.id);
          setCanvasSelectedRowIds((prev) => {
            if (modifiers.additive) {
              const next = new Set(prev);
              for (const id of rangeIds) next.add(id);
              return next;
            }
            return new Set(rangeIds);
          });
          selectionAnchorRef.current = rowId;
          setSelectedFrameRoleMarkId(null);
          return;
        }
      }

      if (modifiers?.additive) {
        setCanvasSelectedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        });
      } else {
        setCanvasSelectedRowIds(new Set([rowId]));
        setSelectedFrameRoleMarkId(null);
      }
      selectionAnchorRef.current = rowId;
    },
    [onActiveRowIdChange, rows]
  );

  const handleCanvasSelectRow = useCallback(
    (rowId: string, modifiers?: StoryboardCanvasSelectModifiers) => {
      onActiveRowIdChange(rowId);

      if (modifiers?.range && selectionAnchorRef.current) {
        const anchorIndex = rows.findIndex((row) => row.id === selectionAnchorRef.current);
        const targetIndex = rows.findIndex((row) => row.id === rowId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const lo = Math.min(anchorIndex, targetIndex);
          const hi = Math.max(anchorIndex, targetIndex);
          const rangeIds = rows.slice(lo, hi + 1).map((row) => row.id);
          setCanvasSelectedRowIds((prev) => {
            if (modifiers.additive) {
              const next = new Set(prev);
              for (const id of rangeIds) next.add(id);
              return next;
            }
            return new Set(rangeIds);
          });
          return;
        }
      }

      if (modifiers?.additive) {
        setCanvasSelectedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        });
      } else {
        setCanvasSelectedRowIds(new Set([rowId]));
        setSelectedFrameRoleMarkId(null);
      }
      selectionAnchorRef.current = rowId;
    },
    [onActiveRowIdChange, rows]
  );

  const handleMarqueeSelect = useCallback(
    (rowIds: string[], additive: boolean) => {
      if (!rowIds.length) return;
      const lastId = rowIds[rowIds.length - 1]!;
      onActiveRowIdChange(lastId);
      setCanvasSelectedRowIds((prev) => {
        if (additive) {
          const next = new Set(prev);
          for (const id of rowIds) next.add(id);
          return next;
        }
        return new Set(rowIds);
      });
      selectionAnchorRef.current = lastId;
    },
    [onActiveRowIdChange]
  );

  const selectedRowIdList = useMemo(
    () => [...canvasSelectedRowIds],
    [canvasSelectedRowIds]
  );

  const selectedSheetGenEligibleCount = useMemo(() => {
    if (!canvasSelectedRowIds.size) return 0;
    return rows.filter(
      (row) =>
        canvasSelectedRowIds.has(row.id) &&
        !row.locked &&
        rowHasSheetGenPrompt(row, interaction.fieldCatalog)
    ).length;
  }, [canvasSelectedRowIds, interaction.fieldCatalog, rows]);

  const collageBatchBusy =
    feedbackBatchBusy || roleReplaceBatchBusy || selectedSheetGenBatchBusy;

  const canvasInteraction = useMemo(() => {
    if (readOnly || interaction.readOnly) return interaction;
    return {
      ...interaction,
      assignFrameImageFromDrop: (rowId: string, e: React.DragEvent) => {
        const selectedRowIds = canvasSelectedRowIds.has(rowId)
          ? rows.filter((row) => canvasSelectedRowIds.has(row.id)).map((row) => row.id)
          : undefined;
        interaction.assignFrameImageFromDrop(rowId, e, selectedRowIds);
      },
    };
  }, [canvasSelectedRowIds, interaction, readOnly, rows]);

  const batchLock = useCallback(
    (locked: boolean) => {
      if (!selectedRowIdList.length || !onPatchRows) return;
      onPatchRows(selectedRowIdList, { locked });
    },
    [onPatchRows, selectedRowIdList]
  );

  const batchApplyFeedback = useCallback(
    (text: string) => {
      if (!selectedRowIdList.length || !onPatchRows) return;
      const editableIds = selectedRowIdList.filter((id) => {
        const row = rows.find((r) => r.id === id);
        return row && !storyboardRowIsPassed(row);
      });
      if (!editableIds.length) return;
      onPatchRows(editableIds, { editFeedback: text });
    },
    [onPatchRows, rows, selectedRowIdList]
  );

  const batchRemove = useCallback(() => {
    if (!selectedRowIdList.length || !onRemoveRows) return;
    if (onRemoveRows(selectedRowIdList)) {
      setCanvasSelectedRowIds(new Set());
      selectionAnchorRef.current = null;
    }
  }, [onRemoveRows, selectedRowIdList]);

  const outlineVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
    gap: 1,
    overscan: 8,
  });

  const toggleEditDisplayMode = useCallback(() => {
    setEditDisplayMode((prev) => {
      const next: StoryboardEditDisplayMode = prev === 'full' ? 'feedback' : 'full';
      writeLocalJson(STORYBOARD_EDIT_DISPLAY_MODE_KEY, next);
      return next;
    });
  }, []);

  const activeRow = useMemo(() => {
    if (!rows.length) return null;
    if (activeRowId) {
      const matched = rows.find((row) => row.id === activeRowId);
      if (matched) return matched;
    }
    return rows[0] ?? null;
  }, [activeRowId, rows]);

  const activeRowIndex = activeRow?.index ?? 0;

  const scrollToRow = useCallback(
    (rowId: string, behavior: ScrollBehavior = 'auto') => {
      const index = rows.findIndex((r) => r.id === rowId);
      if (index < 0) return;
      outlineVirtual.scrollToIndex(index, behavior);
      document.getElementById(storyboardCanvasTileDomId(rowId))?.scrollIntoView({
        block: 'nearest',
        behavior,
      });
      if (filterMatchedRowIds && !filterMatchedRowIds.has(rowId)) {
        flashOutlineRow(rowId);
      }
    },
    [filterMatchedRowIds, flashOutlineRow, outlineVirtual, rows]
  );

  useImperativeHandle(editScrollRef, () => ({ scrollToRow }), [scrollToRow]);

  useEffect(() => {
    if (!activeRowId || !rows.some((row) => row.id === activeRowId)) {
      if (rows[0]) onActiveRowIdChange(rows[0].id);
    }
  }, [activeRowId, onActiveRowIdChange, rows]);

  const collageProcessingRowIds = useMemo(
    () => new Set(collageProcessing?.rowIds ?? []),
    [collageProcessing]
  );
  const collageProcessingQueuedRowIds = useMemo(
    () => new Set(collageProcessing?.queuedRowIds ?? []),
    [collageProcessing]
  );
  const collageProcessingKind = collageProcessing?.kind ?? null;

  const canvasStatLabel =
    canvasFilterPill === 'all'
      ? `共 ${rows.length} 镜`
      : `命中 ${filterMatchCount} / ${rows.length} 镜`;

  const showCanvasBatchTools = Boolean(
    onFeedbackBatchRedraw || onRoleReplaceBatch || onSelectedSheetGen
  );

  const redrawReason = activeRow ? redrawRowDisabledReason(activeRow) : undefined;
  const redrawDisabled =
    !activeRow ||
    Boolean(redrawReason) ||
    redrawBusyRowId != null ||
    feedbackBatchBusy ||
    roleReplaceBatchBusy ||
    selectedSheetGenBatchBusy;

  return (
    <StoryboardRowInteractionProvider value={canvasInteraction}>
      <div className={`${STORYBOARD_GRID_ROOT} ${STORYBOARD_PAD_PANEL} overflow-x-auto pt-1`}>
        <StoryboardTableOutlineSidebar
          assetId={assetId}
          rows={rows}
          generatedImageAssets={generatedImageAssets}
          onPreviewGeneratedImage={onPreviewGeneratedImage}
          onGenHistoryPanelVisible={onGenHistoryPanelVisible}
          onGeneratedImageHistoryLoadError={onGeneratedImageHistoryLoadError}
          fieldCatalog={interaction.fieldCatalog}
          activeRowId={activeRowId}
          selectedRowIds={canvasSelectedRowIds}
          readOnly={readOnly || interaction.readOnly}
          onSelect={handleOutlineSelect}
          onReorder={onReorderRows}
          onInsertShotBefore={onInsertShotBefore}
          onInsertShotAfter={onInsertShotAfter}
          virtualList={outlineVirtual}
          filterMatchedRowIds={filterMatchedRowIds}
          filterPill={canvasFilterPill}
          outlineFlashRowId={outlineFlashRowId}
          collageProcessingRowIds={collageProcessingRowIds}
          collageProcessingQueuedRowIds={collageProcessingQueuedRowIds}
          collageProcessingKind={collageProcessingKind}
        />

        <div className={STORYBOARD_EDIT_VIEW_LAYOUT}>
          <div className={`${STORYBOARD_SIDE_RAIL} flex min-h-0 min-w-0 flex-col`}>
            <div className="mb-2 shrink-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>画板</p>
                  {feedbackWrittenCount > 0 ? (
                    <span className="shrink-0 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[9px] tabular-nums text-sky-200/90 ring-1 ring-sky-400/20">
                      已反馈 {feedbackWrittenCount}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-[9px] tabular-nums text-gray-500">{canvasStatLabel}</span>
              </div>

              <div className="mt-2">
                <StoryboardEditCanvasFilterBar
                  activePill={canvasFilterPill}
                  counts={filterCountsForBar}
                  total={rows.length}
                  matchCount={filterMatchCount}
                  onChange={handleCanvasFilterChange}
                  hideStat
                />
              </div>

              {collageProcessingKind && collageProcessingRowIds.size > 0 ? (
                <p
                  className={`mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[9px] leading-snug ${storyboardCollageProcessingStatusTone(collageProcessingKind)}`}
                >
                  {collageProcessingKind === 'feedback'
                    ? '拼图改图'
                    : collageProcessingKind === 'roleReplace'
                      ? '角色替换'
                      : '分镜生图'}
                  进行中 · 正在修改 {collageProcessingRowIds.size} 镜
                  {feedbackBatchProgress && collageProcessingKind === 'feedback'
                    ? `（${feedbackBatchProgress.done}/${feedbackBatchProgress.total} 批）`
                    : null}
                  {roleReplaceBatchProgress && collageProcessingKind === 'roleReplace'
                    ? `（${roleReplaceBatchProgress.done}/${roleReplaceBatchProgress.total} 批）`
                    : null}
                  {selectedSheetGenBatchProgress && collageProcessingKind === 'sheetGen'
                    ? `（${selectedSheetGenBatchProgress.done}/${selectedSheetGenBatchProgress.total} 批）`
                    : null}
                </p>
              ) : null}

              {collageProcessingKind && collageProcessingQueuedRowIds.size > 0 ? (
                <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[9px] leading-snug text-gray-400">
                  等待中 · {collageProcessingQueuedRowIds.size} 镜排队
                </p>
              ) : null}

              {canvasFilterPill !== 'all' && filterMatchCount === 0 ? (
                <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[9px] leading-snug text-gray-500">
                  {storyboardEditCanvasFilterEmptyHint(canvasFilterPill)}
                </p>
              ) : null}

              <div className="mt-2 space-y-2">
                <StoryboardCanvasSelectionBar
                  count={canvasSelectedRowIds.size}
                  readOnly={readOnly || interaction.readOnly}
                  onLock={() => batchLock(true)}
                  onUnlock={() => batchLock(false)}
                  onApplyFeedback={batchApplyFeedback}
                  onRemove={batchRemove}
                />
                {showCanvasBatchTools ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                      <div className={`${STORYBOARD_VIEW_TOGGLE} shrink-0`}>
                        {showCustomCollageLimitInput ? (
                          <input
                            type="number"
                            min={1}
                            max={STORYBOARD_FEEDBACK_COLLAGE_LIMIT_MAX}
                            value={customCollageLimitDraft}
                            autoFocus={forceCustomCollageLimit}
                            disabled={collageBatchBusy}
                            onChange={(event) => setCustomCollageLimitDraft(event.target.value)}
                            onBlur={commitCustomCollageLimit}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitCustomCollageLimit();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                const restored = normalizeFeedbackCollageLimit(feedbackCollageLimit);
                                setCustomCollageLimitDraft(String(restored));
                                setForceCustomCollageLimit(
                                  !isStoryboardFeedbackCollageLimitPreset(restored)
                                );
                              }
                            }}
                            className={`${collageLimitTriggerClassName} w-[5rem] bg-transparent text-gray-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                            aria-label={`自定义每批拼图镜头数，最多 ${STORYBOARD_FEEDBACK_COLLAGE_LIMIT_MAX} 镜`}
                          />
                        ) : (
                          <CustomDropdown
                            value={String(normalizedCollageLimit)}
                            options={collageLimitOptions}
                            disabled={collageBatchBusy}
                            onChange={(value) => {
                              if (value === STORYBOARD_FEEDBACK_COLLAGE_LIMIT_CUSTOM_OPTION) {
                                setForceCustomCollageLimit(true);
                                return;
                              }
                              setForceCustomCollageLimit(false);
                              onFeedbackCollageLimitChange?.(Number(value));
                            }}
                            triggerClassName={collageLimitTriggerClassName}
                            triggerAriaLabel="每批拼图镜头上限"
                            portalZIndex={STORYBOARD_EDIT_DROPDOWN_Z}
                            listMinWidth={96}
                          />
                        )}
                        <label
                          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 border-l border-white/[0.08] px-2 text-[10px] ${
                            feedbackRedrawUnderstand ? 'text-gray-200' : 'text-gray-500'
                          }`}
                          title="开启：拼图提示先经理解 LLM；关闭：直发拼图改图/拼图替换提示"
                        >
                          <input
                            type="checkbox"
                            checked={feedbackRedrawUnderstand}
                            onChange={() => onToggleFeedbackRedrawUnderstand?.()}
                            disabled={collageBatchBusy}
                            className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-white/80"
                          />
                          理解
                        </label>
                      </div>
                      {onFeedbackBatchRedraw ? (
                        <button
                          type="button"
                          title={`拼图改图：每 ${feedbackCollageLimit} 镜拼一张，按修改反馈改图并切分回填${feedbackBatchTitleSuffix}`}
                          disabled={
                            collageBatchBusy ||
                            feedbackRedrawEligibleCount <= 0 ||
                            redrawBusyRowId != null
                          }
                          onClick={onFeedbackBatchRedraw}
                          className={`${STORYBOARD_TOOL_BTN_PRIMARY} shrink-0 !h-7 !px-2.5 ${
                            feedbackBatchBusy ? 'opacity-80' : ''
                          }`}
                        >
                          {feedbackBatchBusy && feedbackBatchProgress
                            ? `改图中 ${feedbackBatchProgress.done}/${feedbackBatchProgress.total}`
                            : `拼图改图${feedbackRedrawEligibleCount > 0 ? ` (${feedbackRedrawEligibleCount})` : ''}`}
                        </button>
                      ) : null}
                      {onRoleReplaceBatch ? (
                        <button
                          type="button"
                          title={`拼图替换：每 ${feedbackCollageLimit} 镜拼一张，参考图 1=拼图 2+=角色资产，改完后切分回填${roleReplaceBatchTitleSuffix}`}
                          disabled={
                            collageBatchBusy ||
                            roleReplaceEligibleCount <= 0 ||
                            redrawBusyRowId != null
                          }
                          onClick={onRoleReplaceBatch}
                          className={`${STORYBOARD_TOOL_BTN_PRIMARY} shrink-0 !h-7 !px-2.5 ${
                            roleReplaceBatchBusy ? 'opacity-80' : ''
                          }`}
                        >
                          {roleReplaceBatchBusy && roleReplaceBatchProgress
                            ? `替换中 ${roleReplaceBatchProgress.done}/${roleReplaceBatchProgress.total}`
                            : `替换角色${roleReplaceEligibleCount > 0 ? ` (${roleReplaceEligibleCount})` : ''}`}
                        </button>
                      ) : null}
                      {onSelectedSheetGen ? (
                        <button
                          type="button"
                          title={`生成分镜图：按所选镜头原文拼图文生图，每 ${feedbackCollageLimit} 镜一批，生成后切分回填`}
                          disabled={
                            collageBatchBusy ||
                            canvasSelectedRowIds.size <= 0 ||
                            selectedSheetGenEligibleCount <= 0 ||
                            redrawBusyRowId != null
                          }
                          onClick={() => onSelectedSheetGen(selectedRowIdList)}
                          className={`${STORYBOARD_TOOL_BTN_PRIMARY} shrink-0 !h-7 !px-2.5 ${
                            selectedSheetGenBatchBusy ? 'opacity-80' : ''
                          }`}
                        >
                          {selectedSheetGenBatchBusy && selectedSheetGenBatchProgress
                            ? `生图中 ${selectedSheetGenBatchProgress.done}/${selectedSheetGenBatchProgress.total}`
                            : `生成分镜图${
                                selectedSheetGenEligibleCount > 0
                                  ? ` (${selectedSheetGenEligibleCount})`
                                  : ''
                              }`}
                        </button>
                      ) : null}
                    </div>
                ) : null}
              </div>
            </div>
            <div ref={canvasScrollRef} className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pr-0.5`}>
              <StoryboardEditCanvasGrid
                rows={rows}
                activeRowId={activeRowId}
                selectedRowIds={canvasSelectedRowIds}
                imageBusyRowId={imageBusyRowId}
                collageProcessingRowIds={collageProcessingRowIds}
                collageProcessingQueuedRowIds={collageProcessingQueuedRowIds}
                collageProcessingKind={collageProcessingKind}
                highlightedRowIds={highlightedRowIds}
                previewRowImages={previewRowImages}
                roleAssets={roleAssets}
                selectedFrameRoleMarkId={selectedFrameRoleMarkId}
                readOnly={readOnly || interaction.readOnly}
                onSelectRow={handleCanvasSelectRow}
                onMarqueeSelect={handleMarqueeSelect}
                onPreviewRowFrame={interaction.previewRowFrame}
                onSelectFrameRoleMark={(_, markId) => setSelectedFrameRoleMarkId(markId)}
                onAddFrameRoleMark={onAddFrameRoleMark}
                onUpdateFrameRoleMark={onUpdateFrameRoleMark}
                onRemoveFrameRoleMark={(rowId, markId) => {
                  onRemoveFrameRoleMark?.(rowId, markId);
                  if (selectedFrameRoleMarkId === markId) {
                    setSelectedFrameRoleMarkId(null);
                  }
                }}
                onRebindFrameRoleMark={onRebindFrameRoleMark}
                onSetFrameRoleMarkCustomName={onSetFrameRoleMarkCustomName}
                filterMatchedRowIds={filterMatchedRowIds}
                filterFlashRowId={outlineFlashRowId}
                roleReplaceEligibleRowIds={roleReplaceEligibleRowIds}
                onAssignImagesFromDrop={
                  readOnly || canvasInteraction.readOnly
                    ? undefined
                    : canvasInteraction.assignFrameImageFromDrop
                }
              />
              {footerAddRow ? <div className="mt-2">{footerAddRow}</div> : null}
            </div>
          </div>

          <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_EDIT_EDITOR_RAIL_W} shrink-0`}>
            <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2 px-0.5">
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>镜头编辑</p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {onClearAllFeedback && feedbackWrittenCount > 0 ? (
                  <button
                    type="button"
                    title="清除全表所有镜头的修改反馈"
                    disabled={
                      collageBatchBusy || redrawBusyRowId != null
                    }
                    onClick={onClearAllFeedback}
                    className={`${STORYBOARD_TOOL_BTN_NEUTRAL} shrink-0 !px-2.5`}
                  >
                    清除全部反馈
                  </button>
                ) : null}
                <button
                  type="button"
                  title={
                    editDisplayMode === 'full'
                      ? '切换到反馈模式：隐藏文本字段，仅保留修改反馈输入'
                      : '切换到完整编辑：显示全部文本字段'
                  }
                  aria-pressed={editDisplayMode === 'feedback'}
                  onClick={toggleEditDisplayMode}
                  className={`${STORYBOARD_TOOL_BTN_NEUTRAL} shrink-0 !px-2 ${
                    editDisplayMode === 'feedback'
                      ? 'bg-white/[0.08] text-gray-200 ring-white/15'
                      : ''
                  }`}
                >
                  {editDisplayMode === 'full' ? '反馈模式' : '完整编辑'}
                </button>
              </div>
            </div>
            <div className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pr-0.5`}>
              {activeRow ? (
                <>
                  <StoryboardFrameRoleMarkPanel
                    row={activeRow}
                    roleAssets={roleAssets}
                    selectedMarkId={selectedFrameRoleMarkId}
                    readOnly={readOnly || interaction.readOnly}
                    onSelectMark={setSelectedFrameRoleMarkId}
                    onAddMark={(mark) => onAddFrameRoleMark?.(activeRow.id, mark)}
                    onRemoveMark={(markId) => {
                      onRemoveFrameRoleMark?.(activeRow.id, markId);
                      if (selectedFrameRoleMarkId === markId) {
                        setSelectedFrameRoleMarkId(null);
                      }
                    }}
                    onFocusMark={(markId) => {
                      setSelectedFrameRoleMarkId(markId);
                      scrollToRow(activeRow.id, 'smooth');
                      requestAnimationFrame(() => {
                        document
                          .querySelector(`[data-storyboard-role-mark="${markId}"]`)
                          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                      });
                    }}
                  />
                  <StoryboardConnectedRowEditor
                  domId={storyboardRowDomId(activeRow.id)}
                  row={activeRow}
                  index={activeRowIndex}
                  active
                  imageBusy={imageBusyRowId === activeRow.id}
                  redrawBusy={redrawBusyRowId === activeRow.id}
                  redrawDisabled={redrawDisabled}
                  redrawDisabledReason={redrawReason}
                  editDisplayMode={editDisplayMode}
                />
                </>
              ) : (
                <p className="px-1 py-6 text-center text-[10px] text-gray-600">暂无镜头</p>
              )}
            </div>
            <div className="mt-2 shrink-0 border-t border-white/[0.06] pt-2">
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-1`}>反馈改图记录</p>
              <StoryboardFeedbackRedrawHistoryBar
                records={feedbackRedrawHistory}
                selectedId={selectedFeedbackHistoryId}
                onSelect={(id) => onSelectFeedbackHistory?.(id)}
                busy={feedbackBatchBusy}
              />
            </div>
          </aside>
        </div>
      </div>
    </StoryboardRowInteractionProvider>
  );
}
