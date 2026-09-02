import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { WorkflowJustifiedLayoutBox } from '../services/workflowJustifiedLayout';
import {
  filterWorkflowJustifiedBoxIdsInScroll,
  mergeWorkflowJustifiedLingerVisibleIds,
  shouldVirtualizeWorkflowJustifiedGrid,
  workflowJustifiedMarqueeHitIds,
  WORKFLOW_JUSTIFIED_VIRTUAL_LINGER_PX,
  WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX,
} from '../services/workflowJustifiedScroll';

export type UseWorkflowJustifiedVirtualScrollOptions = {
  boxes: WorkflowJustifiedLayoutBox[];
  /** 显式关闭；默认 itemCount >= 48 时开启 */
  virtualize?: boolean;
  overscanPx?: number;
  lingerPx?: number;
};

export function useWorkflowJustifiedVirtualScroll(
  scrollRef: RefObject<HTMLElement | null>,
  gridRef: RefObject<HTMLElement | null>,
  options: UseWorkflowJustifiedVirtualScrollOptions
) {
  const { boxes } = options;
  const overscanPx = options.overscanPx ?? WORKFLOW_JUSTIFIED_VIRTUAL_OVERSCAN_PX;
  const lingerPx = options.lingerPx ?? WORKFLOW_JUSTIFIED_VIRTUAL_LINGER_PX;
  const virtualize =
    options.virtualize ?? shouldVirtualizeWorkflowJustifiedGrid(boxes.length);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRafRef = useRef(0);
  const lingerMountedIdsRef = useRef<Set<string>>(new Set());

  const readScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, [scrollRef]);

  useLayoutEffect(() => {
    readScroll();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (scrollRafRef.current) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        readScroll();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => readScroll());
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [readScroll, scrollRef, boxes.length, virtualize]);

  const visibleBoxIds = useMemo(() => {
    if (!virtualize) {
      const all = new Set(boxes.map((b) => b.id));
      lingerMountedIdsRef.current = all;
      return all;
    }
    if (!(viewportHeight > 0)) {
      const seed = new Set(boxes.slice(0, Math.min(boxes.length, 24)).map((b) => b.id));
      lingerMountedIdsRef.current = seed;
      return seed;
    }
    const next = mergeWorkflowJustifiedLingerVisibleIds(
      lingerMountedIdsRef.current,
      boxes,
      scrollTop,
      viewportHeight,
      overscanPx,
      lingerPx
    );
    lingerMountedIdsRef.current = next;
    return next;
  }, [virtualize, boxes, scrollTop, viewportHeight, overscanPx, lingerPx]);

  const isBoxVisible = useCallback(
    (id: string) => visibleBoxIds.has(id),
    [visibleBoxIds]
  );

  /** 严格视口内（无 overscan）：缩略图 high 优先级 */
  const hotBoxIds = useMemo(() => {
    if (!virtualize) return visibleBoxIds;
    return filterWorkflowJustifiedBoxIdsInScroll(boxes, scrollTop, viewportHeight, 0);
  }, [virtualize, visibleBoxIds, boxes, scrollTop, viewportHeight]);

  const layoutMarqueeHitIds = useCallback(
    (sel: { left: number; top: number; width: number; height: number }) => {
      const gridEl = gridRef.current;
      if (!gridEl || !virtualize) return null;
      const gridRect = gridEl.getBoundingClientRect();
      return workflowJustifiedMarqueeHitIds(sel, boxes, gridRect);
    },
    [gridRef, virtualize, boxes]
  );

  return {
    virtualize,
    visibleBoxIds,
    hotBoxIds,
    isBoxVisible,
    scrollTop,
    viewportHeight,
    layoutMarqueeHitIds,
  };
}
