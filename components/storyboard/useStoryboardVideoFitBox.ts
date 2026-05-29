import { useEffect, useState } from 'react';
import type { StoryboardVideoAspectPreset } from '../../services/storyboardVideoAspect';
import { fitStoryboardAspectInBoxFromPreset } from '../../services/storyboardVideoFit';

const PAD = 16;

/** 测量预览区可用空间，计算 contain 画幅像素尺寸 */
export function useStoryboardVideoFitBox(
  paneRef: React.RefObject<HTMLElement | null>,
  aspect: StoryboardVideoAspectPreset
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const availW = Math.max(0, rect.width - PAD * 2);
      const availH = Math.max(0, rect.height - PAD * 2);
      const next = fitStoryboardAspectInBoxFromPreset(availW, availH, aspect);
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [aspect, paneRef]);

  return size;
}
