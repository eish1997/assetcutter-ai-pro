import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryboardVideoSegment } from '../../services/storyboardVideoTimeline';
import {
  computeStoryboardVideoTotalDuration,
  findStoryboardSegmentAtTime,
} from '../../services/storyboardVideoTimeline';
import { drawStoryboardVideoFrame } from '../../services/storyboardVideoCanvas';

export function useStoryboardVideoPlayback(
  segments: StoryboardVideoSegment[],
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const totalDuration = computeStoryboardVideoTotalDuration(segments);
  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const rafRef = useRef(0);
  const playStartRef = useRef({ perf: 0, time: 0 });
  const timeSecRef = useRef(0);
  const segmentsRef = useRef(segments);
  const totalRef = useRef(totalDuration);
  segmentsRef.current = segments;
  totalRef.current = totalDuration;
  timeSecRef.current = timeSec;

  const renderAt = useCallback(
    async (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pos = findStoryboardSegmentAtTime(segmentsRef.current, t);
      if (!pos) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      await drawStoryboardVideoFrame(ctx, w, h, {
        segment: pos.segment,
        progressInSegment: pos.offsetInSegment,
        globalTime: pos.globalTime,
        totalDuration: totalRef.current,
      });
      setSegmentIndex(pos.segmentIndex);
    },
    [canvasRef]
  );

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(totalRef.current, t));
      setTimeSec(clamped);
      playStartRef.current = { perf: performance.now(), time: clamped };
      void renderAt(clamped);
    },
    [renderAt]
  );

  const pause = useCallback(() => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const play = useCallback(() => {
    if (totalRef.current <= 0) return;
    const t = timeSecRef.current;
    if (t >= totalRef.current - 0.02) {
      seek(0);
      playStartRef.current = { perf: performance.now(), time: 0 };
    } else {
      playStartRef.current = { perf: performance.now(), time: t };
    }
    setPlaying(true);
  }, [seek]);

  const togglePlay = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  useEffect(() => {
    void renderAt(timeSecRef.current);
  }, [renderAt, segments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      void renderAt(timeSecRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef, renderAt]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const elapsed = (performance.now() - playStartRef.current.perf) / 1000;
      const next = playStartRef.current.time + elapsed;
      if (next >= totalRef.current) {
        seek(totalRef.current);
        pause();
        return;
      }
      setTimeSec(next);
      void renderAt(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pause, playing, renderAt, seek]);

  useEffect(() => {
    if (timeSec > totalDuration) {
      seek(totalDuration);
    }
  }, [seek, timeSec, totalDuration]);

  const activeSegment = segments[segmentIndex] ?? segments[0] ?? null;

  return {
    playing,
    timeSec,
    totalDuration,
    segmentIndex,
    activeSegment,
    activeRowId: activeSegment?.rowId ?? null,
    seek,
    play,
    pause,
    togglePlay,
  };
}
