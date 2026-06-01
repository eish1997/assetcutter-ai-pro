import { useCallback, useEffect, useRef, useState } from 'react';

export type StoryboardCanvasMarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DRAG_THRESHOLD_PX = 4;
const TILE_SELECTOR = '[data-canvas-row-id]';

function normalizeMarqueeRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): StoryboardCanvasMarqueeRect {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function rectsIntersect(a: DOMRect, b: StoryboardCanvasMarqueeRect): boolean {
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;
  return !(a.right < b.left || a.left > bRight || a.bottom < b.top || a.top > bBottom);
}

export function collectStoryboardCanvasRowIdsInMarquee(
  container: HTMLElement,
  marquee: StoryboardCanvasMarqueeRect
): string[] {
  const ids: string[] = [];
  container.querySelectorAll<HTMLElement>(TILE_SELECTOR).forEach((el) => {
    const rowId = el.dataset.canvasRowId;
    if (!rowId) return;
    if (rectsIntersect(el.getBoundingClientRect(), marquee)) {
      ids.push(rowId);
    }
  });
  return ids;
}

type PointerSession = {
  pointerId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  additive: boolean;
  shiftKey: boolean;
  rowId: string | null;
  dragging: boolean;
};

export type StoryboardCanvasTileSelectModifiers = {
  additive?: boolean;
  range?: boolean;
};

type UseStoryboardCanvasMarqueeSelectOptions = {
  containerRef: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
  onMarqueeComplete: (rowIds: string[], additive: boolean) => void;
  onTileSelect: (rowId: string, modifiers?: StoryboardCanvasTileSelectModifiers) => void;
};

export function useStoryboardCanvasMarqueeSelect({
  containerRef,
  disabled = false,
  onMarqueeComplete,
  onTileSelect,
}: UseStoryboardCanvasMarqueeSelectOptions) {
  const [marqueeRect, setMarqueeRect] = useState<StoryboardCanvasMarqueeRect | null>(null);
  const sessionRef = useRef<PointerSession | null>(null);
  const onMarqueeCompleteRef = useRef(onMarqueeComplete);
  const onTileSelectRef = useRef(onTileSelect);
  onMarqueeCompleteRef.current = onMarqueeComplete;
  onTileSelectRef.current = onTileSelect;

  const finishSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setMarqueeRect(null);
    if (!session) return;

    if (session.dragging) {
      const rect = normalizeMarqueeRect(
        session.startX,
        session.startY,
        session.endX,
        session.endY
      );
      if (rect.width >= DRAG_THRESHOLD_PX || rect.height >= DRAG_THRESHOLD_PX) {
        const container = containerRef.current;
        if (container) {
          const rowIds = collectStoryboardCanvasRowIdsInMarquee(container, rect);
          if (rowIds.length) {
            onMarqueeCompleteRef.current(rowIds, session.additive);
            return;
          }
        }
      }
    }

    if (session.rowId) {
      onTileSelectRef.current(session.rowId, {
        additive: session.additive,
        range: session.shiftKey,
      });
    }
  }, [containerRef]);

  useEffect(() => {
    if (disabled) return;

    const onWindowPointerMove = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      session.endX = e.clientX;
      session.endY = e.clientY;

      const dx = session.endX - session.startX;
      const dy = session.endY - session.startY;
      if (!session.dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        session.dragging = true;
      }

      if (session.dragging) {
        e.preventDefault();
        setMarqueeRect(
          normalizeMarqueeRect(session.startX, session.startY, session.endX, session.endY)
        );
      }
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== e.pointerId) return;
      finishSession();
    };

    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, [disabled, finishSession]);

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest('button[type="button"]')) return;

      const tile = target.closest<HTMLElement>(TILE_SELECTOR);
      const rowId = tile?.dataset.canvasRowId ?? null;

      sessionRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
        additive: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
        rowId,
        dragging: false,
      };
      setMarqueeRect(null);

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [disabled]
  );

  return {
    marqueeRect,
    onContainerPointerDown,
  };
}
