import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { StoryboardRoleAsset, StoryboardTableRow } from '../../types';
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
} from './storyboardTableUi';

export type StoryboardEditDisplayMode = 'full' | 'feedback';

const STORYBOARD_EDIT_DISPLAY_MODE_KEY = 'ac_storyboard_edit_display_mode_v1';

export type StoryboardTableEditViewHandle = {
  scrollToRow: (rowId: string, behavior?: ScrollBehavior) => void;
};

type Props = {
  rows: StoryboardTableRow[];
  roleAssets?: StoryboardRoleAsset[];
  activeRowId: string | null;
  imageBusyRowId: string | null;
  redrawBusyRowId: string | null;
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
  parseBusyRowId: string | null;
  parseAllBusy?: boolean;
  optimizeBusyRowId?: string | null;
  interaction: StoryboardRowInteractionValue;
  onActiveRowIdChange: (rowId: string) => void;
  onPatchRows?: (rowIds: string[], patch: Partial<StoryboardTableRow>) => void;
  onRemoveRows?: (rowIds: string[]) => boolean;
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
  readOnly?: boolean;
  redrawRowDisabledReason: (row: StoryboardTableRow) => string | undefined;
  footerAddRow?: React.ReactNode;
  editScrollRef?: React.Ref<StoryboardTableEditViewHandle>;
};

