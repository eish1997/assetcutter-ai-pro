import { createTripoTask, getTripoTask, waitTripoTaskDone } from '../unifiedAiGateway';
import {
  AI_GATEWAY_TRIPO_PLATFORM_KEY,
  extractTripoTaskArtifactUrls,
  isAiGatewayTripoPlatformKey,
} from '../tripoService';
import type { TripoCreateTaskInput, TripoTaskResult, TripoTaskType } from '../tripoService';
import type { CustomAppModule } from '../../types';
import { normalizeGenerate3DPresetForRun } from './normalizePreset';
import { createAiJob, getMyAiJob, type AiJobDetail } from '../aiJobsClient';
import { upsertAiJobSummary } from '../aiJobsStore';
import { prepareImageDataUrlForTripoUpload } from '../tripoUploadImagePrep';
import { isAiGatewayModel3dExecutionEnabled } from '../aiGatewayModel3dExecution';

/**
 * C9/D4: user workflow Tripo always platform Key + Gateway.
 * BYOK only when model3d execution is explicitly off (dev/diagnostic; blocked in production by false-green).
 */
function resolveTripoWorkflowApiKey(apiKey: string): string {
  if (isAiGatewayModel3dExecutionEnabled()) return AI_GATEWAY_TRIPO_PLATFORM_KEY;
  const bypass = String(apiKey || '').trim();
  if (bypass) {
    console.warn(
      '[tripoWorkflow] VITE_AI_GATEWAY_MODEL3D_EXECUTION is off — using caller Tripo key (not pre-release safe; D4)'
    );
  }
  return bypass;
}

const TRIPO_REGISTRY_MODEL_VERSION: Record<string, string> = {
  'tripo-p1': 'P1-20260311',
  'tripo-v3.1': 'v3.1-20260211',
  'tripo-v3.0': 'v3.0-20250812',
  'tripo-v2.5': 'v2.5-20250123',
  'tripo-v2.0': 'v2.0-20240919',
};

export function buildTripoCreateTaskInputFromPreset(params: {
  apiKey: string;
  preset: CustomAppModule;
  imageDataUrl: string;
  multiviewImageDataUrls?: Partial<Record<'front' | 'back' | 'left' | 'right', string>>;
}): TripoCreateTaskInput {
  const g = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
  const taskType: TripoTaskType =
    g.tripoTaskType === 'text_to_model'
      ? 'text_to_model'
      : g.tripoTaskType === 'multiview_to_model'
        ? 'multiview_to_model'
        : 'image_to_model';
  const prompt =
    (params.preset.instruction?.trim() || g.prompt?.trim() || '') || undefined;
  return {
    apiKey: params.apiKey,
    type: taskType,
    ...(prompt ? { prompt } : {}),
    ...(g.tripoNegativePrompt?.trim() ? { negativePrompt: g.tripoNegativePrompt.trim() } : {}),
    ...(g.tripoModelVersion?.trim() || TRIPO_REGISTRY_MODEL_VERSION[g.modelRegistryId || '']
      ? { modelVersion: g.tripoModelVersion?.trim() || TRIPO_REGISTRY_MODEL_VERSION[g.modelRegistryId || ''] }
      : taskType === 'multiview_to_model'
        ? { modelVersion: 'v3.1-20260211' }
        : {}),
    ...(taskType === 'image_to_model' ? { imageBase64DataUrl: params.imageDataUrl } : {}),
    ...(taskType === 'multiview_to_model' ? { multiviewImageBase64DataUrls: params.multiviewImageDataUrls } : {}),
    ...(typeof g.tripoTexture === 'boolean' ? { texture: g.tripoTexture } : {}),
    ...(typeof g.tripoPbr === 'boolean' ? { pbr: g.tripoPbr } : {}),
    ...(g.tripoTextureQuality ? { textureQuality: g.tripoTextureQuality } : {}),
    ...(g.tripoGeometryQuality ? { geometryQuality: g.tripoGeometryQuality } : {}),
    ...(typeof g.tripoFaceLimit === 'number' ? { faceLimit: g.tripoFaceLimit } : {}),
    ...(typeof g.tripoQuad === 'boolean' ? { quad: g.tripoQuad } : {}),
    ...(typeof g.tripoSmartLowPoly === 'boolean' ? { smartLowPoly: g.tripoSmartLowPoly } : {}),
    ...(typeof g.tripoGenerateParts === 'boolean' ? { generateParts: g.tripoGenerateParts } : {}),
    ...(typeof g.tripoAutoSize === 'boolean' ? { autoSize: g.tripoAutoSize } : {}),
    ...(g.tripoCompress ? { compress: g.tripoCompress } : {}),
    ...(typeof g.tripoExportUv === 'boolean' ? { exportUv: g.tripoExportUv } : {}),
    ...(typeof g.tripoEnableImageAutofix === 'boolean' ? { enableImageAutofix: g.tripoEnableImageAutofix } : {}),
    ...(g.tripoTextureAlignment ? { textureAlignment: g.tripoTextureAlignment } : {}),
    ...(g.tripoOrientation ? { orientation: g.tripoOrientation } : {}),
  };
}

