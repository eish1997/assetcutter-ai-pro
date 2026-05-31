import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  STORYBOARD_EDIT_ROW_ESTIMATE_PX,
  STORYBOARD_EDIT_ROW_GAP_PX,
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
  buildStoryboardBandOffsets,
  storyboardActiveRowIndexFromGridBands,
  storyboardEditGridColumnsForWidth,
  storyboardGridBandCount,
} from '../../services/storyboardVirtualScroll';
import { useStoryboardVirtualList } from '../../hooks/useStoryboardVirtualList';
import StoryboardConnectedRowEditor from './StoryboardConnectedRowEditor';
import StoryboardConnectedCompositeCard from './StoryboardConnectedCompositeCard';
import { StoryboardRowInteractionProvider } from './StoryboardRowInteractionContext';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import StoryboardTableOutlineSidebar from './StoryboardTableOutlineSidebar';
import { StoryboardRowMeasureWrap } from './StoryboardRowMeasureWrap';
import { storyboardRowDomId } from './storyboardTableDom';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_COMPOSITE_RAIL_W,
  STORYBOARD_EDIT_GRID,
  STORYBOARD_GRID_EDITOR_PREVIEW,
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

function fieldCatalogSignature(catalog: StoryboardParseFieldDef[]): string {
  return catalog.map((f) => `${f.id}:${f.label}:${f.order}`).join('|');
}

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  imageBusyRowId: string | null;
  redrawBusyRowId: string | null;
  feedbackBatchBusy?: boolean;
  feedbackBatchProgress?: { done: number; total: number } | null;
  feedbackRedrawEligibleCount?: number;
  onFeedbackBatchRedraw?: () => void;
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
  onFeedbackBatchRedraw,
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
  const [editDisplayMode, setEditDisplayMode] = useState<StoryboardEditDisplayMode>(() =>
    readLocalJson(STORYBOARD_EDIT_DISPLAY_MODE_KEY, 'full', (v) =>
      v === 'full' || v === 'feedback' ? v : null
    )
  );
  const catalogRemeasureKey = useMemo(
    () => `${fieldCatalogSignature(interaction.fieldCatalog)}|${editDisplayMode}`,
    [interaction.fieldCatalog, editDisplayMode]
  );
  const editorVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_EDIT_ROW_ESTIMATE_PX,
    gap: STORYBOARD_EDIT_ROW_GAP_PX,
    remeasureKey: catalogRemeasureKey,
  });
  const outlineVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
    gap: 1,
    overscan: 8,
  });

  const editorGridRef = useRef<HTMLDivElement>(null);
  const [editorColumns, setEditorColumns] = useState(1);
  const scrollActiveTimerRef = useRef(0);
  /** 大纲/程序定位后短暂忽略滚动反推 activeRow，避免 smooth 滚动期间乱跳 */
  const explicitSelectLockRef = useRef(0);

  const toggleEditDisplayMode = useCallback(() => {
    setEditDisplayMode((prev) => {
      const next: StoryboardEditDisplayMode = prev === 'full' ? 'feedback' : 'full';
      writeLocalJson(STORYBOARD_EDIT_DISPLAY_MODE_KEY, next);
      return next;
    });
  }, []);

  const lockActiveFromScroll = useCallback((ms = 200) => {
    explicitSelectLockRef.current = performance.now() + ms;
  }, []);

  const shouldIgnoreActiveFromScroll = useCallback(() => {
    return performance.now() < explicitSelectLockRef.current;
  }, []);

  const readEditorGridColumns = useCallback(() => {
    const grid = editorGridRef.current;
    if (grid) setEditorColumns(storyboardEditGridColumnsForWidth(grid.clientWidth));
  }, []);

  useLayoutEffect(() => {
    readEditorGridColumns();
    const grid = editorGridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => readEditorGridColumns());
    ro.observe(grid);
    return () => ro.disconnect();
  }, [readEditorGridColumns, rowIds.length]);

  const editorBandLayout = useMemo(
    () =>
      buildStoryboardBandOffsets(
        rowIds,
        editorVirtual.heights,
        editorColumns,
        STORYBOARD_EDIT_ROW_ESTIMATE_PX,
        STORYBOARD_EDIT_ROW_GAP_PX
      ),
    [editorColumns, editorVirtual.heights, rowIds]
  );

  const editorBandCount = storyboardGridBandCount(rows.length, editorColumns);

  const editorBandWindow = useMemo(() => {
    if (!editorVirtual.virtualize) {
      return { startBand: 0, endBand: editorBandCount, paddingTop: 0, paddingBottom: 0 };
    }
    const bandHeight =
      editorBandCount > 0
        ? editorBandLayout.totalHeight / editorBandCount
        : STORYBOARD_EDIT_ROW_ESTIMATE_PX + STORYBOARD_EDIT_ROW_GAP_PX;
    const overscan = 2;
    const startBand = Math.max(
      0,
      Math.floor(editorVirtual.scrollTop / bandHeight) - overscan
    );
    const endBand = Math.min(
      editorBandCount,
      Math.ceil((editorVirtual.scrollTop + editorVirtual.viewportHeight) / bandHeight) + overscan
    );
    return {
      startBand,
      endBand,
      paddingTop: startBand * bandHeight,
      paddingBottom: Math.max(0, editorBandLayout.totalHeight - endBand * bandHeight),
    };
  }, [
    editorBandCount,
    editorBandLayout.totalHeight,
    editorVirtual.scrollTop,
    editorVirtual.viewportHeight,
    editorVirtual.virtualize,
  ]);

  const scrollToRow = useCallback(
    (rowId: string, behavior: ScrollBehavior = 'auto') => {
      const index = rows.findIndex((r) => r.id === rowId);
      if (index < 0) return;
      lockActiveFromScroll(behavior === 'smooth' ? 700 : 220);
      const band = Math.floor(index / Math.max(editorColumns, 1));
      const editorEl = editorVirtual.scrollRef.current;
      if (editorEl) {
        const top = editorBandLayout.bandOffsets[band] ?? 0;
        editorEl.scrollTo({ top: Math.max(0, top - 8), behavior });
        if (behavior === 'auto') editorVirtual.handleScroll();
      }
      outlineVirtual.scrollToIndex(index, behavior);
    },
    [
      editorBandLayout.bandOffsets,
      editorColumns,
      editorVirtual,
      lockActiveFromScroll,
      outlineVirtual,
      rows,
    ]
  );

  useImperativeHandle(editScrollRef, () => ({ scrollToRow }), [scrollToRow]);

  const scheduleActiveFromScroll = useCallback(() => {
    if (shouldIgnoreActiveFromScroll()) return;
    window.clearTimeout(scrollActiveTimerRef.current);
    scrollActiveTimerRef.current = window.setTimeout(() => {
      if (shouldIgnoreActiveFromScroll()) return;
      const idx = storyboardActiveRowIndexFromGridBands(
        editorVirtual.scrollTop,
        editorVirtual.viewportHeight,
        rows.length,
        editorColumns,
        editorBandLayout.bandOffsets,
        rowIds,
        editorVirtual.heights,
        STORYBOARD_EDIT_ROW_ESTIMATE_PX,
        STORYBOARD_EDIT_ROW_GAP_PX
      );
      const row = rows[idx];
      if (row && row.id !== activeRowId) onActiveRowIdChange(row.id);
    }, 80);
  }, [
    activeRowId,
    editorBandLayout.bandOffsets,
    editorColumns,
    editorVirtual.heights,
    editorVirtual.scrollTop,
    editorVirtual.viewportHeight,
    onActiveRowIdChange,
    rowIds,
    rows,
    shouldIgnoreActiveFromScroll,
  ]);

  useEffect(() => {
    return () => window.clearTimeout(scrollActiveTimerRef.current);
  }, []);

  const onEditorScroll = useCallback(() => {
    editorVirtual.handleScroll();
    scheduleActiveFromScroll();
  }, [editorVirtual, scheduleActiveFromScroll]);

  const activeCompositeRow = useMemo(() => {
    if (!rows.length) return null;
    if (activeRowId) {
      const matched = rows.find((row) => row.id === activeRowId);
      if (matched) return { row: matched, index: matched.index };
    }
    const first = rows[0]!;
    return { row: first, index: first.index };
  }, [activeRowId, rows]);

  const renderEditorRow = (row: StoryboardTableRow, index: number) => {
    const redrawReason = redrawRowDisabledReason(row);
    const redrawDisabled =
      Boolean(redrawReason) || redrawBusyRowId != null || feedbackBatchBusy;
    const inner = (
      <StoryboardConnectedRowEditor
        domId={storyboardRowDomId(row.id)}
        row={row}
        index={index}
        fieldCatalog={interaction.fieldCatalog}
        active={activeRowId === row.id}
        imageBusy={imageBusyRowId === row.id}
        redrawBusy={redrawBusyRowId === row.id}
        parseBusy={parseBusyRowId === row.id || parseAllBusy}
        optimizeBusy={optimizeBusyRowId === row.id}
        redrawDisabled={redrawDisabled}
        redrawDisabledReason={redrawReason}
        editDisplayMode={editDisplayMode}
      />
    );

    if (!editorVirtual.virtualize) {
      return (
        <StoryboardRowMeasureWrap
          key={row.id}
          rowId={row.id}
          measureRow={editorVirtual.measureRow}
        >
          {inner}
        </StoryboardRowMeasureWrap>
      );
    }

    return (
      <StoryboardRowMeasureWrap
        key={row.id}
        rowId={row.id}
        measureRow={editorVirtual.measureRow}
      >
        {inner}
      </StoryboardRowMeasureWrap>
    );
  };

  const visibleEditorRows = useMemo(() => {
    if (!editorVirtual.virtualize) return rows.map((row, i) => ({ row, index: i }));
    const start = editorBandWindow.startBand * editorColumns;
    const end = Math.min(rows.length, editorBandWindow.endBand * editorColumns);
    return rows.slice(start, end).map((row, i) => ({ row, index: start + i }));
  }, [
    editorBandWindow.endBand,
    editorBandWindow.startBand,
    editorColumns,
    editorVirtual.virtualize,
    rows,
  ]);

  const editorList = (
    <div
      ref={editorGridRef}
      className={STORYBOARD_EDIT_GRID}
      style={
        editorVirtual.virtualize
          ? {
              paddingTop: editorBandWindow.paddingTop,
              paddingBottom: editorBandWindow.paddingBottom,
            }
          : undefined
      }
    >
      {visibleEditorRows.map(({ row, index }) => renderEditorRow(row, index))}
    </div>
  );

  const editorScrollBody = editorVirtual.virtualize ? (
    <div className="relative w-full" style={{ height: editorBandLayout.totalHeight }}>
      <div className="absolute inset-x-0 top-0">{editorList}</div>
    </div>
  ) : (
    editorList
  );

  const compositePanel = activeCompositeRow ? (
    <StoryboardConnectedCompositeCard
      key={activeCompositeRow.row.id}
      row={activeCompositeRow.row}
      index={activeCompositeRow.index}
      fieldCatalog={interaction.fieldCatalog}
      active
      onSelect={() => onActiveRowIdChange(activeCompositeRow.row.id)}
      onPreviewImage={interaction.previewImage}
    />
  ) : (
    <p className="px-1 py-6 text-center text-[10px] text-gray-600">暂无镜头</p>
  );

  return (
    <StoryboardRowInteractionProvider value={interaction}>
      <div className={`${STORYBOARD_GRID_ROOT} ${STORYBOARD_PAD_PANEL} overflow-x-auto pt-1`}>
        <StoryboardTableOutlineSidebar
          rows={rows}
          fieldCatalog={interaction.fieldCatalog}
          activeRowId={activeRowId}
          onSelect={(rowId) => {
            lockActiveFromScroll(280);
            onActiveRowIdChange(rowId);
            scrollToRow(rowId, 'auto');
          }}
          virtualList={outlineVirtual}
        />

        <div className={`${STORYBOARD_GRID_EDITOR_PREVIEW} h-full`}>
          <div className={`${STORYBOARD_SIDE_RAIL} min-w-0`}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <p className={`${STORYBOARD_COLUMN_HEAD} !mb-0`}>镜头编辑</p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {editDisplayMode === 'feedback' && onFeedbackBatchRedraw ? (
                  <button
                    type="button"
                    title="按各镜「修改反馈」批量重绘（跳过锁定镜）"
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
                      ? `反馈重绘 ${feedbackBatchProgress.done}/${feedbackBatchProgress.total}`
                      : `反馈重绘${feedbackRedrawEligibleCount > 0 ? ` (${feedbackRedrawEligibleCount})` : ''}`}
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
                      ? 'bg-violet-500/15 text-violet-200 ring-violet-400/30'
                      : ''
                  }`}
                >
                  {editDisplayMode === 'full' ? '反馈模式' : '完整编辑'}
                </button>
              </div>
            </div>
            <div
              ref={editorVirtual.scrollRef}
              onScroll={onEditorScroll}
              className={`${STORYBOARD_BODY_SCROLL} pr-0.5`}
            >
              {editorScrollBody}
              {footerAddRow ? (
                <div className={editorVirtual.virtualize ? 'mt-2' : ''}>{footerAddRow}</div>
              ) : null}
            </div>
          </div>

          <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_COMPOSITE_RAIL_W} shrink-0`}>
            <div className="shrink-0 px-0.5">
              <p className={STORYBOARD_COLUMN_HEAD}>分镜合成</p>
            </div>
            <div className={`${STORYBOARD_BODY_SCROLL} flex flex-col pr-0.5`}>{compositePanel}</div>
          </aside>
        </div>
      </div>
    </StoryboardRowInteractionProvider>
  );
}
