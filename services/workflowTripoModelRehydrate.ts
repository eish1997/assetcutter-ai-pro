import type { WorkflowAsset } from '../types';
import { extractTripoModelAndPreviewUrls } from './generate3d/tripoWorkflow';
import { getTripoTask } from './tripoService';
import { persistWorkflow3dSlots } from './persistWorkflow3dSlots';
import { applyPersisted3dSlotsToWorkflowAsset } from './workflowModelSlots';
import {
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
} from './workflowStepModels';

/** 从资产中解析「步骤详情 / resultMeta」里持久化的 Tripo 任务 id 及其对应步骤键 */
export function resolveWorkflowTripoMetaKeyAndTaskId(asset: WorkflowAsset): { metaKey: string; tripoTaskId: string } | null {
  const meta = asset.resultMeta || {};
  const displayKey = String(asset.displayKey || '').trim();
  const fromDisplay = String(meta[displayKey]?.tripoTaskId || '').trim();
  if (fromDisplay) return { metaKey: displayKey, tripoTaskId: fromDisplay };
  const order = [...(asset.resultOrder || [])].reverse();
  for (const k of order) {
    const id = String(meta[k]?.tripoTaskId || '').trim();
    if (id) return { metaKey: k, tripoTaskId: id };
  }
  for (const k of Object.keys(meta)) {
    const id = String(meta[k]?.tripoTaskId || '').trim();
    if (id) return { metaKey: k, tripoTaskId: id };
  }
  return null;
}

export type TripoRehydrateIntoAssetResult = {
  nextAsset: WorkflowAsset;
  /** 拉取完成后应 revoke 的旧 blob:（已在 nextAsset 中替换） */
  revokeBlobUrls: string[];
};

/**
 * 根据 resultMeta 中的 tripoTaskId 查询 Tripo 已完成任务，将 GLB+FBX 重新落地到本地伴侣并更新资产。
 */
export async function rehydrateWorkflowAssetModelsFromTripoTask(params: {
  asset: WorkflowAsset;
  apiKey: string;
  companionBaseUrl: string | null | undefined;
  companionProjectId: string | null | undefined;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}): Promise<TripoRehydrateIntoAssetResult> {
  const { asset, apiKey } = params;
  const resolved = resolveWorkflowTripoMetaKeyAndTaskId(asset);
  if (!resolved) {
    throw new Error('未在步骤详情（resultMeta）中找到 tripoTaskId，无法从 Tripo 拉取');
  }
  const { metaKey, tripoTaskId } = resolved;
  const k = String(apiKey || '').trim();
  if (!k) throw new Error('缺少 Tripo API Key');

  const done = await getTripoTask(k, tripoTaskId);
  if (done.status === 'failed') {
    throw new Error('Tripo 任务状态为 failed，无法取回模型');
  }
  if (done.status === 'expired') {
    throw new Error('Tripo 任务已 expired；若本地伴侣仍有归档可尝试直接下载，否则需重新生成');
  }
  if (done.status !== 'success') {
    throw new Error(`Tripo 任务尚未完成，当前状态：${done.status}。请稍后在 Tripo 控制台确认后再拉取。`);
  }
  const { modelUrls, previewUrl } = extractTripoModelAndPreviewUrls(done);
  if (!modelUrls.length) {
    throw new Error('Tripo 任务已成功，但未解析到可下载的模型 URL（可能已被清理或响应结构变化）');
  }

  const existingFormats = resolveWorkflowStepModelFormats(asset, metaKey);
  const existingUrls = asset.stepModelUrls?.[metaKey] || [];
  const existingKeys = resolveWorkflowStepModelCompanionKeys(asset, metaKey);

  const persisted = await persistWorkflow3dSlots({
    provider: 'tripo',
    apiKey: k,
    taskId: tripoTaskId,
    glbSourceUrls: modelUrls,
    previewUrl,
    assetId: asset.id,
    resultKey: metaKey,
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    existing: {
      urls: existingUrls,
      companionKeys: existingKeys,
      formats: existingFormats,
    },
    onLog: params.onLog,
  });

  return applyPersisted3dSlotsToWorkflowAsset({
    asset,
    metaKey,
    persisted,
    jobMeta: { tripoTaskId, tripoLastError: undefined },
  });
}
