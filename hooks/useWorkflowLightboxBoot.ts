import { useCallback, useState } from 'react';

/** 工作流大图分阶段启动：打开即 T3，避免先全宽再缩进。 */
export type WorkflowLightboxBootPhase = 't0' | 't1' | 't2' | 't3';

export const WORKFLOW_LIGHTBOX_BOOT_RANK: Record<WorkflowLightboxBootPhase, number> = {
  t0: 0,
  t1: 1,
  t2: 2,
  t3: 3,
};

export function isWorkflowLightboxBootAtLeast(
  phase: WorkflowLightboxBootPhase | null | undefined,
  min: WorkflowLightboxBootPhase
): boolean {
  if (!phase) return false;
  return WORKFLOW_LIGHTBOX_BOOT_RANK[phase] >= WORKFLOW_LIGHTBOX_BOOT_RANK[min];
}

export function useWorkflowLightboxBoot() {
  const [phase, setPhase] = useState<WorkflowLightboxBootPhase | null>(null);

  const reset = useCallback(() => {
    setPhase(null);
  }, []);

  const beginOpen = useCallback((onT1?: () => void) => {
    setPhase('t3');
    onT1?.();
  }, []);

  const notifyPrimaryImageReady = useCallback(() => {
    setPhase('t3');
  }, []);

  return {
    phase,
    beginOpen,
    reset,
    notifyPrimaryImageReady,
    isChromeReady: phase === 't3',
  };
}
