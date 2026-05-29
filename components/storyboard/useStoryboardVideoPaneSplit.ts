import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocalJson, writeLocalJson } from '../../services/clientPersist';
import {
  clampStoryboardVideoTimelineShare,
  storyboardVideoPaneHeights,
  STORYBOARD_VIDEO_SPLITTER_LAYOUT_PX,
  STORYBOARD_VIDEO_TIMELINE_SHARE_DEFAULT,
} from '../../services/storyboardVideoFit';

const STORAGE_KEY = 'ac_storyboard_video_timeline_share_v1';

export function useStoryboardVideoPaneSplit() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [timelineShare, setTimelineShare] = useState(() =>
    readLocalJson(STORAGE_KEY, STORYBOARD_VIDEO_TIMELINE_SHARE_DEFAULT, (v) =>
      typeof v === 'number' && Number.isFinite(v) ? clampStoryboardVideoTimelineShare(v) : null
    )
  );
  const [bodyHeight, setBodyHeight] = useState(0);
  const dragRef = useRef<{ startY: number; startShare: number; bodyH: number } | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { previewHeight, timelineHeight } = storyboardVideoPaneHeights(
    bodyHeight,
    timelineShare,
    STORYBOARD_VIDEO_SPLITTER_LAYOUT_PX
  );

  const onSplitterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      const bodyH = bodyRef.current?.getBoundingClientRect().height ?? bodyHeight;
      if (bodyH <= 0) return;
      dragRef.current = { startY: e.clientY, startShare: timelineShare, bodyH };
      target.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const usable = Math.max(1, drag.bodyH - STORYBOARD_VIDEO_SPLITTER_LAYOUT_PX);
        const startTimelineH = usable * drag.startShare;
        // 向上拖 = 时间轴变高（分隔条是时间轴上沿）
        const nextTimelineH = startTimelineH - (ev.clientY - drag.startY);
        const share = clampStoryboardVideoTimelineShare(nextTimelineH / usable);
        setTimelineShare(share);
      };

      const onUp = (ev: PointerEvent) => {
        dragRef.current = null;
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setTimelineShare((s) => {
          writeLocalJson(STORAGE_KEY, s);
          return s;
        });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [bodyHeight, timelineShare]
  );

  return {
    bodyRef,
    previewHeight,
    timelineHeight,
    splitterPx: STORYBOARD_VIDEO_SPLITTER_LAYOUT_PX,
    onSplitterPointerDown,
  };
}
