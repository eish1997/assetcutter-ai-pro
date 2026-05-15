import type { WorkflowAsset } from '../types';
import type { TencentCredentials } from './tencentService';
import { queryHunyuanTo3DProJob, queryHunyuanTo3DRapidJob } from './tencentService';
import { persistWorkflow3dSlots } from './persistWorkflow3dSlots';
import {
  applyPersisted3dSlotsToWorkflowAsset,
  inferTencentModuleFromWorkflowMeta,
  type Persist3dModelsResult,
} from './workflowModelSlots';
import {
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
} from './workflowStepModels';

/** 从资产 resultMeta 解析混元 JobId 与步骤键 */
export function resolveWorkflowTencentMetaKeyAndJobId(
  asset: WorkflowAsset
): { metaKey: string; tencentJobId: string } | null {
  const meta = asset.resultMeta || {};
  const displayKey = String(asset.displayKey || '').trim();
  const fromDisplay = String(meta[displayKey]?.tencentJobId || '').trim();
  if (fromDisplay) return { metaKey: displayKey, tencentJobId: fromDisplay };
  const order = [...(asset.resultOrder || [])].reverse();
  for (const k of order) {
    const id = String(meta[k]?.tencentJobId || '').trim();
    if (id) return { metaKey: k, tencentJobId: id };
  }
  for (const k of Object.keys(meta)) {
    const id = String(meta[k]?.tencentJobId || '').trim();
    if (id) return { metaKey: k, tencentJobId: id };
  }
  return null;
}

export type TencentRehydrateIntoAssetResult = {
  nextAsset: WorkflowAsset;
  revokeBlobUrls: string[];
};

async function queryTencentJobDone(
  jobId: string,
  creds: TencentCredentials,
  module: 'pro' | 'rapid'
): Promise<{ files: import('./tencentService').File3D[] }> {
  const result =
    module === 'rapid'
      ? await queryHunyuanTo3DRapidJob(jobId, creds)
      : await queryHunyuanTo3DProJob(jobId, creds);
  if (result.status === 'FAIL') {
    throw new Error(result.errorMessage || result.errorCode || '混元任务失败，无法取回模型');
  }
  if (result.status !== 'DONE') {
    throw new Error(`混元任务尚未完成，当前状态：${result.status}。请稍后再试。`);
  }
  if (!result.resultFile3Ds?.length) {
    throw new Error('混元任务已完成，但未返回可下载模型文件');
  }
  return { files: result.resultFile3Ds };
}

/**
 * 根据 resultMeta 中的 tencentJobId 查询混元已完成任务，将模型重新落地到本地伴侣并更新资产。
 */
export async function rehydrateWorkflowAssetModelsFromTencentJob(params: {
  asset: WorkflowAsset;
  creds: TencentCredentials;
  companionBaseUrl: string | null | undefined;
  companionProjectId: string | null | undefined;
  onLog?: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void;
}): Promise<TencentRehydrateIntoAssetResult> {
  const { asset, creds } = params;
  const resolved = resolveWorkflowTencentMetaKeyAndJobId(asset);
  if (!resolved) {
    throw new Error('未在步骤详情（resultMeta）中找到 tencentJobId，无法从混元拉取');
  }
  const { metaKey, tencentJobId } = resolved;
  const module = inferTencentModuleFromWorkflowMeta(asset, metaKey);
  const { files } = await queryTencentJobDone(tencentJobId, creds, module);

  const existingFormats = resolveWorkflowStepModelFormats(asset, metaKey);
  const existingUrls = asset.stepModelUrls?.[metaKey] || [];
  const existingKeys = resolveWorkflowStepModelCompanionKeys(asset, metaKey);

  const persisted = await persistWorkflow3dSlots({
    provider: 'tencent',
    creds,
    taskId: tencentJobId,
    files,
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
    jobMeta: { tencentJobId, tencentLastError: undefined },
  });
}
