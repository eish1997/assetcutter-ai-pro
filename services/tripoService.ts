import { prepareImageDataUrlForTripoUpload } from './tripoUploadImagePrep';
import { apiUrl } from './apiBase';
import { recordUsageEvent } from './recordUsageEvent';
import {
  DEFAULT_PRICE_CATALOG,
  estimateUsageCostUsd,
  findPriceCatalogEntry,
} from './usageCost';
import { resolveBillingSkuForTripoTask } from './usageBillingSku';

export type TripoTaskType = 'text_to_model' | 'image_to_model' | 'multiview_to_model';
export type TripoMultiviewKey = 'front' | 'back' | 'left' | 'right';

export type TripoCreateTaskInput = {
  apiKey: string;
  type: TripoTaskType;
  prompt?: string;
  negativePrompt?: string;
  modelVersion?: string;
  imageUrl?: string;
  imageBase64DataUrl?: string;
  multiviewImageBase64DataUrls?: Partial<Record<TripoMultiviewKey, string>>;
  texture?: boolean;
  pbr?: boolean;
  textureQuality?: 'standard' | 'detailed';
  geometryQuality?: 'standard' | 'detailed';
  faceLimit?: number;
  quad?: boolean;
  smartLowPoly?: boolean;
  generateParts?: boolean;
  autoSize?: boolean;
  compress?: 'geometry';
  exportUv?: boolean;
  enableImageAutofix?: boolean;
  textureAlignment?: 'original_image' | 'geometry';
  orientation?: 'default' | 'align_image';
};

export type TripoTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'expired' | 'unknown';

export type TripoTaskResult = {
  taskId: string;
  status: TripoTaskStatus;
  modelUrls: string[];
  raw: unknown;
};

const TRIPO_ALLOWED_MODEL_VERSIONS = new Set([
  'P1-20260311',
  'v3.1-20260211',
  'v3.0-20250812',
  'v2.5-20250123',
  'v2.0-20240919',
]);

export function resolveTripoProxyBase(): string {
  return apiUrl('/api/tripo');
}

function mapStatus(raw: unknown): TripoTaskStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'queued' || s === 'pending' || s === 'created' || s === 'submitted') return 'queued';
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'running';
  if (s === 'success' || s === 'succeeded' || s === 'finished' || s === 'done') return 'success';
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'failed';
  if (s === 'expired') return 'expired';
  return 'unknown';
}

function normalizeModelUrlsFromTask(task: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const t = String(v || '').trim();
    if (!t || !/^https?:\/\//i.test(t)) return;
    if (!out.includes(t)) out.push(t);
  };
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const rec = obj as Record<string, unknown>;
    Object.keys(rec).forEach((k) => {
      const v = rec[k];
      if (typeof v === 'string' && /(url|model|glb|gltf|fbx|obj|download)/i.test(k)) push(v);
      else walk(v);
    });
  };
  walk(task);
  return out;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const r = error as Record<string, unknown>;
    const topMsg =
      (typeof r.message === 'string' && r.message.trim()) ||
      (typeof r.msg === 'string' && r.msg.trim()) ||
      (typeof r.detail === 'string' && r.detail.trim());
    if (topMsg) return topMsg;
    const nested = r.error && typeof r.error === 'object' ? (r.error as Record<string, unknown>) : null;
    const nestedMsg =
      nested &&
      ((typeof nested.message === 'string' && nested.message.trim()) ||
        (typeof nested.msg === 'string' && nested.msg.trim()));
    if (nestedMsg) return nestedMsg;
    const code = r.code != null ? String(r.code) : nested && nested.code != null ? String(nested.code) : '';
    if (code || Object.keys(r).length) {
      try {
        return JSON.stringify(error);
      } catch {
        return '请求 Tripo 失败';
      }
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '请求 Tripo 失败';
  }
}

function isTransientQueryError(error: unknown): boolean {
  const msg = normalizeErrorMessage(error).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('查询任务失败 (500)') ||
    msg.includes('查询任务失败 (502)') ||
    msg.includes('查询任务失败 (503)') ||
    msg.includes('查询任务失败 (504)') ||
    msg.includes('查询任务失败 (429)') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout')
  );
}

/** Tripo 上游瞬时错误：可安全重试「上传 / 建任务」（未拿到 task_id 前不会重复计费） */
function isTripoTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function uploadImageToTripo(apiKey: string, imageBase64DataUrl: string): Promise<string> {
  const url = `${resolveTripoProxyBase()}/upload`;
  const prepared = await prepareImageDataUrlForTripoUpload(imageBase64DataUrl);
  const body = JSON.stringify({ apiKey, imageBase64DataUrl: prepared });
  let data: Record<string, unknown> = {};
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    lastStatus = resp.status;
    data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok) break;
    if (!isTripoTransientHttpStatus(resp.status) || attempt === 4) {
      throw new Error(`Tripo 上传图片失败 (${lastStatus})：${normalizeErrorMessage(data)}`);
    }
    await new Promise((r) => setTimeout(r, 1200 * attempt + Math.floor(Math.random() * 400)));
  }
  const token =
    String((data as Record<string, any>)?.file_token || '').trim() ||
    String((data as Record<string, any>)?.data?.file_token || '').trim() ||
    String((data as Record<string, any>)?.image_token || '').trim() ||
    String((data as Record<string, any>)?.data?.image_token || '').trim();
  if (!token) throw new Error('Tripo 上传成功但未返回 file_token');
  return token;
}

