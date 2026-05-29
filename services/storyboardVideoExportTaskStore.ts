import type { StoryboardTableRow } from '../types';
import { readLocalJson } from './clientPersist';
import {
  getStoryboardVideoAspectPreset,
  STORYBOARD_VIDEO_ASPECT_PRESETS,
  STORYBOARD_VIDEO_ASPECT_STORAGE_KEY,
  type StoryboardVideoAspectPresetId,
} from './storyboardVideoAspect';
import {
  drawStoryboardVideoCompositeFrame,
} from './storyboardVideoCanvas';
import {
  buildStoryboardVideoLayers,
  computeStoryboardVideoLayersTotalDuration,
  findStoryboardLayerSegmentForComposite,
  resolveStoryboardTimelineLayerCount,
} from './storyboardVideoTimeline';
import {
  describeStoryboardWebmMime,
  downloadStoryboardWebmBlob,
  exportStoryboardVideoWebmByTime,
  isStoryboardWebmExportAvailable,
} from './storyboardVideoExport';

export type StoryboardVideoExportTaskState = {
  id: string;
  assetId: string;
  assetTitle: string;
  progress: number;
  status: 'running' | 'success' | 'error';
  errorMessage?: string;
};

type NotifyFn = (level: 'info' | 'warn', message: string) => void;

let activeTask: StoryboardVideoExportTaskState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeStoryboardVideoExport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStoryboardVideoExportSnapshot(): StoryboardVideoExportTaskState | null {
  return activeTask;
}

export function isStoryboardVideoExportRunning(): boolean {
  return activeTask?.status === 'running';
}

export function canExportStoryboardVideo(
  rows: StoryboardTableRow[],
  timelineLayerCount?: number
): boolean {
  if (!isStoryboardWebmExportAvailable()) return false;
  const count = resolveStoryboardTimelineLayerCount(rows, timelineLayerCount);
  const layers = buildStoryboardVideoLayers(rows, count);
  return layers.some((l) => l.segments.length > 0 && l.totalDuration > 0);
}

function readStoryboardVideoAspectId(): StoryboardVideoAspectPresetId {
  return readLocalJson(STORYBOARD_VIDEO_ASPECT_STORAGE_KEY, '16:9', (v) =>
    STORYBOARD_VIDEO_ASPECT_PRESETS.some((p) => p.id === v) ? (v as StoryboardVideoAspectPresetId) : null
  );
}

function clearTaskLater(taskId: string, ms: number): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    if (activeTask?.id === taskId && activeTask.status !== 'running') {
      activeTask = null;
      emit();
    }
  }, ms);
}

export async function startStoryboardVideoExportTask(params: {
  assetId: string;
  assetTitle: string;
  rows: StoryboardTableRow[];
  timelineLayerCount?: number;
  onNotify?: NotifyFn;
}): Promise<void> {
  const { assetId, assetTitle, rows, timelineLayerCount, onNotify } = params;

  if (activeTask?.status === 'running') {
    onNotify?.('warn', '已有分镜视频导出任务进行中，请稍候');
    return;
  }
  if (!canExportStoryboardVideo(rows, timelineLayerCount)) {
    if (!isStoryboardWebmExportAvailable()) {
      onNotify?.('warn', '当前浏览器不支持 WebM 导出，请使用 Chrome 或 Edge');
    } else {
      onNotify?.('warn', '无可导出镜头，请先添加镜头并配图');
    }
    return;
  }

  const layerCount = resolveStoryboardTimelineLayerCount(rows, timelineLayerCount);
  const layers = buildStoryboardVideoLayers(rows, layerCount);
  const totalDuration = computeStoryboardVideoLayersTotalDuration(layers);
  const aspect = getStoryboardVideoAspectPreset(readStoryboardVideoAspectId());
  const taskId = `sb-export-${Date.now()}`;

  activeTask = {
    id: taskId,
    assetId,
    assetTitle: assetTitle.trim() || '分镜表',
    progress: 0,
    status: 'running',
  };
  emit();

  let lastEmittedPct = -1;

  try {
    const { blob, mimeType } = await exportStoryboardVideoWebmByTime({
      width: aspect.width,
      height: aspect.height,
      totalDuration,
      drawAtTime: async (ctx, width, height, globalTime, dur) => {
        const layerStates = layers
          .map((layer) => {
            const pos = findStoryboardLayerSegmentForComposite(layer, globalTime);
            if (!pos) return null;
            return {
              layer: layer.layer,
              segment: pos.segment,
              progressInSegment: pos.offsetInSegment,
            };
          })
          .filter((s): s is NonNullable<typeof s> => s != null);
        await drawStoryboardVideoCompositeFrame(ctx, width, height, {
          layerStates,
          globalTime,
          totalDuration: dur,
        });
      },
      onProgress: (progress) => {
        if (!activeTask || activeTask.id !== taskId) return;
        const pct = Math.floor(progress * 100);
        if (pct === lastEmittedPct && progress < 1) return;
        lastEmittedPct = pct;
        activeTask = { ...activeTask, progress };
        emit();
      },
    });
    if (!activeTask || activeTask.id !== taskId) return;

    const filename = downloadStoryboardWebmBlob(blob, mimeType);
    activeTask = { ...activeTask, progress: 1, status: 'success' };
    emit();
    onNotify?.(
      'info',
      `分镜导出完成：${filename} 已保存到浏览器下载文件夹（${describeStoryboardWebmMime(mimeType)} · ${aspect.width}×${aspect.height} · ${(blob.size / 1024 / 1024).toFixed(1)}MB）`
    );
    clearTaskLater(taskId, 4000);
  } catch (e) {
    if (!activeTask || activeTask.id !== taskId) return;
    const message = e instanceof Error ? e.message : '导出失败';
    activeTask = {
      id: taskId,
      assetId,
      assetTitle: assetTitle.trim() || '分镜表',
      progress: activeTask.progress,
      status: 'error',
      errorMessage: message,
    };
    emit();
    onNotify?.('warn', `分镜导出失败：${message}`);
    clearTaskLater(taskId, 6000);
  }
}
