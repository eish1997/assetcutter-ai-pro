import type { AssetSetComponentView, CustomAppModule } from '../../types';
import type { AssetSetComponent } from '../../types';
import {
  tripoWorkflowCreateOrResumeTaskId,
  tripoWorkflowPollUntilDone,
  extractTripoModelAndPreviewUrls,
} from '../generate3d/tripoWorkflow';
import {
  normalizeGenerate3DPresetForRun,
  resolveGenerate3dProviderId,
  resolveTencentHunyuanRegistryId,
} from '../generate3d';
import { createAndPollAiGatewayModel3dJob } from '../aiGatewayModel3dExecution';
import { normalizeApiErrorMessage } from '../unifiedAiGateway';
import { persistWorkflow3dSlots } from '../persistWorkflow3dSlots';
import { resolveAssetSetComponentViewSrc } from './assetSetAsset';

export function pickAssetSet3dPreset(
  views: AssetSetComponentView[],
  singlePreset: CustomAppModule | null,
  multiPreset: CustomAppModule | null
): CustomAppModule | null {
  const count = views.filter((v) => resolveAssetSetComponentViewSrc(v)).length;
  if (count <= 0) return null;
  if (count === 1) return singlePreset;
  return multiPreset ?? singlePreset;
}

const TRIPO_ROLE_MAP: Record<string, 'front' | 'back' | 'left' | 'right'> = {
  perspective: 'front',
  front: 'front',
  back: 'back',
  left: 'left',
  right: 'right',
};

export function mapAssetSetViewsToTripoMultiview(
  views: AssetSetComponentView[]
): Partial<Record<'front' | 'back' | 'left' | 'right', string>> | undefined {
  const out: Partial<Record<'front' | 'back' | 'left' | 'right', string>> = {};
  for (const view of views) {
    const src = resolveAssetSetComponentViewSrc(view);
    if (!src) continue;
    const role = String(view.role || '').trim().toLowerCase();
    const slot = TRIPO_ROLE_MAP[role];
    if (slot && !out[slot]) {
      out[slot] = src;
      continue;
    }
    if (!out.front) {
      out.front = src;
    } else if (!out.back) {
      out.back = src;
    } else if (!out.left) {
      out.left = src;
    } else if (!out.right) {
      out.right = src;
    }
  }
  const keys = Object.keys(out);
  return keys.length >= 2 ? out : undefined;
}

export function resolveAssetSet3dPrimaryImage(views: AssetSetComponentView[]): string {
  const perspective = views.find((v) => String(v.role).toLowerCase() === 'perspective');
  const perspectiveSrc = perspective ? resolveAssetSetComponentViewSrc(perspective) : '';
  if (perspectiveSrc) return perspectiveSrc;
  const front = views.find((v) => String(v.role).toLowerCase() === 'front');
  const frontSrc = front ? resolveAssetSetComponentViewSrc(front) : '';
  if (frontSrc) return frontSrc;
  for (const view of views) {
    const src = resolveAssetSetComponentViewSrc(view);
    if (src) return src;
  }
  return '';
}

export type RunAssetSetComponent3dResult =
  | {
      ok: true;
      jobId: string;
      provider: string;
      files: string[];
      previewUrl: string;
    }
  | { ok: false; error: string };

export function assetSetComponent3dResultKey(componentId: string): string {
  return `asset-set-3d-${componentId}`;
}