/** 从已完成任务中拆出可下载模型 URL 与预览图 URL（与 App 工作流回填逻辑一致） */
export function extractTripoModelAndPreviewUrls(done: TripoTaskResult): {
  modelUrls: string[];
  previewUrl: string;
} {
  const fromRaw = extractTripoTaskArtifactUrls(done.raw);
  const modelUrls = fromRaw.modelUrls.length
    ? fromRaw.modelUrls
    : done.modelUrls.map((url) => String(url || '').trim()).filter(Boolean);
  const raw = done.raw as Record<string, unknown> | null | undefined;
  const dataOut =
    raw && typeof raw.data === 'object' && raw.data !== null
      ? (raw.data as Record<string, unknown>).output
      : undefined;
  const dataRendered =
    dataOut && typeof dataOut === 'object' && dataOut !== null
      ? String((dataOut as Record<string, unknown>).rendered_image || '')
      : '';
  const topRendered =
    raw && typeof raw.output === 'object' && raw.output !== null
      ? String(((raw.output as Record<string, unknown>).rendered_image as string) || '')
      : '';
  const output = raw && typeof raw.output === 'object' && raw.output !== null
    ? (raw.output as Record<string, unknown>)
    : {};
  const directModelUrl = String(output.model_url || output.modelUrl || '').trim();
  const directPreviewUrl = String(output.rendered_image_url || output.renderedImageUrl || '').trim();
  if (directModelUrl && !modelUrls.includes(directModelUrl)) modelUrls.push(directModelUrl);
  const previewUrl =
    fromRaw.previewUrl || directPreviewUrl || dataRendered || topRendered || '';
  return { modelUrls, previewUrl };
}

