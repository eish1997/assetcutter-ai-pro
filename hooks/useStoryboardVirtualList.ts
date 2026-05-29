import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { StoryboardVirtualRange } from '../services/storyboardVirtualScroll';
import {
  STORYBOARD_VIRTUAL_OVERSCAN,
  STORYBOARD_VIRTUALIZE_MIN_ROWS,
  buildStoryboardRowOffsets,
  computeStoryboardVirtualRange,
  storyboardActiveRowIndexFromScroll,
  storyboardRowHeightAt,
  storyboardScrollOffsetForIndex,
} from '../services/storyboardVirtualScroll';

export type UseStoryboardVirtualListOptions = {
  rowIds: string[];
  estimateHeight: number;
  gap: number;
  overscan?: number;
  /** 显式关闭；默认 rowIds.length >= STORYBOARD_VIRTUALIZE_MIN_ROWS 时开启 */
  virtualize?: boolean;
};

export type UseStoryboardVirtualListResult = {
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualize: boolean;
  range: StoryboardVirtualRange;
  heights: Record<string, number>;
  measureRow: (rowId: string, height: number) => void;
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void;
  handleScroll: () => void;
  activeIndexFromScroll: () => number;
};

export function useStoryboardVirtualList(
  options: UseStoryboardVirtualListOptions
): UseStoryboardVirtualListResult {
  const { rowIds, estimateHeight, gap } = options;
  const overscan = options.overscan ?? STORYBOARD_VIRTUAL_OVERSCAN;
  const virtualize =
    options.virtualize ??
    rowIds.length >= STORYBOARD_VIRTUALIZE_MIN_ROWS;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});

  const rowIdsKey = rowIds.join('\0');
  const prevRowIdsKeyRef = useRef(rowIdsKey);
  useEffect(() => {
    if (prevRowIdsKeyRef.current === rowIdsKey) return;
    prevRowIdsKeyRef.current = rowIdsKey;
    setHeights((prev) => {
      const next: Record<string, number> = {};
      for (const id of rowIds) {
        if (prev[id] != null) next[id] = prev[id]!;
      }
      return next;
    });
  }, [rowIds, rowIdsKey]);

  const { offsets, totalHeight } = useMemo(
    () => buildStoryboardRowOffsets(rowIds, heights, estimateHeight, gap),
    [rowIds, heights, estimateHeight, gap]
  );

  const rowHeightAt = useCallback(
    (index: number) => storyboardRowHeightAt(rowIds, heights, index, estimateHeight),
    [rowIds, heights, estimateHeight]
  );

  const range = useMemo((): StoryboardVirtualRange => {
    if (!virtualize) {
      return {
        startIndex: 0,
        endIndex: rowIds.length,
        paddingTop: 0,
        paddingBottom: 0,
        totalHeight,
      };
    }
    return computeStoryboardVirtualRange(
      scrollTop,
      viewportHeight,
      rowIds.length,
      offsets,
      totalHeight,
      rowHeightAt,
      gap,
      overscan
    );
  }, [
    virtualize,
    scrollTop,
    viewportHeight,
    rowIds.length,
    offsets,
    totalHeight,
    rowHeightAt,
    gap,
    overscan,
  ]);

  const measureRow = useCallback((rowId: string, height: number) => {
    const rounded = Math.round(height);
    if (rounded <= 0) return;
    setHeights((prev) => (prev[rowId] === rounded ? prev : { ...prev, [rowId]: rounded }));
  }, []);

  const readViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, []);

  useLayoutEffect(() => {
    readViewport();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => readViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [readViewport, rowIdsKey, virtualize]);

  const handleScroll = useCallback(() => {
    readViewport();
  }, [readViewport]);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el || index < 0 || index >= rowIds.length) return;
      const top = storyboardScrollOffsetForIndex(index, offsets);
      el.scrollTo({ top, behavior });
      if (behavior === 'auto') readViewport();
    },
    [offsets, readViewport, rowIds.length]
  );

  const activeIndexFromScroll = useCallback(() => {
    return storyboardActiveRowIndexFromScroll(
      scrollTop,
      viewportHeight,
      rowIds.length,
      offsets,
      rowHeightAt
    );
  }, [scrollTop, viewportHeight, rowIds.length, offsets, rowHeightAt]);

  return {
    scrollRef,
    virtualize,
    range,
    heights,
    measureRow,
    scrollToIndex,
    handleScroll,
    activeIndexFromScroll,
  };
}
