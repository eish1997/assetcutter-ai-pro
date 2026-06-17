import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { WorkflowPendingTask } from '../types';

export type UseWorkflowMarqueeArgs = {
  registerMarqueeStartHandler?: (handler: ((e: ReactMouseEvent) => void) | null) => void;
  showArchived: boolean;
  workspacePane: number;
  spaceMarqueeEnabled: boolean;
  marqueeStartRef: RefObject<boolean>;
  cardRefs: RefObject<Map<string, HTMLElement>>;
  groupFilterIdRef: RefObject<string | null>;
  pendingRef: RefObject<WorkflowPendingTask[]>;
  setSelectedAssetIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
};

type MarqueeRect = { left: number; top: number; width: number; height: number };

const MARQUEE_CLICK_SLOP = 5;

function applyMarqueeSelection(
  sel: MarqueeRect,
  opts: {
    altKey: boolean;
    cardRefs: RefObject<Map<string, HTMLElement>>;
    groupFilterIdRef: RefObject<string | null>;
    pendingRef: RefObject<WorkflowPendingTask[]>;
    setSelectedAssetIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
  }
) {
  const ids: string[] = [];
  opts.cardRefs.current?.forEach((el, id) => {
    const r = el.getBoundingClientRect();
    const overlap = !(
      sel.left + sel.width < r.left ||
      r.left + r.width < sel.left ||
      sel.top + sel.height < r.top ||
      r.top + r.height < sel.top
    );
    if (overlap) ids.push(id);
  });
  if (!ids.length) return;
  const currentGroupId = opts.groupFilterIdRef.current;
  const pendNow = opts.pendingRef.current ?? [];
  if (!currentGroupId) {
    const toAdd = opts.altKey ? [] : ids.filter((id) => !pendNow.some((t) => t.assetId === id));
    const toRemove = opts.altKey ? ids : [];
    opts.setSelectedAssetIds((s) => {
      const next = new Set(s);
      toRemove.forEach((id) => next.delete(id));
      toAdd.forEach((id) => next.add(id));
      return next;
    });
  } else {
    const toAdd = opts.altKey
      ? []
      : ids.filter((key) => {
          const parts = String(key).split('::');
          if (parts.length !== 2) return true;
          const idx = parseInt(parts[1], 10);
          if (Number.isNaN(idx)) return true;
          return !pendNow.some((t) => t.sourceGroupAssetId === currentGroupId && t.sourceItemIndex === idx);
        });
    const toRemove = opts.altKey ? ids : [];
    opts.setSelectedGroupItemKeys((s) => {
      const next = new Set(s);
      toRemove.forEach((key) => next.delete(key));
      toAdd.forEach((key) => next.add(key));
      return next;
    });
  }
}

