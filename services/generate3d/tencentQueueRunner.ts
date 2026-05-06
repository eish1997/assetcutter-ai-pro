import type { File3D, Submit3DProInput, Submit3DRapidInput, TencentCredentials } from '../tencentService';
import {
  convert3DFormat,
  startPartJob,
  startProfileTo3DJob,
  startReduceFaceJob,
  startTencent3DProJob,
  startTencent3DRapidJob,
  startTextureTo3DJob,
  startUVJob,
} from '../tencentService';

/** 与 `useGenerate3DManager` 中队列项 type 对齐；新增腾讯子能力时在此扩展 */
export type TencentGenerate3dQueueKind =
  | 'pro'
  | 'rapid'
  | 'convert'
  | 'topology'
  | 'texture'
  | 'component'
  | 'uv'
  | 'profile';

export type TencentQueueRunResult =
  | { kind: 'files'; files: File3D[] }
  | { kind: 'convert'; resultUrl: string };

type ProgressCb = (task: { status: string; progress: number }) => void;
type LogFn = (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;

/**
 * 执行一条腾讯混元 3D 队列任务（单连接、可 abort）。
 * 新增供应商时实现平行模块；此处保持腾讯 API 封装在 tencentService。
 */
export async function runTencentGenerate3dQueueItem(args: {
  jobType: TencentGenerate3dQueueKind;
  input: unknown;
  creds: TencentCredentials;
  signal: AbortSignal;
  onTaskProgress: ProgressCb;
  onLog: LogFn;
}): Promise<TencentQueueRunResult> {
  const { jobType, input, creds, signal, onTaskProgress, onLog } = args;
  const opt = { signal };

  if (jobType === 'pro') {
    const files = await startTencent3DProJob(
      input as Submit3DProInput,
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'rapid') {
    const files = await startTencent3DRapidJob(
      input as Submit3DRapidInput,
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'convert') {
    const { resultUrl } = await convert3DFormat(input as { fileUrl: string; format: string }, creds, opt);
    return { kind: 'convert', resultUrl };
  }
  if (jobType === 'topology') {
    const files = await startReduceFaceJob(
      { fileUrl: (input as { fileUrl: string }).fileUrl },
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'texture') {
    const inp = input as { modelUrl: string; prompt: string; imageBase64?: string };
    const files = await startTextureTo3DJob(
      { modelUrl: inp.modelUrl, prompt: inp.prompt?.trim() || undefined, imageBase64: inp.imageBase64 },
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'component') {
    const files = await startPartJob(
      { fileUrl: (input as { fileUrl: string }).fileUrl },
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'uv') {
    const files = await startUVJob(
      (input as { fileUrl: string }).fileUrl,
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  if (jobType === 'profile') {
    const files = await startProfileTo3DJob(
      { imageBase64: (input as { imageBase64: string }).imageBase64 },
      creds,
      onTaskProgress,
      (msg, detail) => onLog('info', msg, detail),
      opt
    );
    return { kind: 'files', files };
  }
  throw new Error(`未知腾讯3D队列类型: ${String(jobType)}`);
}
