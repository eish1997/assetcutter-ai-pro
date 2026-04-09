import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent, type DragEvent as ReactDragEvent } from 'react';
import { DT_AC_CAPABILITY_ACTION } from '../services/workflowDragPipeline';

export type WorkflowCapabilityGutterDropConfig = {
  enabled: boolean;
  /** 将基础能力 id 标记为禁用（忽略 `set:` 复合能力） */
  onTryDisablePreset: (presetId: string) => boolean;
};

function dragTypesIncludeCapabilityAction(dt: DataTransfer | null): boolean {
  if (!dt?.types) return false;
  try {
    return Array.from(dt.types).includes(DT_AC_CAPABILITY_ACTION);
  } catch {
    return false;
  }
}

/**
 * 工作区画卷：主滚动层 capture 事件需绑在 App 的 `<main>` 上，子树通过 ref 注册实际处理函数。
 * 避免把框选/留白横滑逻辑塞进 WorkflowSection 却仍要命中「主区域两侧空白」。
 */
export function useWorkflowMainScrollCapture(
  isWorkflowMarqueeWheelActive: boolean,
  capabilityGutterDrop: WorkflowCapabilityGutterDropConfig | null = null
) {
  const workflowMainContentRef = useRef<HTMLDivElement | null>(null);
  const workflowMarqueeStartRef = useRef<((e: ReactMouseEvent) => void) | null>(null);
  const workflowPaneWheelRef = useRef<((e: ReactWheelEvent) => void) | null>(null);

  const registerMarqueeStart = useCallback((handler: ((e: ReactMouseEvent) => void) | null) => {
    workflowMarqueeStartRef.current = handler;
  }, []);

  const registerPaneWheel = useCallback((handler: ((e: ReactWheelEvent) => void) | null) => {
    workflowPaneWheelRef.current = handler;
  }, []);

  const onMainMouseDownCapture = useCallback(
    (e: ReactMouseEvent) => {
      if (!isWorkflowMarqueeWheelActive) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-ac-block-workflow-marquee]')) return;
      workflowMarqueeStartRef.current?.(e);
    },
    [isWorkflowMarqueeWheelActive]
  );

  const onMainWheelCapture = useCallback(
    (e: ReactWheelEvent) => {
      if (!isWorkflowMarqueeWheelActive) return;
      const target = e.target as Element | null;
      if (target?.closest('[data-ac-block-workflow-marquee]')) return;
      if (
        target?.closest(
          '[data-workflow-sidebar], [data-workflow-preset], [data-workflow-outline], [data-workflow-card], [data-workflow-library-card]'
        )
      ) {
        return;
      }
      const content = workflowMainContentRef.current;
      if (content) {
        const r = content.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) return;
      } else if (target?.closest('.max-w-6xl')) {
        return;
      }
      e.preventDefault();
      workflowPaneWheelRef.current?.(e);
    },
    [isWorkflowMarqueeWheelActive]
  );

  const isPointerInMainRightGutter = useCallback((clientX: number) => {
    const content = workflowMainContentRef.current;
    if (!content) return false;
    const r = content.getBoundingClientRect();
    return clientX > r.right;
  }, []);

  const onMainDragOverCapture = useCallback(
    (e: ReactDragEvent) => {
      const cfg = capabilityGutterDrop;
      if (!cfg?.enabled) return;
      if (!dragTypesIncludeCapabilityAction(e.dataTransfer)) return;
      if (!isPointerInMainRightGutter(e.clientX)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [capabilityGutterDrop, isPointerInMainRightGutter]
  );

  const onMainDropCapture = useCallback(
    (e: ReactDragEvent) => {
      const cfg = capabilityGutterDrop;
      if (!cfg?.enabled) return;
      if (!dragTypesIncludeCapabilityAction(e.dataTransfer)) return;
      if (!isPointerInMainRightGutter(e.clientX)) return;
      let id = '';
      try {
        id = e.dataTransfer.getData(DT_AC_CAPABILITY_ACTION) || e.dataTransfer.getData('text/plain') || '';
      } catch {
        id = '';
      }
      const trimmed = id.trim();
      if (!trimmed || trimmed.startsWith('set:')) return;
      if (!cfg.onTryDisablePreset(trimmed)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [capabilityGutterDrop, isPointerInMainRightGutter]
  );

  return {
    workflowMainContentRef,
    onMainMouseDownCapture,
    onMainWheelCapture,
    onMainDragOverCapture,
    onMainDropCapture,
    registerMarqueeStart,
    registerPaneWheel,
  };
}
