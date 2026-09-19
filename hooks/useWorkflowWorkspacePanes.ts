import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { isWorkflowEditableTarget, isWorkflowSpaceKey } from '../components/workflow/workflowDomUtils';

function isPointerOverAssetList(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') return false;
  const top = document.elementFromPoint(clientX, clientY);
  if (!top) return false;
  if (top.closest('[data-workflow-quick-compose-bar], [data-workflow-quick-compose-dock-host], [data-workflow-quick-compose-chat-dock]')) {
    return false;
  }
  return Boolean(top.closest('[data-workflow-asset-list]'));
}

export type UseWorkflowWorkspacePanesArgs = {
  registerPaneWheelHandler?: (handler: ((e: ReactWheelEvent) => void) | null) => void;
  /** 为 false 时不响应空格框选（非工作区画布、无资产列表等） */
  enableSpaceMarquee?: boolean;
};

/**
 * 工作区「小盒子」页：资产列表（默认）。能力预设已并入左树「预设」根。
 * 大盒子固定布局，不再整轨横向卷轴平移。
 */
export function useWorkflowWorkspacePanes({
  registerPaneWheelHandler,
  enableSpaceMarquee = false,
}: UseWorkflowWorkspacePanesArgs) {
  const [workspacePane, setWorkspacePane] = useState<number>(0);
  const workspacePaneRef = useRef<number>(0);
  const [spaceMarqueeEnabled, setSpaceMarqueeEnabled] = useState(false);

  const snapWorkspacePaneToNode = useCallback((rawPane?: number) => {
    const base = typeof rawPane === 'number' ? rawPane : workspacePaneRef.current;
    const snapped = Math.max(0, Math.min(1, Math.round(base)));
    workspacePaneRef.current = snapped;
    setWorkspacePane(snapped);
  }, []);

  useEffect(() => {
    workspacePaneRef.current = workspacePane;
  }, [workspacePane]);

  const handlePaneWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!registerPaneWheelHandler) return;
    registerPaneWheelHandler(handlePaneWheel);
    return () => registerPaneWheelHandler(null);
  }, [registerPaneWheelHandler, handlePaneWheel]);

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
    const pointerOverListRef = { current: false };
    const canArmMarquee = (): boolean => {
      if (workspacePaneRef.current !== 0) return false;
      if (typeof document === 'undefined' || !document.querySelector('[data-workflow-asset-list]')) return false;
      /**
       * 快捷栏常把焦点留在输入框。鼠标已在资产列表上时仍进入框选，
       * 不要因为 activeElement 是 textarea 就让出。
       */
      if (isWorkflowEditableTarget(document.activeElement) && !pointerOverListRef.current) return false;
      return true;
    };
    const armMarquee = () => {
      if (!canArmMarquee()) return false;
      if (isWorkflowEditableTarget(document.activeElement) && pointerOverListRef.current) {
        try {
          (document.activeElement as HTMLElement).blur();
        } catch {
          /* ignore */
        }
      }
      setSpaceMarqueeEnabled(true);
      return true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isWorkflowSpaceKey(e)) return;
      if (isWorkflowEditableTarget(e.target) && !pointerOverListRef.current) return;
      if (!canArmMarquee()) return;
      e.preventDefault();
      if (e.repeat) return;
      armMarquee();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isWorkflowSpaceKey(e)) return;
      setSpaceMarqueeEnabled(false);
    };
    const onBlur = () => {
      if (typeof document !== 'undefined' && document.hasFocus()) return;
      setSpaceMarqueeEnabled(false);
    };
    const onPointerMove = (e: PointerEvent) => {
      pointerOverListRef.current = isPointerOverAssetList(e.clientX, e.clientY);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    const api = typeof window !== 'undefined' ? window.assetCutterWorkbench : undefined;
    const unsubIpc =
      api && typeof api.onSpaceMarquee === 'function'
        ? api.onSpaceMarquee((down) => {
            if (!down) {
              setSpaceMarqueeEnabled(false);
              return;
            }
            /** 壳侧已确认光标在工作台 BrowserView 内，避免指针事件没进页面时误拒 */
            pointerOverListRef.current = true;
            armMarquee();
          })
        : undefined;
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      unsubIpc?.();
    };
  }, [enableSpaceMarquee]);

  return {
    workspacePane,
    setWorkspacePane,
    workspacePaneRef,
    snapWorkspacePaneToNode,
    handlePaneWheel,
    spaceMarqueeEnabled,
  };
}
