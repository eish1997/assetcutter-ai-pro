import type { WorkflowAsset } from '../types';
import { extractTripoModelAndPreviewUrls } from './generate3d/tripoWorkflow';
import { getTripoTask } from './tripoService';
import { persistTripoModelsForWorkflowAsset } from './tripoModelPersist';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import { resolveWorkflowStepModelCompanionKeys, resolveWorkflowStepModelFormats } from './workflowStepModels';

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

function collectBlobUrlsToRevoke(asset: WorkflowAsset, metaKey: string): string[] {
  const out: string[] = [];
  for (const u of asset.modelUrls || []) {
    const s = String(u || '').trim();
    if (/^blob:/i.test(s)) out.push(s);
  }
  for (const arr of Object.values(asset.stepModelUrls || {})) {
    for (const u of arr || []) {
      const s = String(u || '').trim();
      if (/^blob:/i.test(s)) out.push(s);
    }
  }
  const prevResult = String((asset.results || {})[metaKey] || '').trim();
  if (/^blob:/i.test(prevResult)) out.push(prevResult);
  return out;
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

  const persisted = await persistTripoModelsForWorkflowAsset({
    apiKey: k,
    tripoTaskId,
    assetId: asset.id,
    resultKey: metaKey,
    glbSourceUrls: modelUrls,
    previewUrl,
    companionBaseUrl: params.companionBaseUrl,
    companionProjectId: params.companionProjectId,
    existing: {
      urls: existingUrls,
      companionKeys: existingKeys,
      formats: existingFormats,
    },
    onLog: params.onLog,
  });

  const revokeBlobUrls = collectBlobUrlsToRevoke(asset, metaKey);

  let nextResults: Record<string, string> = { ...(asset.results || {}) };
  let nextResultsCompanionKeys: Record<string, string> = { ...(asset.resultsCompanionKeys || {}) };
  if (persisted.preview?.objectUrl) {
    nextResults = { ...nextResults, [metaKey]: persisted.preview.objectUrl };
    if (persisted.preview.companionKey) {
      nextResultsCompanionKeys = { ...nextResultsCompanionKeys, [metaKey]: persisted.preview.companionKey };
    }
  }

  const oldMeta = asset.resultMeta?.[metaKey] || { executedAt: Date.now() };
  const nextResultMeta = {
    ...(asset.resultMeta || {}),
    [metaKey]: {
      ...oldMeta,
      tripoTaskId,
      tripoLastError: undefined,
    },
  };

  const cleanedResultCompanionKeys = Object.fromEntries(
    Object.entries(nextResultsCompanionKeys).filter(([, v]) => String(v || '').trim())
  );

  const nextAsset: WorkflowAsset = {
    ...asset,
    stepModelUrls: { ...(asset.stepModelUrls || {}), [metaKey]: persisted.modelUrls },
    stepModelCompanionKeys:
      persisted.modelCompanionKeys.length > 0
        ? { ...(asset.stepModelCompanionKeys || {}), [metaKey]: persisted.modelCompanionKeys }
        : asset.stepModelCompanionKeys,
    stepModelFormats:
      persisted.stepModelFormats.length > 0
        ? { ...(asset.stepModelFormats || {}), [metaKey]: persisted.stepModelFormats }
        : asset.stepModelFormats,
    modelUrls: persisted.modelUrls,
    modelCompanionKeys: persisted.modelCompanionKeys.length > 0 ? persisted.modelCompanionKeys : undefined,
    modelSourceName: persisted.modelSourceName,
    results: nextResults,
    resultsCompanionKeys: Object.keys(cleanedResultCompanionKeys).length > 0 ? cleanedResultCompanionKeys : undefined,
    resultMeta: nextResultMeta,
  };

  return { nextAsset, revokeBlobUrls };
}
