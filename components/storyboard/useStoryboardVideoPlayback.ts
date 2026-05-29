import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardParseFieldDef } from '../../types';
import type { StoryboardVideoLayer } from '../../services/storyboardVideoTimeline';
import {
  computeStoryboardVideoLayersTotalDuration,
  findStoryboardLayerSegmentForComposite,
  findStoryboardTopSegmentAtTime,
} from '../../services/storyboardVideoTimeline';
import {
  clearStoryboardVideoImageCache,
  drawStoryboardVideoCompositeFrame,
} from '../../services/storyboardVideoCanvas';

function storyboardFrameImageFingerprint(layers: StoryboardVideoLayer[]): string {
  const parts: string[] = [];
  for (const layer of layers) {
    for (const seg of layer.segments) {
      parts.push(`${seg.rowId}:${seg.frameImage ?? ''}`);
    }
  }
  return parts.join('|');
}

export function useStoryboardVideoPlayback(
  layers: StoryboardVideoLayer[],
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  overlay?: {
    fieldCatalog: StoryboardParseFieldDef[];
  }
) {
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const overlayFingerprint = useMemo(
    () => overlay?.fieldCatalog.map((f) => f.id).join(',') ?? '',
    [overlay?.fieldCatalog]
  );

  const totalDuration = computeStoryboardVideoLayersTotalDuration(layers);
  const frameImageFingerprint = useMemo(() => storyboardFrameImageFingerprint(layers), [layers]);

  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);

  const rafRef = useRef(0);
  const playStartRef = useRef({ perf: 0, time: 0 });
  const timeSecRef = useRef(0);
  const layersRef = useRef(layers);
  const totalRef = useRef(totalDuration);
  const renderGenRef = useRef(0);
  const pendingRenderTimeRef = useRef<number | null>(null);
  const renderLoopActiveRef = useRef(false);

  layersRef.current = layers;
  totalRef.current = totalDuration;
  timeSecRef.current = timeSec;

  const paintFrame = useCallback(
    async (t: number, gen: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const layerStates = layersRef.current
        .map((layer) => {
          const pos = findStoryboardLayerSegmentForComposite(layer, t);
          if (!pos) return null;
          return {
            layer: layer.layer,
            segment: pos.segment,
            progressInSegment: pos.offsetInSegment,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s != null);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      await drawStoryboardVideoCompositeFrame(ctx, w, h, {
        layerStates,
        globalTime: Math.min(t, totalRef.current),
        totalDuration: totalRef.current,
        fieldCatalog: overlayRef.current?.fieldCatalog ?? [],
      });

      if (gen !== renderGenRef.current) return;
      const top = findStoryboardTopSegmentAtTime(layersRef.current, t);
      setSegmentIndex(top?.segmentIndex ?? 0);
    },
    [canvasRef]
  );

  const flushRender = useCallback(async () => {
    if (renderLoopActiveRef.current) return;
    renderLoopActiveRef.current = true;
    try {
      while (pendingRenderTimeRef.current != null) {
        const t = pendingRenderTimeRef.current;
        pendingRenderTimeRef.current = null;
        const gen = ++renderGenRef.current;
        await paintFrame(t, gen);
      }
    } finally {
      renderLoopActiveRef.current = false;
      if (pendingRenderTimeRef.current != null) {
        void flushRender();
      }
    }
  }, [paintFrame]);

  const renderAt = useCallback(
    (t: number) => {
      pendingRenderTimeRef.current = t;
      void flushRender();
    },
    [flushRender]
  );

  const renderAtRef = useRef(renderAt);
  renderAtRef.current = renderAt;

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(totalRef.current, t));
      timeSecRef.current = clamped;
      setTimeSec(clamped);
      playStartRef.current = { perf: performance.now(), time: clamped };
      renderAt(clamped);
    },
    [renderAt]
  );

  const seekRef = useRef(seek);
  seekRef.current = seek;

  const pause = useCallback(() => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const play = useCallback(() => {
    if (totalRef.current <= 0) return;
    const t = timeSecRef.current;
    if (t >= totalRef.current - 0.02) {
      seekRef.current(0);
    } else {
      playStartRef.current = { perf: performance.now(), time: t };
    }
    setPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  // 分镜图变更时才清缓存；仅改时长不应反复 reload 图片
  useEffect(() => {
    clearStoryboardVideoImageCache();
    renderAtRef.current(timeSecRef.current);
  }, [frameImageFingerprint]);

  useEffect(() => {
    renderAtRef.current(timeSecRef.current);
  }, [overlayFingerprint]);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(timeSecRef.current, totalDuration));
    if (clamped !== timeSecRef.current) {
      timeSecRef.current = clamped;
      setTimeSec(clamped);
      if (playing) {
        playStartRef.current = { perf: performance.now(), time: clamped };
      }
    }
    renderAtRef.current(clamped);
  }, [layers, totalDuration, playing, overlayFingerprint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      renderAtRef.current(timeSecRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    if (!playing) return;

    const tick = () => {
      const elapsed = (performance.now() - playStartRef.current.perf) / 1000;
      const next = Math.min(totalRef.current, playStartRef.current.time + elapsed);

      timeSecRef.current = next;
      setTimeSec(next);
      renderAtRef.current(next);

      if (next >= totalRef.current - 1e-6) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const topAtTime = findStoryboardTopSegmentAtTime(layers, timeSec);
  const activeSegment = topAtTime?.segment ?? layers[0]?.segments[segmentIndex] ?? layers[0]?.segments[0] ?? null;

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
