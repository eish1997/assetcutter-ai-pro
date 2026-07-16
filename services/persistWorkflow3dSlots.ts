import type { CustomAppModule } from '../types';
import type { File3D, TencentCredentials } from './tencentService';
import { persistProviderModelArtifactsForWorkflowAsset } from './providerModelArtifactPersist';
import { persistTencentModelsForWorkflowAsset } from './tencentModelPersist';
import { persistTripoModelsForWorkflowAsset } from './tripoModelPersist';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';
import type { Persist3dModelsResult } from './workflowModelSlots';

export type PersistWorkflow3dSlotsParams = {
  provider: 'tripo' | 'tencent' | 'volcengine-ark' | (string & {});
  assetId: string;
  resultKey: string;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  includeFbxArchive?: boolean;
  existing?: {
    urls?: string[];
    companionKeys?: string[];
    formats?: WorkflowModelSlotFormat[];
  };
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
} & (
  | {
      provider: 'tripo';
      apiKey: string;
      taskId: string;
      glbSourceUrls: string[];
      previewUrl?: string;
    }
  | {
      provider: 'tencent';
      creds: TencentCredentials;
      taskId: string;
      files: File3D[];
    }
  | {
      provider: 'volcengine-ark' | (string & {});
      taskId: string;
      modelUrls: string[];
      previewUrl?: string;
    }
);

/** 工作流 3D 归档统一门面：Tripo / 混元落伴侣 + 预览 blob */
export async function persistWorkflow3dSlots(params: PersistWorkflow3dSlotsParams): Promise<Persist3dModelsResult> {
  const common = {
    assetId: params.assetId,
    resultKey: params.resultKey,
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    existing: params.existing,
    onLog: params.onLog,
  };

  if (params.provider === 'tripo') {
    return persistTripoModelsForWorkflowAsset({
      ...common,
      apiKey: params.apiKey,
      tripoTaskId: params.taskId,
      glbSourceUrls: params.glbSourceUrls,
      previewUrl: params.previewUrl,
      includeFbxArchive: params.includeFbxArchive,
    });
  }

  if (params.provider === 'tencent') {
    return persistTencentModelsForWorkflowAsset({
      ...common,
      creds: params.creds,
      tencentJobId: params.taskId,
      files: params.files,
    });
  }

  return persistProviderModelArtifactsForWorkflowAsset({
    ...common,
    providerId: params.provider,
    taskId: params.taskId,
    modelUrls: params.modelUrls,
    previewUrl: params.previewUrl,
  });
}

/** 从工作流 preset 推断 provider（供 App 编排） */
export function resolveWorkflow3dProviderFromPreset(preset: CustomAppModule): 'tripo' | 'tencent' {
  const g = preset.generate3D;
  if (g?.provider === 'tencent' || g?.provider === 'tripo') return g.provider;
  if (preset.id.toLowerCase().includes('hunyuan') || preset.id.toLowerCase().includes('tencent')) return 'tencent';
  return 'tripo';
}
