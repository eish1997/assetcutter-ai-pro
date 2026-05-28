import { useEffect, useState } from 'react';
import type { StoryboardTableRow } from '../../types';
import { storyboardRowDomId } from './storyboardTableDom';

/** 测量中间编辑行高度，供右侧合成卡 1:1 对齐 */
export function useStoryboardRowHeights(rows: StoryboardTableRow[]): Record<string, number> {
  const [heights, setHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next: Record<string, number> = {};
        for (const row of rows) {
          const el = document.getElementById(storyboardRowDomId(row.id));
          if (!el) continue;
          const h = Math.round(el.getBoundingClientRect().height);
          if (h > 0) next[row.id] = h;
        }
        setHeights((prev) => {
          if (
            rows.length > 0 &&
            rows.every((r) => prev[r.id] === next[r.id]) &&
            Object.keys(prev).length === rows.length
          ) {
            return prev;
          }
          return next;
        });
      });
    };

    const observers: ResizeObserver[] = [];
    for (const row of rows) {
      const el = document.getElementById(storyboardRowDomId(row.id));
      if (!el) continue;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      observers.forEach((ro) => ro.disconnect());
    };
  }, [rows]);

  return heights;
}
