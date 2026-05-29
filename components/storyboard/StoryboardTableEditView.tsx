import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef, StoryboardTableRow } from '../../types';
import {
  STORYBOARD_EDIT_ROW_ESTIMATE_PX,
  STORYBOARD_EDIT_ROW_GAP_PX,
  STORYBOARD_COMPOSITE_RAIL_ESTIMATE_PX,
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
  buildStoryboardBandOffsets,
  buildStoryboardRowOffsets,
  storyboardActiveRowIndexFromGridBands,
  storyboardEditGridColumnsForWidth,
  storyboardGridBandCount,
  storyboardScrollOffsetForIndex,
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
  STORYBOARD_GAP_STACK,
  STORYBOARD_GRID_EDITOR_PREVIEW,
  STORYBOARD_GRID_ROOT,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_SIDE_RAIL,
} from './storyboardTableUi';

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
  const catalogRemeasureKey = useMemo(
    () => fieldCatalogSignature(interaction.fieldCatalog),
    [interaction.fieldCatalog]
  );
  const editorVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_EDIT_ROW_ESTIMATE_PX,
    gap: STORYBOARD_EDIT_ROW_GAP_PX,
    remeasureKey: catalogRemeasureKey,
  });
  const compositeVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_COMPOSITE_RAIL_ESTIMATE_PX,
    gap: STORYBOARD_EDIT_ROW_GAP_PX,
    remeasureKey: catalogRemeasureKey,
  });
  const outlineVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
    gap: 1,
    overscan: 8,
  });

  const compositeScrollRef = compositeVirtual.scrollRef;
  const editorGridRef = useRef<HTMLDivElement>(null);
  const [editorColumns, setEditorColumns] = useState(1);
  const scrollActiveTimerRef = useRef(0);
  /** 大纲/程序定位后短暂忽略滚动反推 activeRow，避免 smooth 滚动期间乱跳 */
  const explicitSelectLockRef = useRef(0);

  const lockActiveFromScroll = useCallback((ms = 200) => {
    explicitSelectLockRef.current = performance.now() + ms;
  }, []);

  const shouldIgnoreActiveFromScroll = useCallback(() => {
    return performance.now() < explicitSelectLockRef.current;
  }, []);

  const compositeOffsets = useMemo(
    () =>
      buildStoryboardRowOffsets(
        rowIds,
        compositeVirtual.heights,
        STORYBOARD_COMPOSITE_RAIL_ESTIMATE_PX,
        STORYBOARD_EDIT_ROW_GAP_PX
      ).offsets,
    [compositeVirtual.heights, rowIds]
  );

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
      compositeVirtual.scrollToIndex(index, behavior);
    },
    [
      compositeVirtual,
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

  useEffect(() => {
    if (!activeRowId) return;
    const index = rows.findIndex((r) => r.id === activeRowId);
    if (index < 0) return;
    compositeVirtual.scrollToIndex(index, 'auto');
  }, [activeRowId, compositeVirtual, rows]);

  const renderEditorRow = (row: StoryboardTableRow, index: number) => {
    const redrawReason = redrawRowDisabledReason(row);
    const redrawDisabled = Boolean(redrawReason) || redrawBusyRowId != null;
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

  const renderCompositeRow = (row: StoryboardTableRow, index: number) => {
    const inner = (
      <StoryboardConnectedCompositeCard
        row={row}
        index={index}
        fieldCatalog={interaction.fieldCatalog}
        active={activeRowId === row.id}
        onSelect={() => onActiveRowIdChange(row.id)}
        onPreviewImage={interaction.previewImage}
      />
    );

    if (!compositeVirtual.virtualize) {
      return <React.Fragment key={row.id}>{inner}</React.Fragment>;
    }

    const top = storyboardScrollOffsetForIndex(index, compositeOffsets);

    return (
      <StoryboardRowMeasureWrap
        key={row.id}
        rowId={row.id}
        measureRow={compositeVirtual.measureRow}
        className="absolute left-0 right-0"
        style={{ top }}
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

  const visibleCompositeRows = useMemo(() => {
    const { startIndex, endIndex } = compositeVirtual.range;
    return rows.slice(startIndex, endIndex).map((row, i) => ({
      row,
      index: startIndex + i,
    }));
  }, [compositeVirtual.range, rows]);

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

  const compositeList = compositeVirtual.virtualize ? (
    <div className="relative w-full" style={{ height: compositeVirtual.range.totalHeight }}>
      {visibleCompositeRows.map(({ row, index }) => renderCompositeRow(row, index))}
    </div>
  ) : (
    <div className={`flex flex-col ${STORYBOARD_GAP_STACK}`}>
      {rows.map((row, i) => renderCompositeRow(row, i))}
    </div>
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
            <p className={STORYBOARD_COLUMN_HEAD}>镜头编辑</p>
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
            <div
              ref={compositeScrollRef}
              onScroll={() => compositeVirtual.handleScroll()}
              className={`${STORYBOARD_BODY_SCROLL} flex flex-col pr-0.5`}
            >
              {compositeList}
            </div>
          </aside>
        </div>
      </div>
    </StoryboardRowInteractionProvider>
  );
}
