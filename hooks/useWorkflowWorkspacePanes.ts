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
  /** 为 false 时不响应空格框选（非工作区画布、无资产列表等） */
  enableSpaceMarquee?: boolean;
};

export function useWorkflowWorkspacePanes({
  workspaceTrackRef,
  registerPaneWheelHandler,
  listPaneWidth,
  sidebarWidth,
  enableSpaceMarquee = false,
}: UseWorkflowWorkspacePanesArgs) {
  const [workspacePane, setWorkspacePane] = useState<number>(0);
  const workspacePaneRef = useRef<number>(0);
  const [workspaceSnapping, setWorkspaceSnapping] = useState(false);
  const workspaceSnapTimerRef = useRef<number | null>(null);
  const workspaceSwipeTouchX = useRef(0);
  const workspaceSwipeStartOffsetPx = useRef(0);
  const workspaceRafRef = useRef<number | null>(null);
  const workspaceNextPaneRef = useRef<number>(1);
  const [spaceMarqueeEnabled, setSpaceMarqueeEnabled] = useState(false);

  const setWorkspacePaneRaf = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
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
    const snapped = Math.max(0, Math.min(1, Math.round(base)));
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
   * 与 WorkflowSection 轨道 DOM 一致（左→右）：能力预设 | 功能区 | 工作区。
   * 语义档 0–1：0 功能区+工作区、1 能力+功能区；offset 越大卷轴越左移。
   */
  const paneToOffsetPx = useCallback(
    (pane: number) => {
      const L = listPaneWidth;
      const p = Math.max(0, Math.min(1, pane));
      return p === 1 ? 0 : L;
    },
    [listPaneWidth]
  );

  /** 与 paneToOffsetPx 互逆（连续 offset → 连续 pane），供触摸横滑跟手 */
  const offsetPxToPane = useCallback(
    (offset: number) => {
      const L = listPaneWidth;
      const x = Math.max(0, Math.min(L, offset));
      const den = Math.max(L, 1e-9);
      return 1 - x / den;
    },
    [listPaneWidth]
  );

  const applyWorkspacePaneImmediate = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
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
    if (!enableSpaceMarquee) {
      setSpaceMarqueeEnabled(false);
    }
  }, [enableSpaceMarquee]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (spaceMarqueeEnabled && enableSpaceMarquee) {
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.cursor = '';
    };
  }, [spaceMarqueeEnabled, enableSpaceMarquee]);

  useEffect(() => {
    if (!enableSpaceMarquee) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isWorkflowEditableTarget(e.target)) return;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      /** 勿用全局 querySelector：快捷栏常驻 data-ac-block-workflow-marquee，会误禁空格框选 */
      if (active?.closest('[data-ac-block-workflow-marquee]')) return;
      if (typeof document !== 'undefined' && !document.querySelector('[data-workflow-asset-list]')) return;
      e.preventDefault();
      setSpaceMarqueeEnabled(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpaceMarqueeEnabled(false);
    };
    const onBlur = () => {
      setSpaceMarqueeEnabled(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enableSpaceMarquee]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isWorkflowEditableTarget(e.target)) return;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (active?.closest('[data-ac-block-workflow-marquee]')) return;

      /** 与卷轴从左到右一致：1 能力+功能区、2 功能区+工作区；0 同 1（最左） */
      const paneByCode: Record<string, number> = {
        Digit1: 1,
        Digit2: 0,
        Digit0: 1,
        Numpad1: 1,
        Numpad2: 0,
        Numpad0: 1,
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
    spaceMarqueeEnabled,
    workspaceViewportTouchHandlers,
  };
}