export default function StoryboardTableEditView({
  rows,
  roleAssets = [],
  activeRowId,
  imageBusyRowId,
  redrawBusyRowId,
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
  parseBusyRowId,
  parseAllBusy = false,
  optimizeBusyRowId = null,
  interaction,
  onActiveRowIdChange,
  onPatchRows,
  onRemoveRows,
  onAddFrameRoleMark,
  onUpdateFrameRoleMark,
  onRemoveFrameRoleMark,
  onRebindFrameRoleMark,
  onSetFrameRoleMarkCustomName,
  roleReplaceEligibleCount = 0,
  roleReplaceBatchBusy = false,
  roleReplaceBatchProgress = null,
  onRoleReplaceBatch,
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
  const collageLimitOptions = useMemo(
    () =>
      STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS.map((n) => ({
        value: String(n),
        label: `${n} 镜/张`,
      })),
    []
  );
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
    (rowId: string) => {
      onActiveRowIdChange(rowId);
      setCanvasSelectedRowIds(new Set([rowId]));
      selectionAnchorRef.current = rowId;
      setSelectedFrameRoleMarkId(null);
    },
    [onActiveRowIdChange]
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

  const handleOutlineSelectWithScroll = useCallback(
    (rowId: string) => {
      handleOutlineSelect(rowId);
      scrollToRow(rowId, 'smooth');
    },
    [handleOutlineSelect, scrollToRow]
  );

  useImperativeHandle(editScrollRef, () => ({ scrollToRow }), [scrollToRow]);

  useEffect(() => {
    if (!activeRowId || !rows.some((row) => row.id === activeRowId)) {
      if (rows[0]) onActiveRowIdChange(rows[0].id);
    }
  }, [activeRowId, onActiveRowIdChange, rows]);

  const redrawReason = activeRow ? redrawRowDisabledReason(activeRow) : undefined;
  const redrawDisabled =
    !activeRow ||
    Boolean(redrawReason) ||
    redrawBusyRowId != null ||
    feedbackBatchBusy ||
    roleReplaceBatchBusy;

  return (
    <StoryboardRowInteractionProvider value={interaction}>
      <div className={`${STORYBOARD_GRID_ROOT} ${STORYBOARD_PAD_PANEL} overflow-x-auto pt-1`}>
        <StoryboardTableOutlineSidebar
          rows={rows}
          fieldCatalog={interaction.fieldCatalog}
          activeRowId={activeRowId}
          onSelect={handleOutlineSelectWithScroll}
          virtualList={outlineVirtual}
          filterMatchedRowIds={filterMatchedRowIds}
          filterPill={canvasFilterPill}
          outlineFlashRowId={outlineFlashRowId}
        />

        <div className={STORYBOARD_EDIT_VIEW_LAYOUT}>
          <div className={`${STORYBOARD_SIDE_RAIL} flex min-h-0 min-w-0 flex-col`}>
            <div className="mb-1 shrink-0 space-y-1 px-0.5">
              <StoryboardFeedbackRedrawHistoryBar
                records={feedbackRedrawHistory}
                selectedId={selectedFeedbackHistoryId}
                onSelect={(id) => onSelectFeedbackHistory?.(id)}
                busy={feedbackBatchBusy}
              />
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>
                画板
                {feedbackWrittenCount > 0 ? (
                  <span className="ml-1.5 font-normal text-sky-300/85">
                    · 已反馈 {feedbackWrittenCount}
                  </span>
                ) : null}
              </p>
              <StoryboardEditCanvasFilterBar
                activePill={canvasFilterPill}
                counts={filterCountsForBar}
                total={rows.length}
                matchCount={filterMatchCount}
                onChange={handleCanvasFilterChange}
              />
              {canvasFilterPill !== 'all' && filterMatchCount === 0 ? (
                <p className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[9px] leading-snug text-gray-500">
                  {storyboardEditCanvasFilterEmptyHint(canvasFilterPill)}
                </p>
              ) : null}
              <StoryboardCanvasSelectionBar
                count={canvasSelectedRowIds.size}
                readOnly={readOnly || interaction.readOnly}
                onLock={() => batchLock(true)}
                onUnlock={() => batchLock(false)}
                onApplyFeedback={batchApplyFeedback}
                onRemove={batchRemove}
              />
              {onFeedbackBatchRedraw || onRoleReplaceBatch ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <CustomDropdown
                    value={String(feedbackCollageLimit)}
                    options={collageLimitOptions}
                    disabled={roleReplaceBatchBusy || feedbackBatchBusy}
                    onChange={(value) => onFeedbackCollageLimitChange?.(Number(value))}
                    triggerClassName="!h-7 !min-w-[5.5rem] !px-2 !text-[10px]"
                    triggerAriaLabel="每批拼图镜头上限"
                  />
                  <label
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-gray-500"
                    title="开启：拼图提示先经理解 LLM；关闭：直发拼图改图/替换提示"
                  >
                    <input
                      type="checkbox"
                      checked={feedbackRedrawUnderstand}
                      onChange={() => onToggleFeedbackRedrawUnderstand?.()}
                      disabled={roleReplaceBatchBusy || feedbackBatchBusy}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-white/80"
                    />
                    理解
                  </label>
                  {onFeedbackBatchRedraw ? (
                    <button
                      type="button"
                      title={`拼图改图：每 ${feedbackCollageLimit} 镜拼一张，按修改反馈改图并切分回填${feedbackBatchTitleSuffix}`}
                      disabled={
                        feedbackBatchBusy ||
                        roleReplaceBatchBusy ||
                        feedbackRedrawEligibleCount <= 0 ||
                        redrawBusyRowId != null
                      }
                      onClick={onFeedbackBatchRedraw}
                      className={`${STORYBOARD_TOOL_BTN_PRIMARY} shrink-0 !px-2.5 ${
                        feedbackBatchBusy ? 'opacity-80' : ''
                      }`}
                    >
                      {feedbackBatchBusy && feedbackBatchProgress
                        ? `拼图改图 ${feedbackBatchProgress.done}/${feedbackBatchProgress.total}`
                        : `拼图改图${feedbackRedrawEligibleCount > 0 ? ` (${feedbackRedrawEligibleCount})` : ''}`}
                    </button>
                  ) : null}
                  {onRoleReplaceBatch ? (
                    <button
                      type="button"
                      title={`拼图替换：每 ${feedbackCollageLimit} 镜拼一张，用解析页角色参考图替换标注位置并切分回填${roleReplaceBatchTitleSuffix}`}
                      disabled={
                        roleReplaceBatchBusy ||
                        feedbackBatchBusy ||
                        roleReplaceEligibleCount <= 0 ||
                        redrawBusyRowId != null
                      }
                      onClick={onRoleReplaceBatch}
                      className={`${STORYBOARD_TOOL_BTN_PRIMARY} shrink-0 !px-2.5 ${
                        roleReplaceBatchBusy ? 'opacity-80' : ''
                      }`}
                    >
                      {roleReplaceBatchBusy && roleReplaceBatchProgress
                        ? `拼图替换 ${roleReplaceBatchProgress.done}/${roleReplaceBatchProgress.total}`
                        : `拼图替换角色${roleReplaceEligibleCount > 0 ? ` (${roleReplaceEligibleCount})` : ''}`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div ref={canvasScrollRef} className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pr-0.5`}>
              <StoryboardEditCanvasGrid
                rows={rows}
                activeRowId={activeRowId}
                selectedRowIds={canvasSelectedRowIds}
                imageBusyRowId={imageBusyRowId}
                highlightedRowIds={highlightedRowIds}
                previewRowImages={previewRowImages}
                roleAssets={roleAssets}
                selectedFrameRoleMarkId={selectedFrameRoleMarkId}
                readOnly={readOnly || interaction.readOnly}
                onSelectRow={handleCanvasSelectRow}
                onMarqueeSelect={handleMarqueeSelect}
                onPreviewImage={interaction.previewImage}
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
                      feedbackBatchBusy || roleReplaceBatchBusy || redrawBusyRowId != null
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
            <div className={`${STORYBOARD_BODY_SCROLL} pr-0.5`}>
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
                  fieldCatalog={interaction.fieldCatalog}
                  active
                  imageBusy={imageBusyRowId === activeRow.id}
                  redrawBusy={redrawBusyRowId === activeRow.id}
                  parseBusy={parseBusyRowId === activeRow.id || parseAllBusy}
                  optimizeBusy={optimizeBusyRowId === activeRow.id}
                  redrawDisabled={redrawDisabled}
                  redrawDisabledReason={redrawReason}
                  editDisplayMode={editDisplayMode}
                />
                </>
              ) : (
                <p className="px-1 py-6 text-center text-[10px] text-gray-600">暂无镜头</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </StoryboardRowInteractionProvider>
  );
}
