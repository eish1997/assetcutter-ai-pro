import type { StoryboardVideoLayer, StoryboardVideoSegment } from './storyboardVideoTimeline';

export const STORYBOARD_WEBM_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export type StoryboardVideoExportDrawOpts = {
  segment: StoryboardVideoSegment;
  progressInSegment: number;
  globalTime: number;
  totalDuration: number;
};

export type StoryboardVideoExportDrawFn = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: StoryboardVideoExportDrawOpts
) => Promise<void>;

export function pickStoryboardWebmMimeType(
  isSupported: (mime: string) => boolean = defaultMimeSupported
): string | null {
  for (const mime of STORYBOARD_WEBM_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

function defaultMimeSupported(mime: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime);
}

export function describeStoryboardWebmMime(mime: string): string {
  if (mime.includes('vp9')) return 'WebM · VP9';
  if (mime.includes('vp8')) return 'WebM · VP8';
  return 'WebM';
}

export function isStoryboardWebmExportAvailable(): boolean {
  return pickStoryboardWebmMimeType() != null;
}

export function countStoryboardExportFramesForDuration(totalDuration: number, fps = 30): number {
  return Math.max(1, Math.ceil(totalDuration * fps));
}

export function countStoryboardExportFrames(
  segments: { durationSec: number }[],
  fps = 30
): number {
  return segments.reduce(
    (sum, seg) => sum + Math.max(1, Math.round(seg.durationSec * fps)),
    0
  );
}

export async function exportStoryboardVideoWebmByTime(params: {
  width: number;
  height: number;
  totalDuration: number;
  fps?: number;
  drawAtTime: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    globalTime: number,
    totalDuration: number
  ) => Promise<void>;
  onProgress?: (progress: number) => void;
}): Promise<{ blob: Blob; mimeType: string }> {
  const { width, height, totalDuration, drawAtTime, onProgress } = params;
  const fps = params.fps ?? 30;
  if (totalDuration <= 0) {
    throw new Error('无可导出镜头');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持 MediaRecorder');
  }

  const mimeType = pickStoryboardWebmMimeType();
  if (!mimeType) {
    throw new Error('当前浏览器不支持 WebM 录制');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  const stream = canvas.captureStream(fps);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  } catch {
    throw new Error('无法启动 WebM 录制');
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('录制失败'));
  });

  recorder.start(250);
  const frameDelayMs = 1000 / fps;
  const totalFrames = countStoryboardExportFramesForDuration(totalDuration, fps);
  onProgress?.(0);

  for (let frame = 0; frame < totalFrames; frame++) {
    const globalTime = Math.min(totalDuration, (frame / fps));
    await drawAtTime(ctx, width, height, globalTime, totalDuration);
    await flushCanvasFrame();
    await sleep(frameDelayMs);
    onProgress?.(Math.min(1, (frame + 1) / totalFrames));
  }

  await sleep(120);
  onProgress?.(0.99);
  if (recorder.state === 'recording') {
    recorder.requestData();
    recorder.stop();
  }

  const blob = await done;
  if (blob.size < 128) {
    throw new Error('导出文件为空，请换用 Chrome / Edge 重试');
  }
  onProgress?.(1);
  return { blob, mimeType };
}

/** @deprecated 单轨顺序导出；新代码请用 exportStoryboardVideoWebmByTime */
export async function exportStoryboardVideoWebm(params: {
  width: number;
  height: number;
  segments: StoryboardVideoSegment[];
  totalDuration: number;
  fps?: number;
  drawFrame: StoryboardVideoExportDrawFn;
  onProgress?: (progress: number) => void;
}): Promise<{ blob: Blob; mimeType: string }> {
  const { width, height, segments, totalDuration, drawFrame, onProgress } = params;
  const fps = params.fps ?? 30;
  if (segments.length === 0 || totalDuration <= 0) {
    throw new Error('无可导出镜头');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持 MediaRecorder');
  }

  const mimeType = pickStoryboardWebmMimeType();
  if (!mimeType) {
    throw new Error('当前浏览器不支持 WebM 录制');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');

  const stream = canvas.captureStream(fps);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  } catch {
    throw new Error('无法启动 WebM 录制');
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('录制失败'));
  });

  recorder.start(250);
  let global = 0;
  const frameDelayMs = 1000 / fps;
  const totalFrames = countStoryboardExportFrames(segments, fps);
  let renderedFrames = 0;
  onProgress?.(0);

  for (const seg of segments) {
    const frames = Math.max(1, Math.round(seg.durationSec * fps));
    for (let f = 0; f < frames; f++) {
      const offset = (f / frames) * seg.durationSec;
      await drawFrame(ctx, width, height, {
        segment: seg,
        progressInSegment: offset,
        globalTime: global + offset,
        totalDuration,
      });
      await flushCanvasFrame();
      await sleep(frameDelayMs);
      renderedFrames += 1;
      onProgress?.(Math.min(1, renderedFrames / totalFrames));
    }
    global += seg.durationSec;
  }

  await sleep(120);
  onProgress?.(0.99);
  if (recorder.state === 'recording') {
    recorder.requestData();
    recorder.stop();
  }

  const blob = await done;
  if (blob.size < 128) {
    throw new Error('导出文件为空，请换用 Chrome / Edge 重试');
  }
  onProgress?.(1);
  return { blob, mimeType };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flushCanvasFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function downloadStoryboardWebmBlob(blob: Blob, _mimeType: string): string {
  const filename = storyboardWebmExportFilename();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

export function storyboardWebmExportFilename(ts = Date.now()): string {
  return `storyboard-preview-${ts}.webm`;
}

export type StoryboardVideoExportLayersDraw = {
  layers: StoryboardVideoLayer[];
  drawComposite: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    globalTime: number,
    totalDuration: number
  ) => Promise<void>;
};