async function buildTripoFileFromDataUrl(apiKey: string, imageBase64DataUrl: string): Promise<{ type: 'jpg'; file_token: string }> {
  const fileToken = await uploadImageToTripo(apiKey, imageBase64DataUrl.trim());
  return { type: 'jpg', file_token: fileToken };
}

export type TripoConvertFormat = 'GLTF' | 'USDZ' | 'FBX' | 'OBJ' | 'STL' | '3MF';

export async function createTripoConvertModelTask(
  apiKey: string,
  originalTaskId: string,
  format: TripoConvertFormat
): Promise<string> {
  const key = apiKey.trim();
  const sourceId = String(originalTaskId || '').trim();
  if (!key) throw new Error('缺少 Tripo API Key');
  if (!sourceId) throw new Error('缺少 original_model_task_id');
  const taskUrl = `${resolveTripoProxyBase()}/task`;
  const taskBody = JSON.stringify({
    apiKey: key,
    type: 'convert_model',
    format,
    original_model_task_id: sourceId,
  });
  let data: Record<string, unknown> = {};
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const resp = await fetch(taskUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: taskBody,
    });
    lastStatus = resp.status;
    data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok) break;
    if (!isTripoTransientHttpStatus(resp.status) || attempt === 4) {
      throw new Error(`Tripo 格式转换任务创建失败 (${lastStatus})：${normalizeErrorMessage(data)}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt + Math.floor(Math.random() * 500)));
  }
  const taskId =
    String(data.task_id || '').trim() ||
    String(
      data.data && typeof data.data === 'object'
        ? String((data.data as Record<string, unknown>).task_id || '').trim()
        : ''
    ).trim() ||
    String(data.id || '').trim();
  if (!taskId) throw new Error('Tripo 格式转换未返回 task_id');
  return taskId;
}

export async function fetchTripoRemoteFileBlob(apiKey: string, url: string): Promise<Blob> {
  const r = await fetch(`${resolveTripoProxyBase()}/fetch-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: apiKey.trim(), url }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Tripo 文件拉取失败 (${r.status})：${txt || 'unknown error'}`);
  }
  return await r.blob();
}

export async function createTripoTask(input: TripoCreateTaskInput): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error('缺少 Tripo API Key');
  const payload: Record<string, unknown> = {
    type: input.type,
  };
  if (input.prompt?.trim()) payload.prompt = input.prompt.trim();
  if (input.negativePrompt?.trim()) payload.negative_prompt = input.negativePrompt.trim();
  if (input.modelVersion?.trim()) {
    const version = input.modelVersion.trim();
    if (!TRIPO_ALLOWED_MODEL_VERSIONS.has(version)) {
      throw new Error(`模型版本无效：${version}。请在预设中选择文档支持的版本。`);
    }
    payload.model_version = version;
  }
  if (typeof input.texture === 'boolean') payload.texture = input.texture;
  if (typeof input.pbr === 'boolean') payload.pbr = input.pbr;
  if (input.textureQuality) payload.texture_quality = input.textureQuality;
  if (input.geometryQuality) payload.geometry_quality = input.geometryQuality;
  if (typeof input.faceLimit === 'number' && Number.isFinite(input.faceLimit)) {
    payload.face_limit = Math.max(500, Math.min(500000, Math.floor(input.faceLimit)));
  }
  if (typeof input.quad === 'boolean') payload.quad = input.quad;
  if (typeof input.smartLowPoly === 'boolean') payload.smart_low_poly = input.smartLowPoly;
  if (typeof input.generateParts === 'boolean') payload.generate_parts = input.generateParts;
  if (typeof input.autoSize === 'boolean') payload.auto_size = input.autoSize;
  if (input.compress) payload.compress = input.compress;
  if (typeof input.exportUv === 'boolean') payload.export_uv = input.exportUv;
  if (
    typeof input.enableImageAutofix === 'boolean' &&
    (input.type === 'image_to_model' || input.type === 'multiview_to_model')
  ) {
    payload.enable_image_autofix = input.enableImageAutofix;
  }
  /**
   * 显式约束校验：不偷偷改用户配置，直接报错让用户感知并修正。
   */
  if (payload.generate_parts === true && (payload.texture !== false || payload.pbr !== false)) {
    throw new Error('参数冲突：开启「分部件」时，必须关闭「纹理」与「PBR」');
  }
  if (payload.generate_parts === true && payload.quad === true) {
    throw new Error('参数冲突：开启「分部件」时，不能同时开启「Quad」');
  }
  const version = input.modelVersion?.trim() || '';
  const supportsGeometryQuality = version.startsWith('v3.');
  if (input.geometryQuality && version && !supportsGeometryQuality) {
    throw new Error(`当前版本 ${version} 不支持「几何质量」，请改为 v3.0-20250812 / v3.1-20260211 或设为自动。`);
  }
  if (input.type === 'image_to_model') {
    if (input.textureAlignment) payload.texture_alignment = input.textureAlignment;
    if (input.orientation) payload.orientation = input.orientation;
    if (input.imageBase64DataUrl?.trim()) {
      payload.file = await buildTripoFileFromDataUrl(apiKey, input.imageBase64DataUrl.trim());
    } else if (input.imageUrl?.trim()) {
      payload.file = { type: 'url', url: input.imageUrl.trim() };
    } else {
      throw new Error('图生3D需要 imageUrl 或 imageBase64DataUrl');
    }
  }
  if (input.type === 'multiview_to_model') {
    if (input.textureAlignment) payload.texture_alignment = input.textureAlignment;
    if (input.orientation) payload.orientation = input.orientation;
    const slots = input.multiviewImageBase64DataUrls || {};
    const ordered: TripoMultiviewKey[] = ['front', 'left', 'back', 'right'];
    const present = ordered.filter((key) => String(slots[key] || '').trim());
    if (!String(slots.front || '').trim()) throw new Error('Tripo 多视图生成需要正面图');
    if (present.length < 2) throw new Error('Tripo 多视图生成至少需要 2 张图（正面必填）');
    const files: Array<Record<string, string>> = [];
    for (const key of ordered) {
      const dataUrl = String(slots[key] || '').trim();
      files.push(dataUrl ? await buildTripoFileFromDataUrl(apiKey, dataUrl) : { type: 'jpg' });
    }
    payload.files = files;
  }
  const taskUrl = `${resolveTripoProxyBase()}/task`;
  const taskBody = JSON.stringify({ ...payload, apiKey });
  let data: Record<string, unknown> = {};
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const resp = await fetch(taskUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: taskBody,
    });
    lastStatus = resp.status;
    data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok) break;
    if (!isTripoTransientHttpStatus(resp.status) || attempt === 4) {
      throw new Error(`Tripo 创建任务失败 (${lastStatus})：${normalizeErrorMessage(data)}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt + Math.floor(Math.random() * 500)));
  }
  const taskId =
    String(data.task_id || '').trim() ||
    String(
      data.data && typeof data.data === 'object'
        ? String((data.data as Record<string, unknown>).task_id || '').trim()
        : ''
    ).trim() ||
    String(data.id || '').trim();
  if (!taskId) throw new Error('Tripo 返回中缺少 task_id');
  const billingSku = resolveBillingSkuForTripoTask(input.type);
  const priceEntry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, billingSku);
  recordUsageEvent({
    idempotencyKey: `tripo-task:${taskId}`,
    provider: 'tripo',
    billingSku,
    meterKind: 'task',
    quantity: 1,
    unit: 'task',
    upstreamTaskId: taskId,
    costUsdEst: estimateUsageCostUsd(priceEntry, { meterKind: 'task', quantity: 1 }),
    costConfidence: 'estimated',
    status: 'succeeded',
    meta: { taskType: input.type, modelVersion: input.modelVersion || null },
  });
  return taskId;
}

