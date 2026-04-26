import { useState, useRef, useCallback, useEffect, useLayoutEffect, type RefObject, type MouseEvent as ReactMouseEvent, type Dispatch, type SetStateAction } from 'react';
import type { WorkflowPendingTask } from '../types';

export type UseWorkflowMarqueeArgs = {
  registerMarqueeStartHandler?: (handler: ((e: ReactMouseEvent) => void) | null) => void;
  showArchived: boolean;
  workspacePane: number;
  marqueeStartRef: RefObject<boolean>;
  libraryCardRefs: RefObject<Map<string, HTMLElement>>;
  cardRefs: RefObject<Map<string, HTMLElement>>;
  groupFilterIdRef: RefObject<string | null>;
  pendingRef: RefObject<WorkflowPendingTask[]>;
  setSelectedAssetIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedGroupItemKeys: Dispatch<SetStateAction<Set<string>>>;
};

export function useWorkflowMarquee({
  registerMarqueeStartHandler,
  showArchived,
  workspacePane,
  marqueeStartRef,
  libraryCardRefs,
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

  const handleMarqueeMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      const pn = Math.round(workspacePane);
      if (pn !== 0 && pn !== 1 && pn !== 2) return;
      if (pn !== 0 && showArchived) return;
      if ((e.target as Element).closest('[data-workflow-toolbar]')) return;
      if (pn === 0) {
        if ((e.target as Element).closest('[data-workflow-library-card]')) return;
        if ((e.target as Element).closest('[data-workflow-outline]')) return;
        if ((e.target as Element).closest('[data-workflow-outline-footer]')) return;
        if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea, label')) return;
        if ((e.target as Element).closest('[data-workflow-sidebar], [data-workflow-preset]')) return;
      } else {
        if ((e.target as Element).closest('[data-workflow-card]')) return;
        if ((e.target as Element).closest('button, [role="button"], a, input, select, textarea, label')) return;
        if ((e.target as Element).closest('[data-workflow-sidebar], [data-workflow-preset], [data-workflow-outline]')) return;
      }
      marqueePaneRef.current = pn;
      marqueeStartRef.current = true;
      e.preventDefault();
      e.stopPropagation();
      marqueeDataRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
      };
      setMarqueeActive(true);
    },
    [showArchived, workspacePane, marqueeStartRef]
  );

  useEffect(() => {
    if (!registerMarqueeStartHandler) return;
    registerMarqueeStartHandler(handleMarqueeMouseDown);
    return () => registerMarqueeStartHandler(null);
  }, [registerMarqueeStartHandler, handleMarqueeMouseDown]);

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

  useLayoutEffect(() => {
    if (!marqueeActive) return;
    updateMarqueeOverlayDom();
  }, [marqueeActive, updateMarqueeOverlayDom]);

  useEffect(() => {
    if (!marqueeActive) return;
    const onMove = (e: MouseEvent) => {
      marqueeDataRef.current.endX = e.clientX;
      marqueeDataRef.current.endY = e.clientY;
      updateMarqueeOverlayDom();
    };
    const onUp = (e: MouseEvent) => {
      const d = marqueeDataRef.current;
      const left = Math.min(d.startX, d.endX);
      const top = Math.min(d.startY, d.endY);
      const width = Math.abs(d.endX - d.startX);
      const height = Math.abs(d.endY - d.startY);
      const isClick = width < 5 && height < 5;
      const pane = marqueePaneRef.current;
      const inGroup = !!groupFilterIdRef.current;
      const altKey = e.altKey;

      marqueeOverlayElRef.current?.style.setProperty('visibility', 'hidden');
      setMarqueeActive(false);

      if (isClick) {
        if (pane === 0 && !inGroup) {
          return;
        } else if (pane === 0) {
          setSelectedGroupItemKeys(new Set());
        } else if (!inGroup) {
          setSelectedAssetIds(new Set());
        } else {
          setSelectedGroupItemKeys(new Set());
        }
        return;
      }

      const sel = { left, top, width, height };

      const applySelection = () => {
        const ids: string[] = [];
        cardRefs.current?.forEach((el, id) => {
          const r = el.getBoundingClientRect();
          const overlap =
            !(
              sel.left + sel.width < r.left ||
              r.left + r.width < sel.left ||
              sel.top + sel.height < r.top ||
              r.top + r.height < sel.top
            );
          if (overlap) ids.push(id);
        });
        if (!ids.length) return;
        const currentGroupId = groupFilterIdRef.current;
        const pendNow = pendingRef.current ?? [];
        if (!currentGroupId) {
          const toAdd = altKey ? [] : ids.filter((id) => !pendNow.some((t) => t.assetId === id));
          const toRemove = altKey ? ids : [];
          setSelectedAssetIds((s) => {
            const next = new Set(s);
            toRemove.forEach((id) => next.delete(id));
            toAdd.forEach((id) => next.add(id));
            return next;
          });
        } else {
          const toAdd = altKey
            ? []
            : ids.filter((key) => {
                const parts = String(key).split('::');
                if (parts.length !== 2) return true;
                const idx = parseInt(parts[1], 10);
                if (Number.isNaN(idx)) return true;
                return !pendNow.some((t) => t.sourceGroupAssetId === currentGroupId && t.sourceItemIndex === idx);
              });
          const toRemove = altKey ? ids : [];
          setSelectedGroupItemKeys((s) => {
            const next = new Set(s);
            toRemove.forEach((key) => next.delete(key));
            toAdd.forEach((key) => next.add(key));
            return next;
          });
        }
      };

      window.requestAnimationFrame(applySelection);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    marqueeActive,
    updateMarqueeOverlayDom,
    libraryCardRefs,
    cardRefs,
    groupFilterIdRef,
    pendingRef,
    setSelectedAssetIds,
    setSelectedGroupItemKeys,
  ]);

  return {
    marqueeActive,
    marqueeDataRef,
    marqueeOverlayElRef,
    marqueePaneRef,
  };
}