export async function persistAssetSetComponent3dModels(params: {
  apiKey: string;
  provider: string;
  taskId: string;
  assetId: string;
  componentId: string;
  glbSourceUrls: string[];
  previewUrl?: string;
  companionBaseUrl?: string;
  companionProjectId?: string;
  existing?: {
    files?: string[];
    fileCompanionKeys?: string[];
  };
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}): Promise<{
  files: string[];
  fileCompanionKeys: string[];
  previewUrl: string;
  previewCompanionKey?: string;
}> {
  const common = {
    taskId: params.taskId,
    previewUrl: params.previewUrl,
    assetId: params.assetId,
    resultKey: assetSetComponent3dResultKey(params.componentId),
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    existing: params.existing?.fileCompanionKeys?.length
      ? {
          urls: params.existing.files,
          companionKeys: params.existing.fileCompanionKeys,
        }
      : undefined,
    onLog: params.onLog,
  };
  const persisted = params.provider === 'tripo'
    ? await persistWorkflow3dSlots({
        ...common,
        provider: 'tripo',
        apiKey: params.apiKey,
        glbSourceUrls: params.glbSourceUrls,
      })
    : await persistWorkflow3dSlots({
        ...common,
        provider: params.provider,
        modelUrls: params.glbSourceUrls,
      });
  return {
    files: persisted.modelUrls,
    fileCompanionKeys: persisted.modelCompanionKeys,
    previewUrl: persisted.preview?.objectUrl || params.previewUrl || '',
    previewCompanionKey: persisted.preview?.companionKey,
  };
}

export async function runAssetSetComponent3d(params: {
  apiKey: string;
  preset: CustomAppModule;
  component: AssetSetComponent;
  onStatus?: (status: 'queued' | 'running') => void;
  existingJobId?: string;
  forceNewTask?: boolean;
}): Promise<RunAssetSetComponent3dResult> {
  const views = params.component.views ?? [];
  const multiview = mapAssetSetViewsToTripoMultiview(views);
  const primary = resolveAssetSet3dPrimaryImage(views);
  if (!primary) {
    return { ok: false, error: '组件尚无可用视角图' };
  }
  try {
    const g = normalizeGenerate3DPresetForRun(params.preset.generate3D!);
    const provider = resolveGenerate3dProviderId(g);
    if (provider === 'volcengine-ark' || provider === 'tencent') {
      const registryId =
        provider === 'tencent'
          ? resolveTencentHunyuanRegistryId(g)
          : g.modelRegistryId || 'doubao-seed3d-2-0';
      const prompt = (
        params.preset.instruction?.trim() ||
        g.prompt?.trim() ||
        `Generate a 3D model for ${params.component.name || params.component.id}`
      ).trim();
      params.onStatus?.('queued');
      const result = await createAndPollAiGatewayModel3dJob({
        prompt,
        referenceImages: [primary],
        registryId,
        quality: g.quality,
        format: provider === 'tencent' ? g.resultFormat : g.format,
        texture: provider === 'tencent' ? g.enablePBR : g.texture,
        enablePBR: g.enablePBR,
        faceCount: g.faceCount,
        generateType: g.generateType,
        polygonType: g.polygonType,
        model: g.model,
      });
      params.onStatus?.('running');
      return {
        ok: true,
        jobId: result.aiGatewayJobId,
        provider,
        files: result.modelUrls,
        previewUrl: result.previewUrl || '',
      };
    }
    if (provider !== 'tripo') {
      return { ok: false, error: `资产集 3D 暂不支持该供应商：${provider}` };
    }
    const { taskId } = await tripoWorkflowCreateOrResumeTaskId({
      apiKey: params.apiKey,
      preset: params.preset,
      imageDataUrl: primary,
      multiviewImageDataUrls: multiview,
      existingTaskId: params.existingJobId,
      forceNewTask: params.forceNewTask,
    });
    params.onStatus?.('queued');
    const done = await tripoWorkflowPollUntilDone({
      apiKey: params.apiKey,
      taskId,
      normalizeApiErrorMessage,
      onTripoStatus: params.onStatus,
    });
    if (done.status !== 'success') {
      return { ok: false, error: '3D 生成失败' };
    }
    const { modelUrls, previewUrl } = extractTripoModelAndPreviewUrls(done);
    if (!modelUrls.length) {
      return { ok: false, error: '3D 任务完成但未返回模型文件' };
    }
    return {
      ok: true,
      jobId: taskId,
      provider,
      files: modelUrls,
      previewUrl,
    };
  } catch (e) {
    return { ok: false, error: normalizeApiErrorMessage(e) };
  }
}
