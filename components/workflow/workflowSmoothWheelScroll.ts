/** 滚轮目标 scrollTop；多帧 lerp 逼近，避免 scrollTop+=dy 的「一格一跳」 */
export type SmoothWheelScrollController = {
  pushDelta: (dy: number) => void;
  cancel: () => void;
};

export function createSmoothWheelScrollController(
  getContainer: () => HTMLElement | null,
  options?: { lerp?: number; snapEpsilon?: number }
): SmoothWheelScrollController {
  const lerp = options?.lerp ?? 0.28;
  const snapEpsilon = options?.snapEpsilon ?? 0.75;
  let targetScrollTop: number | null = null;
  let rafId: number | null = null;

  const clampTarget = (el: HTMLElement, value: number) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, Math.min(max, value));
  };

  const tick = () => {
    rafId = null;
    const el = getContainer();
    if (!el || targetScrollTop == null) return;

    const current = el.scrollTop;
    const diff = targetScrollTop - current;
    if (Math.abs(diff) <= snapEpsilon) {
      el.scrollTop = targetScrollTop;
      targetScrollTop = null;
      return;
    }

    el.scrollTop = current + diff * lerp;
    rafId = window.requestAnimationFrame(tick);
  };

  const schedule = () => {
    if (rafId != null || typeof window === 'undefined') return;
    rafId = window.requestAnimationFrame(tick);
  };

  return {
    pushDelta(dy: number) {
      if (!Number.isFinite(dy) || Math.abs(dy) < 0.1) return;
      const el = getContainer();
      if (!el) return;
      const base = targetScrollTop ?? el.scrollTop;
      targetScrollTop = clampTarget(el, base + dy);
      schedule();
    },
    cancel() {
      if (rafId != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      targetScrollTop = null;
    },
  };
}
