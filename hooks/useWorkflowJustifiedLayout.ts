import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import {
  computeWorkflowJustifiedLayout,
  type WorkflowJustifiedLayoutInput,
  type WorkflowJustifiedLayoutOptions,
} from '../services/workflowJustifiedLayout';

export function useWorkflowJustifiedLayout(
  items: WorkflowJustifiedLayoutInput[],
  containerRef: RefObject<HTMLElement | null>,
  options: WorkflowJustifiedLayoutOptions & { remeasureKey?: string | number | boolean | null }
) {
  const [containerWidth, setContainerWidth] = useState(0);
  const gap = options.gap;
  const targetRowHeight = options.targetRowHeight;
  const maxRowHeight = options.maxRowHeight;
  const remeasureKey = options.remeasureKey;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      setContainerWidth(0);
      return;
    }
    const update = () => {
      const w = Math.floor(el.clientWidth);
      setContainerWidth((prev) => (prev === w ? prev : w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, items.length, remeasureKey]);

  const layout = useMemo(
    () => computeWorkflowJustifiedLayout(items, containerWidth, options),
    [items, containerWidth, gap, targetRowHeight, maxRowHeight]
  );

  const boxById = useMemo(() => {
    const map = new Map<string, (typeof layout.boxes)[number]>();
    for (const box of layout.boxes) map.set(box.id, box);
    return map;
  }, [layout.boxes]);

  return { ...layout, boxById, ready: containerWidth > 0 };
}
