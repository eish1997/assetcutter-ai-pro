import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  STORYBOARD_EDIT_ROW_ESTIMATE_PX,
  STORYBOARD_EDIT_ROW_GAP_PX,
  STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
  buildStoryboardRowOffsets,
  storyboardScrollOffsetForIndex,
} from '../../services/storyboardVirtualScroll';
import { useStoryboardVirtualList } from '../../hooks/useStoryboardVirtualList';
import StoryboardConnectedRowEditor from './StoryboardConnectedRowEditor';
import StoryboardConnectedCompositeCard from './StoryboardConnectedCompositeCard';
import { StoryboardRowInteractionProvider } from './StoryboardRowInteractionContext';
import type { StoryboardRowInteractionValue } from './StoryboardRowInteractionContext';
import StoryboardTableOutlineSidebar from './StoryboardTableOutlineSidebar';
import { StoryboardRowMeasureWrap } from './StoryboardRowMeasureWrap';
import { storyboardCompositeDomId, storyboardRowDomId } from './storyboardTableDom';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_COLUMN_HEAD,
  STORYBOARD_COMPOSITE_RAIL_W,
  STORYBOARD_GAP_STACK,
  STORYBOARD_GRID_EDITOR_PREVIEW,
  STORYBOARD_GRID_ROOT,
  STORYBOARD_PAD_PANEL,
  STORYBOARD_SIDE_RAIL,
} from './storyboardTableUi';

