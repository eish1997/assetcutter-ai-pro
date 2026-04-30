import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  const [workspacePane, setWorkspacePane] = useState<number>(1);
  const workspacePaneRef = useRef<number>(1);
  const [workspaceSnapping, setWorkspaceSnapping] = useState(false);
  const workspaceSnapTimerRef = useRef<number | null>(null);
  const workspaceSwipeTouchX = useRef(0);
  const workspaceSwipeStartOffsetPx = useRef(0);
  const workspaceRafRef = useRef<number | null>(null);
  const workspaceNextPaneRef = useRef<number>(2);
  const [spacePanEnabled, setSpacePanEnabled] = useState(false);
  const [spacePanDragging, setSpacePanDragging] = useState(false);
  const suppressClickAfterPanRef = useRef(false);

  const setWorkspacePaneRaf = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(2, next));
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
    const snapped = Math.max(0, Math.min(2, Math.round(base)));
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

  /**
   * 与 WorkflowSection 轨道 DOM 一致（左→右）：能力预设 | 功能区 | 工作区 | 大纲（无独立「仓库」列）。
   * 语义档 0–2：0 工作区+大纲、1 功能区+工作区、2 能力+功能区；offset 越大卷轴越左移。
   */
  const paneToOffsetPx = useCallback(
    (pane: number) => {
      const W = sidebarWidth;
      const L = listPaneWidth;
      const p = Math.max(0, Math.min(2, pane));
      if (p <= 1) return (L + W) - W * p;
      return L * (2 - p);
    },
    [listPaneWidth, sidebarWidth]
  );

  /** 与 paneToOffsetPx 互逆（连续 offset → 连续 pane），供空格拖拽跟手 */
  const offsetPxToPane = useCallback(
    (offset: number) => {
      const W = sidebarWidth;
      const L = listPaneWidth;
      const max = L + W;
      const x = Math.max(0, Math.min(max, offset));
      const den = 1e-9;
      if (x < L) return 2 - x / Math.max(L, den);
      return 1 - (x - L) / Math.max(W, den);
    },
    [listPaneWidth, sidebarWidth]
  );

  const applyWorkspacePaneImmediate = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(2, next));
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
      // 滚轮切换页面功能已禁用
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  useEffect(() => {
    if (!registerPaneWheelHandler) return;
    registerPaneWheelHandler(handlePaneWheel);
    return () => registerPaneWheelHandler(null);
  }, [registerPaneWheelHandler, handlePaneWheel]);

  const workspaceOffsetPx = paneToOffsetPx(workspacePane);

  useLayoutEffect(() => {
    workspacePaneRef.current = workspacePane;
    const track = workspaceTrackRef.current;
    if (!track) return;
    track.style.transition = workspaceSnapping
      ? `transform ${WORKSPACE_SNAP_DURATION_MS}ms ${WORKSPACE_SNAP_EASING}`
      : 'none';
    track.style.transform = `translate3d(${-workspaceOffsetPx}px, 0, 0)`;
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

      /** 与卷轴从左到右一致：1 能力+功能区、2 功能区+工作区、3 工作区+大纲；0 同 1（最左） */
      const paneByCode: Record<string, number> = {
        Digit1: 2,
        Digit2: 1,
        Digit3: 0,
        Digit0: 2,
        Numpad1: 2,
        Numpad2: 1,
        Numpad3: 0,
        Numpad0: 2,
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
