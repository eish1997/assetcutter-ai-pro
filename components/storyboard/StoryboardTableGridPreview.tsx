import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardTableRow } from '../../types';
import {
  STORYBOARD_EDIT_ROW_GAP_PX,
  STORYBOARD_GRID_BAND_ESTIMATE_PX,
  STORYBOARD_VIRTUALIZE_MIN_ROWS,
  storyboardGridBandCount,
  storyboardGridColumnsForWidth,
} from '../../services/storyboardVirtualScroll';
import StoryboardFrameCompositeCard from './StoryboardFrameCompositeCard';
import {
  STORYBOARD_BODY_SCROLL,
  STORYBOARD_GAP_STACK,
  STORYBOARD_GRID_PREVIEW,
  STORYBOARD_PAD_PANEL,
} from './storyboardTableUi';

type Props = {
  rows: StoryboardTableRow[];
  activeRowId: string | null;
  onSelect: (rowId: string) => void;
  onOpenInEditor: (rowId: string) => void;
  onPreviewImage: (src: string) => void;
  scrollToRowRef?: React.MutableRefObject<((rowId: string) => void) | null>;
};

export default function StoryboardTableGridPreview({
  rows,
  activeRowId,
  onSelect,
  onOpenInEditor,
  onPreviewImage,
  scrollToRowRef,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const virtualize = rows.length >= STORYBOARD_VIRTUALIZE_MIN_ROWS;
  const bandCount = storyboardGridBandCount(rows.length, columns);
  const bandHeight = STORYBOARD_GRID_BAND_ESTIMATE_PX + STORYBOARD_EDIT_ROW_GAP_PX;
  const totalHeight = virtualize ? Math.max(0, bandCount * bandHeight - STORYBOARD_EDIT_ROW_GAP_PX) : 0;

  const readLayout = useCallback(() => {
    const grid = gridRef.current;
    const scroll = scrollRef.current;
    if (grid) {
      setColumns(storyboardGridColumnsForWidth(grid.clientWidth));
    }
    if (scroll) {
      setScrollTop(scroll.scrollTop);
      setViewportHeight(scroll.clientHeight);
    }
  }, []);

  useLayoutEffect(() => {
    readLayout();
    const grid = gridRef.current;
    const scroll = scrollRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => readLayout());
    ro.observe(grid);
    if (scroll) ro.observe(scroll);
    return () => ro.disconnect();
  }, [readLayout, rows.length]);

  const scrollToRow = useCallback(
    (rowId: string) => {
      const index = rows.findIndex((r) => r.id === rowId);
      if (index < 0 || !scrollRef.current) return;
      const band = Math.floor(index / Math.max(columns, 1));
      scrollRef.current.scrollTo({ top: band * bandHeight, behavior: 'smooth' });
    },
    [bandHeight, columns, rows]
  );

  React.useEffect(() => {
    if (scrollToRowRef) scrollToRowRef.current = scrollToRow;
    return () => {
      if (scrollToRowRef) scrollToRowRef.current = null;
    };
  }, [scrollToRow, scrollToRowRef]);

  const { startBand, endBand } = useMemo(() => {
    if (!virtualize) return { startBand: 0, endBand: bandCount };
    const overscan = 2;
    const start = Math.max(0, Math.floor(scrollTop / bandHeight) - overscan);
    const end = Math.min(
      bandCount,
      Math.ceil((scrollTop + viewportHeight) / bandHeight) + overscan
    );
    return { startBand: start, endBand: end };
  }, [bandCount, bandHeight, scrollTop, viewportHeight, virtualize]);

  const visibleRows = useMemo(() => {
    if (!virtualize) return rows;
    const start = startBand * columns;
    const end = Math.min(rows.length, endBand * columns);
    return rows.slice(start, end);
  }, [columns, endBand, rows, startBand, virtualize]);

  const paddingTop = virtualize ? startBand * bandHeight : 0;
  const paddingBottom = virtualize
    ? Math.max(0, totalHeight - endBand * bandHeight)
    : 0;

  const gridContent = (
    <div
      ref={gridRef}
      className={STORYBOARD_GRID_PREVIEW}
      style={virtualize ? { paddingTop, paddingBottom } : undefined}
    >
      {(virtualize ? visibleRows : rows).map((row, i) => {
        const index = virtualize ? startBand * columns + i : i;
        return (
          <StoryboardFrameCompositeCard
            key={row.id}
            row={row}
            index={index}
            layout="grid"
            active={activeRowId === row.id}
            onSelect={() => onSelect(row.id)}
            onOpenInEditor={() => onOpenInEditor(row.id)}
            onPreviewImage={onPreviewImage}
          />
        );
      })}
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${STORYBOARD_PAD_PANEL} pt-1`}>
      <div
        ref={scrollRef}
        onScroll={() => readLayout()}
        className={`${STORYBOARD_BODY_SCROLL} min-h-0 flex-1 pb-1`}
      >
        {rows.length === 0 ? (
          <p className="py-12 text-center text-[11px] text-gray-600">暂无镜头</p>
        ) : virtualize ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div className={`absolute inset-x-0 top-0 ${STORYBOARD_GAP_STACK}`}>{gridContent}</div>
          </div>
        ) : (
          gridContent
        )}
      </div>
    </div>
  );
}
