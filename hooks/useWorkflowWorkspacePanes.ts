import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  WORKSPACE_SNAP_DURATION_MS,
  WORKSPACE_SNAP_EASING,
} from '../components/workflow/workflowSectionUiConstants';
import { isWorkflowEditableTarget } from '../components/workflow/workflowDomUtils';

export type UseWorkflowWorkspacePanesArgs = {
  workspaceTrackRef: RefObject<HTMLDivElement | null>;
  registerPaneWheelHandler?: (handler: ((e: ReactWheelEvent) => void) | null) => void;
  listPaneWidth: number;
  sidebarWidth: number;
  /** 与框选协调：空格平移开始时清除 */
  marqueeStartRef: RefObject<boolean>;
};

export function useWorkflowWorkspacePanes({
  workspaceTrackRef,
  registerPaneWheelHandler,
  listPaneWidth,
  sidebarWidth,
  marqueeStartRef,
}: UseWorkflowWorkspacePanesArgs) {
  const [workspacePane, setWorkspacePane] = useState<number>(2);
  const workspacePaneRef = useRef<number>(2);
  const [workspaceSnapping, setWorkspaceSnapping] = useState(false);
  const workspaceSnapTimerRef = useRef<number | null>(null);
  const workspaceSwipeTouchX = useRef(0);
  const workspaceSwipeStartOffsetPx = useRef(0);
  const workspaceRafRef = useRef<number | null>(null);
  const workspaceNextPaneRef = useRef<number>(2);
  const [spacePanEnabled, setSpacePanEnabled] = useState(false);
  const [spacePanDragging, setSpacePanDragging] = useState(false);
  const suppressClickAfterPanRef = useRef(false);
  const wheelLockUntilRef = useRef(0);

  const setWorkspacePaneRaf = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(3, next));
    workspaceNextPaneRef.current = clamped;
    if (typeof window === 'undefined') {
      setWorkspacePane(clamped);
      return;
    }
    if (workspaceRafRef.current != null) return;
    workspaceRafRef.current = window.requestAnimationFrame(() => {
      workspaceRafRef.current = null;
      setWorkspacePane(workspaceNextPaneRef.current);
    });
  }, []);

  const snapWorkspacePaneToNode = useCallback((rawPane?: number) => {
    const base = typeof rawPane === 'number' ? rawPane : workspacePaneRef.current;
    const snapped = Math.max(0, Math.min(3, Math.round(base)));
    if (workspaceSnapTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(workspaceSnapTimerRef.current);
      workspaceSnapTimerRef.current = null;
    }
    const track = workspaceTrackRef.current;
    if (track) {
      track.style.transition = `transform ${WORKSPACE_SNAP_DURATION_MS}ms ${WORKSPACE_SNAP_EASING}`;
    }
    setWorkspaceSnapping(true);
    setWorkspacePane(snapped);
    if (typeof window !== 'undefined') {
      workspaceSnapTimerRef.current = window.setTimeout(() => {
        setWorkspaceSnapping(false);
        workspaceSnapTimerRef.current = null;
      }, WORKSPACE_SNAP_DURATION_MS);
    } else {
      setWorkspaceSnapping(false);
    }
  }, [workspaceTrackRef]);

  useEffect(() => {
    return () => {
      if (workspaceRafRef.current != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(workspaceRafRef.current);
      }
      if (workspaceSnapTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(workspaceSnapTimerRef.current);
      }
    };
  }, []);

  const paneToOffsetPx = useCallback(
    (pane: number) => {
      const wh = sidebarWidth;
      const L = listPaneWidth;
      const p = Math.max(0, Math.min(3, pane));
      if (p <= 1) return p * L;
      if (p <= 2) return L + (p - 1) * wh;
      return L + wh + (p - 2) * L;
    },
    [listPaneWidth, sidebarWidth]
  );

  const offsetPxToPane = useCallback(
    (offset: number) => {
      const wh = sidebarWidth;
      const L = listPaneWidth;
      const maxOff = Math.max(0, wh + 2 * L);
      const x = Math.max(0, Math.min(maxOff, offset));
      if (x <= L) return L > 0 ? x / L : 0;
      if (x <= L + wh) return 1 + (x - L) / Math.max(1, wh);
      return 2 + (x - L - wh) / Math.max(1, L);
    },
    [listPaneWidth, sidebarWidth]
  );

  const applyWorkspacePaneImmediate = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(3, next));
      workspacePaneRef.current = clamped;
      const track = workspaceTrackRef.current;
      if (track) {
        track.style.transition = 'none';
        const offset = paneToOffsetPx(clamped);
        track.style.transform = `translate3d(${-offset}px, 0, 0)`;
      }
    },
    [paneToOffsetPx, workspaceTrackRef]
  );

  const handlePaneWheel = useCallback(
    (e: ReactWheelEvent) => {
      const deltaPrimary = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      e.preventDefault();
      e.stopPropagation();
      if (Math.abs(deltaPrimary) < 2) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now < wheelLockUntilRef.current) return;
      wheelLockUntilRef.current = now + 180;
      const currentNode = Math.max(0, Math.min(3, Math.round(workspacePaneRef.current)));
      const dir = deltaPrimary > 0 ? 1 : -1;
      const targetNode = Math.max(0, Math.min(3, currentNode + dir));
      if (targetNode === currentNode) return;
      snapWorkspacePaneToNode(targetNode);
    },
    [snapWorkspacePaneToNode]
  );

  useEffect(() => {
    if (!registerPaneWheelHandler) return;
    registerPaneWheelHandler(handlePaneWheel);
    return () => registerPaneWheelHandler(null);
  }, [registerPaneWheelHandler, handlePaneWheel]);

  const workspaceOffsetPx = paneToOffsetPx(workspacePane);

  useEffect(() => {
    workspacePaneRef.current = workspacePane;
    const track = workspaceTrackRef.current;
    if (track) {
      track.style.transition = workspaceSnapping
        ? `transform ${WORKSPACE_SNAP_DURATION_MS}ms ${WORKSPACE_SNAP_EASING}`
        : 'none';
      track.style.transform = `translate3d(${-workspaceOffsetPx}px, 0, 0)`;
    }
  }, [workspacePane, workspaceOffsetPx, workspaceSnapping, workspaceTrackRef]);

  useEffect(() => {
    if (!spacePanEnabled) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-ac-block-workflow-marquee]')) return;
      if (isWorkflowEditableTarget(e.target)) return;
      marqueeStartRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startOffset = paneToOffsetPx(workspacePane);
      let panStarted = false;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        if (!panStarted) {
          if (Math.abs(dx) < 2) return;
          panStarted = true;
          suppressClickAfterPanRef.current = true;
          setSpacePanDragging(true);
        }
        ev.preventDefault();
        const nextOffset = startOffset - dx;
        const next = offsetPxToPane(nextOffset);
        applyWorkspacePaneImmediate(next);
      };
      const onUp = () => {
        snapWorkspacePaneToNode();
        if (panStarted) setSpacePanDragging(false);
        window.removeEventListener('mousemove', onMove, true);
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, { once: true, capture: true });
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      setSpacePanDragging(false);
    };
  }, [
    spacePanEnabled,
    workspacePane,
    paneToOffsetPx,
    offsetPxToPane,
    applyWorkspacePaneImmediate,
    snapWorkspacePaneToNode,
    marqueeStartRef,
  ]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (spacePanEnabled) {
      document.body.style.cursor = spacePanDragging ? 'grabbing' : 'grab';
    } else {
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.cursor = '';
    };
  }, [spacePanEnabled, spacePanDragging]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isWorkflowEditableTarget(e.target)) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) return;
      e.preventDefault();
      setSpacePanEnabled(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpacePanEnabled(false);
      setSpacePanDragging(false);
    };
    const onBlur = () => {
      setSpacePanEnabled(false);
      setSpacePanDragging(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isWorkflowEditableTarget(e.target)) return;
      if (typeof document !== 'undefined' && document.querySelector('[data-ac-block-workflow-marquee]')) return;

      const paneByCode: Record<string, number> = {
        Digit1: 0,
        Digit2: 1,
        Digit3: 2,
        Digit4: 3,
        Digit0: 3,
        Numpad1: 0,
        Numpad2: 1,
        Numpad3: 2,
        Numpad4: 3,
        Numpad0: 3,
      };
      const pane = paneByCode[e.code];
      if (pane === undefined) return;
      e.preventDefault();
      snapWorkspacePaneToNode(pane);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [snapWorkspacePaneToNode]);

  const workspaceViewportTouchHandlers = {
    onTouchStart: (e: ReactTouchEvent) => {
      workspaceSwipeTouchX.current = e.touches[0]?.clientX ?? 0;
      workspaceSwipeStartOffsetPx.current = paneToOffsetPx(workspacePane);
    },
    onTouchMove: (e: ReactTouchEvent) => {
      const x = e.touches[0]?.clientX ?? workspaceSwipeTouchX.current;
      const dx = x - workspaceSwipeTouchX.current;
      const nextOffset = workspaceSwipeStartOffsetPx.current - dx;
      const next = offsetPxToPane(nextOffset);
      applyWorkspacePaneImmediate(next);
    },
    onTouchEnd: () => {
      snapWorkspacePaneToNode();
    },
  } as const;

  return {
    workspacePane,
    setWorkspacePane,
    workspacePaneRef,
    workspaceSnapping,
    setWorkspacePaneRaf,
    snapWorkspacePaneToNode,
    applyWorkspacePaneImmediate,
    paneToOffsetPx,
    offsetPxToPane,
    handlePaneWheel,
    workspaceOffsetPx,
    workspaceSwipeTouchX,
    workspaceSwipeStartOffsetPx,
    spacePanEnabled,
    spacePanDragging,
    suppressClickAfterPanRef,
    workspaceViewportTouchHandlers,
  };
}
