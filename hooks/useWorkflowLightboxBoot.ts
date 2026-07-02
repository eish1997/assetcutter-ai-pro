import { useCallback, useRef, useState } from 'react';

/** 工作流大图分阶段启动：T0 壳 → T1 占位 → T2 主图 → T3 重型 chrome */
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
  const rafRef = useRef<number | null>(null);
  const t3TimerRef = useRef<number | null>(null);
  const t3ScheduledRef = useRef(false);

  const cancelPending = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (t3TimerRef.current != null) {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(t3TimerRef.current);
      } else {
        window.clearTimeout(t3TimerRef.current);
      }
      t3TimerRef.current = null;
    }
    t3ScheduledRef.current = false;
  }, []);

  const reset = useCallback(() => {
    cancelPending();
    setPhase(null);
  }, [cancelPending]);

  const scheduleT3 = useCallback(() => {
    if (t3ScheduledRef.current) return;
    t3ScheduledRef.current = true;
    const run = () => {
      t3TimerRef.current = null;
      setPhase('t3');
    };
    if (typeof requestIdleCallback !== 'undefined') {
      t3TimerRef.current = requestIdleCallback(run, { timeout: 480 }) as unknown as number;
    } else {
      t3TimerRef.current = window.setTimeout(run, 120);
    }
  }, []);

  const beginOpen = useCallback(
    (onT1?: () => void) => {
      cancelPending();
      setPhase('t0');
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setPhase('t1');
        onT1?.();
      });
    },
    [cancelPending]
  );

  const notifyPrimaryImageReady = useCallback(() => {
    setPhase((prev) => {
      if (!prev || prev === 't3') return prev;
      if (WORKFLOW_LIGHTBOX_BOOT_RANK[prev] >= 2) return prev;
      return 't2';
    });
    scheduleT3();
  }, [scheduleT3]);

  return {
    phase,
    beginOpen,
    reset,
    notifyPrimaryImageReady,
    isChromeReady: phase === 't3',
  };
}