export type StoryboardTableEditViewHandle = {
  scrollToRow: (rowId: string, behavior?: ScrollBehavior) => void;
};

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  imageBusyRowId: string | null;
  redrawBusyRowId: string | null;
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
  interaction,
  onActiveRowIdChange,
  redrawRowDisabledReason,
  footerAddRow,
  editScrollRef,
}: Props) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const editorVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_EDIT_ROW_ESTIMATE_PX,
    gap: STORYBOARD_EDIT_ROW_GAP_PX,
  });
  const outlineVirtual = useStoryboardVirtualList({
    rowIds,
    estimateHeight: STORYBOARD_OUTLINE_ROW_ESTIMATE_PX,
    gap: 1,
    overscan: 8,
  });

  const compositeScrollRef = useRef<HTMLDivElement>(null);
  const scrollActiveTimerRef = useRef(0);
  /** 大纲/程序定位后短暂忽略滚动反推 activeRow，避免 smooth 滚动期间乱跳 */
  const explicitSelectLockRef = useRef(0);

  const lockActiveFromScroll = useCallback((ms = 200) => {
    explicitSelectLockRef.current = performance.now() + ms;
  }, []);

  const shouldIgnoreActiveFromScroll = useCallback(() => {
    return performance.now() < explicitSelectLockRef.current;
  }, []);

  const editorOffsets = useMemo(
    () =>
      buildStoryboardRowOffsets(
        rowIds,
        editorVirtual.heights,
        STORYBOARD_EDIT_ROW_ESTIMATE_PX,
        STORYBOARD_EDIT_ROW_GAP_PX
      ).offsets,
    [rowIds, editorVirtual.heights]
  );

  const scrollToRow = useCallback(
    (rowId: string, behavior: ScrollBehavior = 'auto') => {
      const index = rows.findIndex((r) => r.id === rowId);
      if (index < 0) return;
      lockActiveFromScroll(behavior === 'smooth' ? 700 : 220);
      editorVirtual.scrollToIndex(index, behavior);
      outlineVirtual.scrollToIndex(index, behavior);
      requestAnimationFrame(() => {
        const compositeEl = document.getElementById(storyboardCompositeDomId(rowId));
        const container = compositeScrollRef.current;
        if (compositeEl && container) {
          const top =
            compositeEl.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop;
          container.scrollTo({ top: Math.max(0, top - 8), behavior });
        }
      });
    },
    [editorVirtual, lockActiveFromScroll, outlineVirtual, rows]
  );

  useImperativeHandle(editScrollRef, () => ({ scrollToRow }), [scrollToRow]);

  const scheduleActiveFromScroll = useCallback(() => {
    if (shouldIgnoreActiveFromScroll()) return;
    window.clearTimeout(scrollActiveTimerRef.current);
    scrollActiveTimerRef.current = window.setTimeout(() => {
      if (shouldIgnoreActiveFromScroll()) return;
      const idx = editorVirtual.activeIndexFromScroll();
      const row = rows[idx];
      if (row && row.id !== activeRowId) onActiveRowIdChange(row.id);
    }, 80);
  }, [
    activeRowId,
    editorVirtual,
    onActiveRowIdChange,
    rows,
    shouldIgnoreActiveFromScroll,
  ]);

  useEffect(() => {
    return () => window.clearTimeout(scrollActiveTimerRef.current);
  }, []);

  const onEditorScroll = useCallback(() => {
    editorVirtual.handleScroll();
    const el = editorVirtual.scrollRef.current;
    const composite = compositeScrollRef.current;
    if (el && composite && composite.scrollTop !== el.scrollTop) {
      composite.scrollTop = el.scrollTop;
    }
    scheduleActiveFromScroll();
  }, [editorVirtual, scheduleActiveFromScroll]);

  useEffect(() => {
    if (!editorVirtual.virtualize) return;
    const el = editorVirtual.scrollRef.current;
    const composite = compositeScrollRef.current;
    if (el && composite && composite.scrollTop !== el.scrollTop) {
      composite.scrollTop = el.scrollTop;
    }
  }, [editorVirtual.virtualize, editorVirtual.range.startIndex, editorVirtual.range.paddingTop]);

  const renderEditorRow = (row: StoryboardTableRow, index: number) => {
    const redrawReason = redrawRowDisabledReason(row);
    const redrawDisabled = Boolean(redrawReason) || redrawBusyRowId != null;
    const inner = (
      <StoryboardConnectedRowEditor
        domId={storyboardRowDomId(row.id)}
        row={row}
        index={index}
        active={activeRowId === row.id}
        imageBusy={imageBusyRowId === row.id}
        redrawBusy={redrawBusyRowId === row.id}
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

    const top = storyboardScrollOffsetForIndex(index, editorOffsets);

    return (
      <StoryboardRowMeasureWrap
        key={row.id}
        rowId={row.id}
        measureRow={editorVirtual.measureRow}
        className="absolute left-0 right-0"
        style={{ top }}
      >
        {inner}
      </StoryboardRowMeasureWrap>
    );
  };

  const renderCompositeRow = (row: StoryboardTableRow, index: number) => {
    const syncHeight = editorVirtual.heights[row.id];
    const inner = (
      <StoryboardConnectedCompositeCard
        row={row}
        index={index}
        syncHeight={syncHeight}
        active={activeRowId === row.id}
        onSelect={() => onActiveRowIdChange(row.id)}
        onPreviewImage={interaction.previewImage}
      />
    );

    if (!editorVirtual.virtualize) {
      return <React.Fragment key={row.id}>{inner}</React.Fragment>;
    }

    const top = storyboardScrollOffsetForIndex(index, editorOffsets);

    return (
      <div key={row.id} className="absolute left-0 right-0" style={{ top }}>
        {inner}
      </div>
    );
  };

  const visibleRows = useMemo(() => {
    const { startIndex, endIndex } = editorVirtual.range;
    return rows.slice(startIndex, endIndex);
  }, [editorVirtual.range, rows]);

  const editorList = editorVirtual.virtualize ? (
    <div className="relative w-full" style={{ height: editorVirtual.range.totalHeight }}>
      {visibleRows.map((row) => renderEditorRow(row, row.index))}
    </div>
  ) : (
    <div className={`flex w-full min-w-0 flex-col ${STORYBOARD_GAP_STACK}`}>
      {rows.map((row, i) => renderEditorRow(row, i))}
    </div>
  );

  const compositeList = editorVirtual.virtualize ? (
    <div className="relative w-full" style={{ height: editorVirtual.range.totalHeight }}>
      {visibleRows.map((row) => renderCompositeRow(row, row.index))}
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
              {editorList}
              {footerAddRow ? (
                <div className={editorVirtual.virtualize ? 'mt-2' : ''}>{footerAddRow}</div>
              ) : null}
            </div>
          </div>

          <aside className={`${STORYBOARD_SIDE_RAIL} ${STORYBOARD_COMPOSITE_RAIL_W} shrink-0`}>
            <div className="shrink-0 px-0.5">
              <p className={STORYBOARD_COLUMN_HEAD}>分镜合成</p>
              <p className="text-[9px] leading-tight text-gray-600">实时预览</p>
            </div>
            <div
              ref={compositeScrollRef}
              className={`${STORYBOARD_BODY_SCROLL} flex flex-col pr-0.5`}
              onScroll={() => {
                const el = editorVirtual.scrollRef.current;
                const composite = compositeScrollRef.current;
                if (el && composite && el.scrollTop !== composite.scrollTop) {
                  el.scrollTop = composite.scrollTop;
                  onEditorScroll();
                }
              }}
            >
              {compositeList}
            </div>
          </aside>
        </div>
      </div>
    </StoryboardRowInteractionProvider>
  );
}