function extractAiGatewayArtifactUrl(artifact: Record<string, unknown>): string {
  for (const key of ['url', 'modelUrl', 'model_url', 'fileUrl', 'file_url', 'publicUrl', 'signedUrl', 'href', 'downloadUrl', 'download_url']) {
    const value = String(artifact[key] || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  return '';
}

function isAiGatewayModel3dArtifact(artifact: Record<string, unknown>): boolean {
  const kind = String(artifact.kind || artifact.type || artifact.mediaKind || '').toLowerCase();
  if (/(model3d|model_3d|3d|mesh|glb|gltf|fbx|obj|stl|usdz)/.test(kind)) return true;
  const url = extractAiGatewayArtifactUrl(artifact);
  return /\.(glb|gltf|fbx|obj|stl|usdz|3mf|zip)(\?|#|$)/i.test(url);
}

export async function tripoWorkflowCreateOrResumeTaskId(params: {
  apiKey: string;
  preset: CustomAppModule;
  imageDataUrl: string;
  multiviewImageDataUrls?: Partial<Record<'front' | 'back' | 'left' | 'right', string>>;
  existingTaskId?: string;
  forceNewTask?: boolean;
  resumeExistingTask?: boolean;
}): Promise<{ taskId: string; resumed: boolean; aiGatewayJobId?: string }> {
  const forceNew = Boolean(params.forceNewTask);
  const existing = String(params.existingTaskId || '').trim();
  if (existing && !forceNew && params.resumeExistingTask === true) {
    return { taskId: existing, resumed: true };
  }
  const presetForInput = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
  const taskTypeForInput: TripoTaskType =
    presetForInput.tripoTaskType === 'text_to_model'
      ? 'text_to_model'
      : presetForInput.tripoTaskType === 'multiview_to_model'
        ? 'multiview_to_model'
        : 'image_to_model';
  const imageDataUrl = taskTypeForInput === 'image_to_model'
    ? await prepareImageDataUrlForTripoUpload(params.imageDataUrl)
    : params.imageDataUrl;
  const multiviewImageDataUrls = taskTypeForInput === 'multiview_to_model'
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(params.multiviewImageDataUrls || {}).map(async ([key, value]) => [
            key,
            value ? await prepareImageDataUrlForTripoUpload(value) : value,
          ])
        )
      ) as Partial<Record<'front' | 'back' | 'left' | 'right', string>>
    : params.multiviewImageDataUrls;
  const apiKey = resolveTripoWorkflowApiKey(params.apiKey);
  const input = buildTripoCreateTaskInputFromPreset({
    apiKey,
    preset: params.preset,
    imageDataUrl,
    multiviewImageDataUrls,
  });
  if (isAiGatewayTripoPlatformKey(apiKey)) {
    const { apiKey: _apiKey, ...gatewayInput } = input;
    const registryId = params.preset.generate3D?.modelRegistryId || 'tripo-p1';
    const detail = await createAiJob({
      modality: 'model3d',
      capability: 'model3d.generate',
      provider: 'tripo',
      model: registryId,
      canonicalModelId: registryId,
      registryId,
      metadata: {
        source: 'workflow_generate_3d',
        taskType: input.type,
        canonicalModelId: registryId,
        registryId,
      },
      input: {
        ...(gatewayInput as unknown as Record<string, unknown>),
        canonicalModelId: registryId,
        registryId,
      },
    });
    upsertAiJobSummary(detail.job);
    return { taskId: detail.job.id, resumed: false, aiGatewayJobId: detail.job.id };
  }
  const taskId = await createTripoTask(input);
  return { taskId, resumed: false };
}

function extractGatewayTripoTaskId(detail: AiJobDetail): string {
  const output = detail.job.output as Record<string, unknown> | null | undefined;
  const metadata = (detail.job as unknown as { metadata?: Record<string, unknown> }).metadata || {};
  return (
    String(output?.taskId || '').trim() ||
    String(metadata.tripoTaskId || '').trim() ||
    String(metadata.upstreamTaskId || '').trim() ||
    detail.job.id
  );
}

function gatewayDetailToTripoResult(detail: AiJobDetail): TripoTaskResult {
  const status =
    detail.job.status === 'succeeded'
      ? 'success'
      : detail.job.status === 'failed'
        ? 'failed'
        : detail.job.status === 'queued'
          ? 'queued'
          : detail.job.status === 'running'
            ? 'running'
            : 'unknown';
  const output = detail.job.output as Record<string, unknown> | null | undefined;
  const rawArtifacts = extractTripoTaskArtifactUrls(output?.raw || output || detail);
  const artifactModelUrls = (Array.isArray(detail.job.artifacts) ? detail.job.artifacts : [])
    .filter((artifact) => isAiGatewayModel3dArtifact(artifact))
    .map((artifact) => extractAiGatewayArtifactUrl(artifact))
    .filter(Boolean);
  // A3: prefer Gateway contract artifacts over provider-shaped raw/output dig.
  const modelUrls = artifactModelUrls.length
    ? artifactModelUrls
    : Array.isArray(output?.modelUrls)
    ? output.modelUrls.map((url) => String(url || '').trim()).filter(Boolean)
    : rawArtifacts.modelUrls;
  return {
    taskId: extractGatewayTripoTaskId(detail),
    status,
    modelUrls,
    raw: output?.raw || output || detail,
  };
}

export async function tripoWorkflowPollUntilDone(params: {
  apiKey: string;
  taskId: string;
  normalizeApiErrorMessage: (e: unknown) => string;
  onTripoStatus?: (phase: 'queued' | 'running') => void;
  /** wait 抛错后走 getTripoTask 兜底前回调（便于打日志） */
  onPollRecover?: (errorMessage: string) => void;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<TripoTaskResult> {
  const apiKey = resolveTripoWorkflowApiKey(params.apiKey);
  const { taskId, normalizeApiErrorMessage } = params;
  if (isAiGatewayTripoPlatformKey(apiKey)) {
    const timeoutMs = params.timeoutMs ?? 8 * 60_000;
    const intervalMs = params.intervalMs ?? 3000;
    const startedAt = Date.now();
    let lastStatus = '';
    while (Date.now() - startedAt <= timeoutMs) {
      const detail = await getMyAiJob(taskId);
      upsertAiJobSummary(detail.job);
      const result = gatewayDetailToTripoResult(detail);
      if (result.status !== lastStatus) {
        lastStatus = result.status;
        if (result.status === 'queued') params.onTripoStatus?.('queued');
        if (result.status === 'running') params.onTripoStatus?.('running');
      }
      if (result.status === 'success' || result.status === 'failed') return result;
      await new Promise((r) => setTimeout(r, Math.max(1000, intervalMs)));
    }
    throw new Error('AI Gateway 3D task timed out');
  }
  try {
    return await waitTripoTaskDone(apiKey, taskId, {
      timeoutMs: params.timeoutMs ?? 8 * 60_000,
      intervalMs: params.intervalMs ?? 3000,
      onProgress: (s) => {
        if (s === 'queued') params.onTripoStatus?.('queued');
        if (s === 'running') params.onTripoStatus?.('running');
      },
    });
  } catch (e) {
    const msg = normalizeApiErrorMessage(e);
    params.onPollRecover?.(msg);
    return await getTripoTask(apiKey, taskId);
  }
}
