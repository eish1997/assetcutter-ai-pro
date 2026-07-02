import { useEffect, useState } from 'react';

/** 组件内本地计时，避免父级每秒 setState 触发整树重绘。 */
export function useExecutionElapsedSeconds(
  startedAt: number | null | undefined,
  active: boolean
): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active || startedAt == null || !Number.isFinite(startedAt)) {
      setElapsed(null);
      return;
    }
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);

  return active && startedAt != null ? elapsed : null;
}
