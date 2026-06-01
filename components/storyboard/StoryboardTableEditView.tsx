import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { StoryboardTableRow } from '../../types';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
} from '../../services/storyboardVirtualScroll';
import { useStoryboardVirtualList } from '../../hooks/useStoryboardVirtualList';
import StoryboardConnectedRowEditor from './StoryboardConnectedRowEditor';
import StoryboardEditCanvasGrid from './StoryboardEditCanvasGrid';
import StoryboardFeedbackRedrawHistoryBar from './StoryboardFeedbackRedrawHistoryBar';
import { storyboardRowHasEditFeedback } from './storyboardRowDisplay';
import { CustomDropdown } from '../ui/CustomDropdown';
import type { StoryboardFeedbackRedrawBatchRecord } from '../../services/storyboardFeedbackSheetRedraw';
import { STORYBOARD_FEEDBACK_COLLAGE_LIMIT_OPTIONS } from '../../services/storyboardFeedbackSheetRedraw';
import { StoryboardRowInteractionProvider } from './StoryboardRowInteractionContext';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import StoryboardTableOutlineSidebar from './StoryboardTableOutlineSidebar';
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
  activeRowId: string | null;
  imageBusyRowId: string | null;
  redrawBusyRowId: string | null;
  feedbackBatchBusy?: boolean;
  feedbackBatchProgress?: { done: number; total: number } | null;
  feedbackRedrawEligibleCount?: number;
  feedbackRedrawUnderstand?: boolean;
  onToggleFeedbackRedrawUnderstand?: () => void;
  onFeedbackBatchRedraw?: () => void;
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
  redrawRowDisabledReason: (row: StoryboardTableRow) => string | undefined;
  footerAddRow?: React.ReactNode;
  editScrollRef?: React.Ref<StoryboardTableEditViewHandle>;
};

export default function StoryboardTableEditView({
  rows,
  activeRowId,
  imageBusyRowId,
  redrawBusyRowId,
  feedbackBatchBusy = false,
  feedbackBatchProgress = null,
  feedbackRedrawEligibleCount = 0,
  feedbackRedrawUnderstand = true,
  onToggleFeedbackRedrawUnderstand,
  onFeedbackBatchRedraw,
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
  const canvasScrollRef = useRef<HTMLDivElement>(null);

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
    },
    [outlineVirtual, rows]
  );

  useImperativeHandle(editScrollRef, () => ({ scrollToRow }), [scrollToRow]);

  useEffect(() => {
    if (!activeRowId || !rows.some((row) => row.id === activeRowId)) {
      if (rows[0]) onActiveRowIdChange(rows[0].id);
    }
  }, [activeRowId, onActiveRowIdChange, rows]);

  const selectRow = useCallback(
    (rowId: string, behavior: ScrollBehavior = 'auto') => {
      onActiveRowIdChange(rowId);
      scrollToRow(rowId, behavior);
    },
    [onActiveRowIdChange, scrollToRow]
  );

  const redrawReason = activeRow ? redrawRowDisabledReason(activeRow) : undefined;
  const redrawDisabled =
    !activeRow || Boolean(redrawReason) || redrawBusyRowId != null || feedbackBatchBusy;

  return (
    <StoryboardRowInteractionProvider value={interaction}>
      <div className={`${STORYBOARD_GRID_ROOT} ${STORYBOARD_PAD_PANEL} overflow-x-auto pt-1`}>
        <StoryboardTableOutlineSidebar
          rows={rows}
          fieldCatalog={interaction.fieldCatalog}
          activeRowId={activeRowId}
          onSelect={(rowId) => selectRow(rowId, 'auto')}
          virtualList={outlineVirtual}
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
            </div>
            <div ref={canvasScrollRef} className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pr-0.5`}>
              <StoryboardEditCanvasGrid
                rows={rows}
                activeRowId={activeRowId}
                imageBusyRowId={imageBusyRowId}
                highlightedRowIds={highlightedRowIds}
                previewRowImages={previewRowImages}
                onSelect={(rowId) => selectRow(rowId, 'auto')}
                onPreviewImage={interaction.previewImage}
              />
              {footerAddRow ? <div className="mt-2">{footerAddRow}</div> : null}
            </div>
          </div>

          <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_EDIT_EDITOR_RAIL_W} shrink-0`}>
            <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2 px-0.5">
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>镜头编辑</p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {editDisplayMode === 'feedback' && onFeedbackBatchRedraw ? (
                  <>
                    <CustomDropdown
                      value={String(feedbackCollageLimit)}
                      options={collageLimitOptions}
                      disabled={feedbackBatchBusy}
                      onChange={(value) => onFeedbackCollageLimitChange?.(Number(value))}
                      triggerClassName="!h-7 !min-w-[5.5rem] !px-2 !text-[10px]"
                      triggerAriaLabel="每批拼图镜头上限"
                    />
                    <label
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-gray-500"
                      title="开启：拼图 + 反馈先经理解 LLM；关闭：直发拼图改图提示"
                    >
                      <input
                        type="checkbox"
                        checked={feedbackRedrawUnderstand}
                        onChange={() => onToggleFeedbackRedrawUnderstand?.()}
                        disabled={feedbackBatchBusy}
                        className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-violet-500"
                      />
                      理解
                    </label>
                    <button
                      type="button"
                      title={`拼图改图：每 ${feedbackCollageLimit} 镜拼一张，改完再切分回填`}
                      disabled={
                        feedbackBatchBusy ||
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
                  </>
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
                      ? 'bg-violet-500/15 text-violet-200 ring-violet-400/30'
                      : ''
                  }`}
                >
                  {editDisplayMode === 'full' ? '反馈模式' : '完整编辑'}
                </button>
              </div>
            </div>
            <div className={`${STORYBOARD_BODY_SCROLL} pr-0.5`}>
              {activeRow ? (
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
