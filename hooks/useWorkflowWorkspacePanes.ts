import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { isWorkflowEditableTarget, isWorkflowLightboxHotkeySurface } from '../components/workflow/workflowDomUtils';

export type UseWorkflowWorkspacePanesArgs = {
  registerPaneWheelHandler?: (handler: ((e: ReactWheelEvent) => void) | null) => void;
  /** 为 false 时不响应空格框选（非工作区画布、无资产列表等） */
  enableSpaceMarquee?: boolean;
};

/**
 * 工作区「小盒子」页：0 = 资产列表（默认），1 = 能力预设。
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      /**
       * 仅在真正输入时让出。勿用 data-ac-block-workflow-marquee：
       * 快捷栏常驻该属性，且点击资产列表后焦点常仍留在栏上，会误禁空格框选。
       * 指针命中栏/遮罩的拦截由 WorkflowSpaceMarqueeChrome 的 target.closest 负责。
       */
      if (isWorkflowEditableTarget(e.target)) return;
      if (isWorkflowEditableTarget(document.activeElement)) return;
      /** 仅小盒子资产页（pane=0）可空格框选 */
      if (workspacePaneRef.current !== 0) return;
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
      if (isWorkflowEditableTarget(document.activeElement)) return;

      /** 1 = 小盒子预设页，2 = 小盒子资产页（默认）；0 同 1 */
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
      if (isWorkflowLightboxHotkeySurface()) return;
      e.preventDefault();
      snapWorkspacePaneToNode(pane);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [snapWorkspacePaneToNode]);

  return {
    workspacePane,
    setWorkspacePane,
    workspacePaneRef,
    snapWorkspacePaneToNode,
    handlePaneWheel,
    spaceMarqueeEnabled,
  };
}
