import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppTask } from '../types';
import {
  getTencentCredsFromEnv,
  isUnsafeTencentBrowserModeEnabled,
  type File3D,
  type TencentCredentials,
} from '../services/unifiedAiGateway';
import { runTencentGenerate3dQueueItem, type TencentGenerate3dQueueKind } from '../services/generate3d';
import { extractTripoModelAndPreviewUrls } from '../services/generate3d/tripoWorkflow';
import { getTripoTask } from '../services/tripoService';

function inferTripoModelFileType(url: string, index: number): string {
  const u = String(url).split(/[?#]/)[0].toLowerCase();
  const m = u.match(/\.(glb|gltf|fbx|obj|stl|usdz|usd|3mf)$/i);
  if (m) return m[1].toUpperCase();
  return `FILE_${index + 1}`;
}

export interface Temp3DItem {
  id: string;
  label: string;
  previewImageUrl?: string;
  files: File3D[];
  timestamp: number;
  source: 'pro' | 'rapid' | 'convert' | 'topology' | 'texture' | 'component' | 'uv' | 'profile' | 'tripo_recover';
}

export interface Generate3DQueueItem {
  id: string;
  type: 'pro' | 'rapid' | 'convert' | 'topology' | 'texture' | 'component' | 'uv' | 'profile';
  status: 'pending' | 'running' | 'done' | 'fail' | 'cancelled';
  progress?: number;
  input?: unknown;
  result?: File3D[] | { resultUrl: string };
  error?: string;
  taskId?: string;
  label?: string;
}

export function applyGenerate3DQueueCancellation(
  queue: Generate3DQueueItem[],
  jobId: string
): { nextQueue: Generate3DQueueItem[]; cancelledItem?: Generate3DQueueItem } {
  const target = queue.find((item) => item.id === jobId);
  if (!target || (target.status !== 'pending' && target.status !== 'running')) {
    return { nextQueue: queue };
  }
  const cancelledItem: Generate3DQueueItem = {
    ...target,
    status: 'cancelled',
    error: '用户已取消',
  };
  return {
    cancelledItem,
    nextQueue: queue.map((item) => item.id === jobId ? cancelledItem : item),
  };
}

export function applyGenerate3DQueueRetry(
  queue: Generate3DQueueItem[],
  jobId: string
): { nextQueue: Generate3DQueueItem[]; retriedItem?: Generate3DQueueItem } {
  const target = queue.find((item) => item.id === jobId);
  if (!target || (target.status !== 'fail' && target.status !== 'cancelled')) {
    return { nextQueue: queue };
  }
  const retriedItem: Generate3DQueueItem = {
    ...target,
    status: 'pending',
    progress: 0,
    error: undefined,
    result: undefined,
  };
  return {
    retriedItem,
    nextQueue: queue.map((item) => item.id === jobId ? retriedItem : item),
  };
}

export function clearInactiveGenerate3DQueue(queue: Generate3DQueueItem[]): Generate3DQueueItem[] {
  return queue.filter((item) => item.status === 'pending' || item.status === 'running');
}

export function consumeCancelledGenerate3DQueueJob(cancelledJobIds: Set<string>, jobId: string): boolean {
  if (!cancelledJobIds.has(jobId)) return false;
  cancelledJobIds.delete(jobId);
  return true;
}

type UseGenerate3DManagerOptions = {
  credsOverride: { secretId: string; secretKey: string } | null;
  onLog: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  maxConcurrent?: number;
};

export function useGenerate3DManager({
  credsOverride,
  onLog,
  updateTask,
  maxConcurrent = 2,
}: UseGenerate3DManagerOptions) {
  const [temp3DLibrary, setTemp3DLibrary] = useState<Temp3DItem[]>([]);
  const [selectedTemp3DId, setSelectedTemp3DId] = useState<string | null>(null);
  const [generate3DQueue, setGenerate3DQueue] = useState<Generate3DQueueItem[]>([]);
  const activeJobControllersRef = useRef(new Map<string, AbortController>());
  const cancelledJobIdsRef = useRef(new Set<string>());

  const unsafeTencentBrowserCredsEnabled = isUnsafeTencentBrowserModeEnabled();
  const creds3D = useMemo<TencentCredentials | null>(() => {
    const fromEnv = getTencentCredsFromEnv();
    if (fromEnv?.proxyUrl) return fromEnv;
    if (fromEnv?.secretId && fromEnv?.secretKey) return fromEnv;
    if (unsafeTencentBrowserCredsEnabled && credsOverride?.secretId?.trim() && credsOverride?.secretKey) {
      return { secretId: credsOverride.secretId.trim(), secretKey: credsOverride.secretKey };
    }
    return null;
  }, [credsOverride, unsafeTencentBrowserCredsEnabled]);

  const generate3DPreview = useMemo(() => {
    const item = selectedTemp3DId ? temp3DLibrary.find((entry) => entry.id === selectedTemp3DId) : temp3DLibrary[0];
    if (!item?.files?.length) return null;
    const normalizeType = (value: string) => (value || '').toUpperCase();
    const glb = item.files.find((file) => normalizeType(file.Type || '') === 'GLB');
    if (glb?.Url) return { url: glb.Url, format: 'glb' as const };
    const obj = item.files.find((file) => normalizeType(file.Type || '') === 'OBJ');
    if (obj?.Url) return { url: obj.Url, format: 'obj' as const };
    const first = item.files[0];
    if (!first?.Url) return null;
    return { url: first.Url, format: (/\.obj$/i.test(first.Url) ? 'obj' : 'glb') as 'glb' | 'obj' };
  }, [selectedTemp3DId, temp3DLibrary]);

  const appendQueueItem = useCallback((item: Omit<Generate3DQueueItem, 'status'> & { status?: Generate3DQueueItem['status'] }) => {
    setGenerate3DQueue((prev) => [...prev, { ...item, status: item.status ?? 'pending' }]);
  }, []);

  const markQueueItem = useCallback((jobId: string, patch: Partial<Generate3DQueueItem>) => {
    setGenerate3DQueue((prev) => prev.map((item) => (item.id === jobId ? { ...item, ...patch } : item)));
  }, []);

  const cancelQueueItem = useCallback((jobId: string) => {
    setGenerate3DQueue((prev) => {
      const { nextQueue, cancelledItem } = applyGenerate3DQueueCancellation(prev, jobId);
      if (!cancelledItem) return prev;
      cancelledJobIdsRef.current.add(jobId);
      if (cancelledItem.taskId) {
        updateTask(cancelledItem.taskId, {
          status: 'FAILED',
          error: '用户已取消',
          message: '已取消',
        });
      }
      onLog('info', `[队列] 已取消 ${cancelledItem.label || cancelledItem.type}`, { jobId, status: cancelledItem.status });
      return nextQueue;
    });

    const controller = activeJobControllersRef.current.get(jobId);
    if (controller) {
      activeJobControllersRef.current.delete(jobId);
      controller.abort();
    }
  }, [onLog, updateTask]);

  const retryQueueItem = useCallback((jobId: string) => {
    setGenerate3DQueue((prev) => {
      const { nextQueue, retriedItem } = applyGenerate3DQueueRetry(prev, jobId);
      if (!retriedItem) return prev;
      cancelledJobIdsRef.current.delete(jobId);
      if (retriedItem.taskId) {
        updateTask(retriedItem.taskId, {
          status: 'PENDING',
          progress: 0,
          error: undefined,
          message: '排队中...',
        });
      }
      onLog('info', `[队列] 已重新加入 ${retriedItem.label || retriedItem.type}`, { jobId });
      return nextQueue;
    });
  }, [onLog, updateTask]);

  const clearInactiveQueueItems = useCallback(() => {
    setGenerate3DQueue((prev) => {
      const nextQueue = clearInactiveGenerate3DQueue(prev);
      if (nextQueue.length !== prev.length) {
        onLog('info', '[队列] 已清理非活跃任务', { removed: prev.length - nextQueue.length });
      }
      return nextQueue;
    });
  }, [onLog]);

  const complete3DJobWithFiles = useCallback((
    jobId: string,
    taskId: string | undefined,
    files: File3D[],
    label: string,
    source: Temp3DItem['source']
  ) => {
    const newItem: Temp3DItem = {
      id: jobId,
      label,
      previewImageUrl: files[0]?.PreviewImageUrl,
      files,
      timestamp: Date.now(),
      source,
    };
    setTemp3DLibrary((prev) => [...prev, newItem]);
    setSelectedTemp3DId(jobId);
    markQueueItem(jobId, { status: 'done', result: files });
    if (taskId) updateTask(taskId, { status: 'SUCCESS', progress: 100, result: files });
    onLog('info', `[队列] ${label} 完成`, { fileCount: files.length });
  }, [markQueueItem, onLog, updateTask]);

  const importTripoTaskToTempLibrary = useCallback(
    async (apiKey: string, tripoTaskId: string) => {
      const id = String(tripoTaskId || '').trim();
      if (!id) throw new Error('请输入有效的 tripoTaskId');
      const k = String(apiKey || '').trim();
      if (!k) throw new Error('缺少 Tripo API Key');
      const done = await getTripoTask(k, id);
      if (done.status === 'failed') {
        throw new Error('Tripo 任务状态为 failed，无法取回模型');
      }
      if (done.status !== 'success') {
        throw new Error(`Tripo 任务尚未完成，当前状态：${done.status}。请稍后重试或在 Tripo 控制台查看进度。`);
      }
      const { modelUrls, previewUrl } = extractTripoModelAndPreviewUrls(done);
      if (!modelUrls.length) {
        throw new Error('Tripo 任务已成功，但未解析到可下载的模型 URL（可能已被清理或响应结构变化）');
      }
      const files: File3D[] = modelUrls.map((u, i) => ({
        Type: inferTripoModelFileType(u, i),
        Url: u,
        ...(i === 0 && previewUrl ? { PreviewImageUrl: previewUrl } : {}),
      }));
      const jobId = `tripo_recover_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      const short = id.length > 18 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id;
      complete3DJobWithFiles(jobId, undefined, files, `Tripo 恢复 ${short}`, 'tripo_recover');
      onLog('info', '[Tripo 恢复] 已加入临时库', { taskId: id, modelCount: files.length });
    },
    [complete3DJobWithFiles, onLog]
  );

  const onProgress3D = useCallback((taskId: string | undefined) => (task: { status: string; progress: number }) => {
    if (!taskId) return;
    const status = task.status === 'DONE' ? 'SUCCESS' : task.status === 'FAIL' ? 'FAILED' : 'RUNNING';
    updateTask(taskId, { status, progress: task.progress });
  }, [updateTask]);

  useEffect(() => () => {
    activeJobControllersRef.current.forEach((controller) => controller.abort());
    activeJobControllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!creds3D) return;
    const running = generate3DQueue.filter((item) => item.status === 'running').length;
    if (running >= maxConcurrent) return;
    const pending = generate3DQueue.find((item) => item.status === 'pending');
    if (!pending) return;

    const jobId = pending.id;
    const taskId = pending.taskId;
    markQueueItem(jobId, { status: 'running' });

    const run = async () => {
      const controller = new AbortController();
      activeJobControllersRef.current.set(jobId, controller);
      const shouldSkipCancelledJob = () => consumeCancelledGenerate3DQueueJob(cancelledJobIdsRef.current, jobId);
      try {
        if (shouldSkipCancelledJob()) return;

        const kind = pending.type as TencentGenerate3dQueueKind;
        const logLabel: Record<string, string> = {
          pro: '[队列] 开始专业版任务',
          rapid: '[队列] 开始极速版任务',
          convert: '[队列] 开始格式转换',
          topology: '[队列] 开始智能拓扑',
          texture: '[队列] 开始纹理生成',
          component: '[队列] 开始组件生成',
          uv: '[队列] 开始 UV 展开',
          profile: '[队列] 开始 3D 人物生成',
        };
        onLog('info', logLabel[kind] || `[队列] 开始 ${kind}`, { jobId });

        const result = await runTencentGenerate3dQueueItem({
          jobType: kind,
          input: pending.input,
          creds: creds3D,
          signal: controller.signal,
          onTaskProgress: onProgress3D(taskId),
          onLog,
        });
        if (shouldSkipCancelledJob()) return;

        if (result.kind === 'convert') {
          const input = pending.input as { fileUrl: string; format: string };
          const newItem: Temp3DItem = {
            id: jobId,
            label: pending.label || `转换 ${input.format}`,
            files: [{ Type: input.format, Url: result.resultUrl }],
            timestamp: Date.now(),
            source: 'convert',
          };
          setTemp3DLibrary((prev) => [...prev, newItem]);
          setSelectedTemp3DId(jobId);
          markQueueItem(jobId, { status: 'done', result: { resultUrl: result.resultUrl } });
          if (taskId) updateTask(taskId, { status: 'SUCCESS', progress: 100 });
          onLog('info', '[队列] 格式转换完成');
          return;
        }

        const files = result.files;
        if (kind === 'pro') {
          const input = pending.input as { prompt?: string; imageBase64?: string };
          const label =
            pending.label || (input.prompt || '').trim().slice(0, 20) || (input.imageBase64 ? '图生3D' : '3D');
          complete3DJobWithFiles(jobId, taskId, files, label, 'pro');
          return;
        }
        if (kind === 'rapid') {
          const input = pending.input as { prompt?: string };
          const label = pending.label || (input.prompt || '').trim().slice(0, 20) || '极速3D';
          complete3DJobWithFiles(jobId, taskId, files, label, 'rapid');
          return;
        }
        if (kind === 'topology') {
          complete3DJobWithFiles(jobId, taskId, files, pending.label || '智能拓扑', 'topology');
          return;
        }
        if (kind === 'texture') {
          complete3DJobWithFiles(jobId, taskId, files, pending.label || '纹理生成', 'texture');
          return;
        }
        if (kind === 'component') {
          complete3DJobWithFiles(jobId, taskId, files, pending.label || '组件生成', 'component');
          return;
        }
        if (kind === 'uv') {
          complete3DJobWithFiles(jobId, taskId, files, pending.label || 'UV展开', 'uv');
          return;
        }
        if (kind === 'profile') {
          complete3DJobWithFiles(jobId, taskId, files, pending.label || '3D人物', 'profile');
          return;
        }

        onLog('warn', `[队列] ${pending.type} 未知类型`, { jobId });
        markQueueItem(jobId, { status: 'fail', error: '未知任务类型' });
        if (taskId) updateTask(taskId, { status: 'FAILED', error: '未知任务类型' });
      } catch (error) {
        if (shouldSkipCancelledJob()) return;
        const message = error instanceof Error ? error.message : String(error);
        onLog('error', `[队列] ${pending.type} 失败`, message);
        markQueueItem(jobId, { status: 'fail', error: message });
        if (taskId) updateTask(taskId, { status: 'FAILED', error: message });
      } finally {
        activeJobControllersRef.current.delete(jobId);
      }
    };

    void run();
  }, [complete3DJobWithFiles, creds3D, generate3DQueue, markQueueItem, maxConcurrent, onLog, onProgress3D, updateTask]);

  return {
    creds3D,
    unsafeTencentBrowserCredsEnabled,
    temp3DLibrary,
    selectedTemp3DId,
    setSelectedTemp3DId,
    generate3DQueue,
    generate3DPreview,
    appendQueueItem,
    cancelQueueItem,
    retryQueueItem,
    clearInactiveQueueItems,
    importTripoTaskToTempLibrary,
  };
}