export async function getTripoTask(apiKey: string, taskId: string): Promise<TripoTaskResult> {
  const qp = new URLSearchParams({ apiKey: apiKey.trim() });
  const resp = await fetch(`${resolveTripoProxyBase()}/task/${encodeURIComponent(taskId)}?${qp.toString()}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Tripo 查询任务失败 (${resp.status})：${normalizeErrorMessage(data)}`);
  }
  const statusRaw =
    (data as Record<string, any>)?.status ??
    (data as Record<string, any>)?.data?.status ??
    (data as Record<string, any>)?.task?.status;
  return {
    taskId,
    status: mapStatus(statusRaw),
    modelUrls: normalizeModelUrlsFromTask(data),
    raw: data,
  };
}

export async function waitTripoTaskDone(
  apiKey: string,
  taskId: string,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (status: TripoTaskStatus) => void;
  }
): Promise<TripoTaskResult> {
  const timeoutMs = Math.max(10_000, opts?.timeoutMs ?? 8 * 60_000);
  const intervalMs = Math.max(1000, opts?.intervalMs ?? 3000);
  const startedAt = Date.now();
  let last: TripoTaskStatus | null = null;
  let transientFailCount = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    let task: TripoTaskResult;
    try {
      task = await getTripoTask(apiKey, taskId);
      transientFailCount = 0;
    } catch (e) {
      if (!isTransientQueryError(e)) throw e;
      transientFailCount += 1;
      // 查询阶段抗抖动：仅重试查询，不重建任务，避免重复计费。
      const delay = Math.min(intervalMs * Math.max(1, transientFailCount), 12_000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    if (task.status !== last) {
      last = task.status;
      opts?.onProgress?.(task.status);
    }
    if (task.status === 'success' || task.status === 'failed') return task;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Tripo 任务等待超时，请稍后重试');
}