export function useWorkflowMarquee({
  registerMarqueeStartHandler,
  showArchived,
  workspacePane,
  spaceMarqueeEnabled,
  marqueeStartRef,
  cardRefs,
  groupFilterIdRef,
  pendingRef,
  setSelectedAssetIds,
  setSelectedGroupItemKeys,
}: UseWorkflowMarqueeArgs) {
  const [marqueeActive, setMarqueeActive] = useState(false);
  const marqueeDataRef = useRef({ startX: 0, startY: 0, endX: 0, endY: 0 });
  const marqueeOverlayElRef = useRef<HTMLDivElement | null>(null);
  const marqueePaneRef = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const captureElRef = useRef<HTMLElement | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);

  const updateMarqueeOverlayDom = useCallback(() => {
    const d = marqueeDataRef.current;
    const el = marqueeOverlayElRef.current;
    if (!el) return;
    const left = Math.min(d.startX, d.endX);
    const top = Math.min(d.startY, d.endY);
    const width = Math.max(0, Math.abs(d.endX - d.startX));
    const height = Math.max(0, Math.abs(d.endY - d.startY));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }, []);

  const releasePointerCapture = useCallback(() => {
    const el = captureElRef.current;
    const pid = capturePointerIdRef.current;
    if (el != null && pid != null) {
      try {
        if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
    }
    captureElRef.current = null;
    capturePointerIdRef.current = null;
  }, []);

  const endMarqueeDrag = useCallback(
    (clientX: number, clientY: number, altKey: boolean) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      releasePointerCapture();

      marqueeDataRef.current.endX = clientX;
      marqueeDataRef.current.endY = clientY;

      const d = marqueeDataRef.current;
      const left = Math.min(d.startX, d.endX);
      const top = Math.min(d.startY, d.endY);
      const width = Math.abs(d.endX - d.startX);
      const height = Math.abs(d.endY - d.startY);
      const isClick = width < MARQUEE_CLICK_SLOP && height < MARQUEE_CLICK_SLOP;
      const inGroup = !!groupFilterIdRef.current;

      marqueeOverlayElRef.current?.style.setProperty('visibility', 'hidden');
      setMarqueeActive(false);
      marqueeStartRef.current = false;

      if (isClick) {
        if (!inGroup) {
          setSelectedAssetIds(new Set());
        } else {
          setSelectedGroupItemKeys(new Set());
        }
        return;
      }

      const sel = { left, top, width, height };
      window.requestAnimationFrame(() => {
        applyMarqueeSelection(sel, {
          altKey,
          cardRefs,
          groupFilterIdRef,
          pendingRef,
          setSelectedAssetIds,
          setSelectedGroupItemKeys,
        });
      });
    },
    [
      cardRefs,
      groupFilterIdRef,
      marqueeStartRef,
      pendingRef,
      releasePointerCapture,
      setSelectedAssetIds,
      setSelectedGroupItemKeys,
    ]
  );

  const startMarqueeDrag = useCallback(
    (
      clientX: number,
      clientY: number,
      pane: number,
      capture?: { el: HTMLElement; pointerId: number }
    ) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      releasePointerCapture();

      marqueePaneRef.current = pane;
      marqueeStartRef.current = true;
      marqueeDataRef.current = {
        startX: clientX,
        startY: clientY,
        endX: clientX,
        endY: clientY,
      };
      marqueeOverlayElRef.current?.style.removeProperty('visibility');
      setMarqueeActive(true);
      updateMarqueeOverlayDom();

      if (capture) {
        captureElRef.current = capture.el;
        capturePointerIdRef.current = capture.pointerId;
        try {
          capture.el.setPointerCapture(capture.pointerId);
        } catch {
          /* ignore */
        }
      }

      const onPointerMove = (e: PointerEvent) => {
        marqueeDataRef.current.endX = e.clientX;
        marqueeDataRef.current.endY = e.clientY;
        updateMarqueeOverlayDom();
      };

      const onPointerUp = (e: PointerEvent) => {
        if (e.button !== 0) return;
        endMarqueeDrag(e.clientX, e.clientY, e.altKey);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };
    },
    [endMarqueeDrag, marqueeStartRef, releasePointerCapture, updateMarqueeOverlayDom]
  );

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      releasePointerCapture();
    },
    [releasePointerCapture]
  );

  const handleMarqueeMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (spaceMarqueeEnabled) return;
      const pn = Math.round(workspacePane);
      if (pn !== 0 && pn !== 1) return;
      if (showArchived) return;
      if ((e.target as Element).closest('[data-workflow-toolbar]')) return;
      if ((e.target as Element).closest('[data-workflow-card]')) return;
      if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea, label')) return;
      if ((e.target as Element).closest('[data-workflow-sidebar], [data-workflow-preset], [data-workflow-outline]')) return;
      e.preventDefault();
      e.stopPropagation();
      startMarqueeDrag(e.clientX, e.clientY, pn);
    },
    [showArchived, spaceMarqueeEnabled, startMarqueeDrag, workspacePane]
  );

  useEffect(() => {
    if (!registerMarqueeStartHandler) return;
    registerMarqueeStartHandler(handleMarqueeMouseDown);
    return () => registerMarqueeStartHandler(null);
  }, [registerMarqueeStartHandler, handleMarqueeMouseDown]);

  const handleSpaceMarqueePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (showArchived) return;
      e.preventDefault();
      e.stopPropagation();
      startMarqueeDrag(e.clientX, e.clientY, Math.round(workspacePane), {
        el: e.currentTarget,
        pointerId: e.pointerId,
      });
    },
    [showArchived, startMarqueeDrag, workspacePane]
  );

  useLayoutEffect(() => {
    if (!marqueeActive) return;
    updateMarqueeOverlayDom();
  }, [marqueeActive, updateMarqueeOverlayDom]);

  return {
    marqueeActive,
    marqueeDataRef,
    marqueeOverlayElRef,
    marqueePaneRef,
    handleSpaceMarqueePointerDown,
  };
}
