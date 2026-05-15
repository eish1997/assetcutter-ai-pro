import type { WorkflowAsset } from '../types';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';
import {
  resolveWorkflowStepModelCompanionKeys,
  resolveWorkflowStepModelFormats,
  resolveWorkflowStepModelUrls,
} from './workflowStepModels';

export type WorkflowModelSlot = {
  format: WorkflowModelSlotFormat;
  companionKey?: string;
  previewUrl?: string;
  sourceName?: string;
};

/** 各提供商 persist 统一返回形状 */
export type Persist3dModelsResult = {
  modelUrls: string[];
  modelCompanionKeys: string[];
  stepModelFormats: WorkflowModelSlotFormat[];
  modelSourceName?: string;
  preview?: {
    objectUrl: string;
    companionKey?: string;
  };
};

export function resolveWorkflowStepModelSlots(asset: WorkflowAsset, resultKey: string): WorkflowModelSlot[] {
  const urls = resolveWorkflowStepModelUrls(asset, resultKey);
  const keys = resolveWorkflowStepModelCompanionKeys(asset, resultKey);
  const formats = resolveWorkflowStepModelFormats(asset, resultKey);
  const slotCount = Math.max(urls.length, keys.length, formats.length, 0);
  return Array.from({ length: slotCount }, (_, i) => ({
    format: formats[i] || (i === 0 ? 'glb' : 'fbx'),
    companionKey: String(keys[i] || '').trim() || undefined,
    previewUrl: String(urls[i] || '').trim() || undefined,
    sourceName: asset.modelSourceName,
  }));
}

/** 有伴侣键的槽位不写 blob/data 进 bundle，预览由 hydrate 或当次会话拉取 */
export function buildWorkflow3dPersistedSlotUrls(
  previewUrls: string[],
  companionKeys: string[]
): string[] {
  const n = Math.max(previewUrls.length, companionKeys.length, 0);
  return Array.from({ length: n }, (_, i) => {
    const ck = String(companionKeys[i] ?? '').trim();
    if (ck) return '';
    return String(previewUrls[i] ?? '').trim();
  });
}

export function normalizeWorkflow3dPreviewResultUrl(
  previewUrl: string,
  previewCompanionKey: string
): string {
  if (String(previewCompanionKey || '').trim()) return '';
  return String(previewUrl || '').trim();
}

/** 将 persist 结果规范为「伴侣键为真相、URL 仅内存缓存」 */
export function normalizePersist3dModelsForBundleTruth(
  persisted: Persist3dModelsResult
): Persist3dModelsResult {
  const modelUrls = buildWorkflow3dPersistedSlotUrls(persisted.modelUrls, persisted.modelCompanionKeys);
  let preview = persisted.preview;
  if (preview?.companionKey) {
    preview = {
      companionKey: preview.companionKey,
      objectUrl: normalizeWorkflow3dPreviewResultUrl(preview.objectUrl, preview.companionKey),
    };
  }
  return {
    ...persisted,
    modelUrls,
    preview,
  };
}

export function collectWorkflow3dBlobUrlsToRevoke(asset: WorkflowAsset, metaKey: string): string[] {
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

export type Workflow3dRehydrateJobMetaPatch = {
  tripoTaskId?: string;
  tencentJobId?: string;
  tripoLastError?: undefined;
  tencentLastError?: undefined;
};

/** Tripo / 混元重拉后统一写回资产 stepModel* 与预览 */
export function applyPersisted3dSlotsToWorkflowAsset(params: {
  asset: WorkflowAsset;
  metaKey: string;
  persisted: Persist3dModelsResult;
  jobMeta?: Workflow3dRehydrateJobMetaPatch;
}): { nextAsset: WorkflowAsset; revokeBlobUrls: string[] } {
  const { asset, metaKey, persisted: persistedRaw, jobMeta } = params;
  const persisted = normalizePersist3dModelsForBundleTruth(persistedRaw);
  const revokeBlobUrls = collectWorkflow3dBlobUrlsToRevoke(asset, metaKey);

  let nextResults: Record<string, string> = { ...(asset.results || {}) };
  let nextResultsCompanionKeys: Record<string, string> = { ...(asset.resultsCompanionKeys || {}) };
  if (persisted.preview) {
    const previewUrl = normalizeWorkflow3dPreviewResultUrl(
      persisted.preview.objectUrl,
      persisted.preview.companionKey || ''
    );
    if (previewUrl) {
      nextResults = { ...nextResults, [metaKey]: previewUrl };
    } else if (persisted.preview.companionKey) {
      nextResults = { ...nextResults, [metaKey]: '' };
    }
    if (persisted.preview.companionKey) {
      nextResultsCompanionKeys = { ...nextResultsCompanionKeys, [metaKey]: persisted.preview.companionKey };
    }
  }

  const oldMeta = asset.resultMeta?.[metaKey] || { executedAt: Date.now() };
  const nextResultMeta = {
    ...(asset.resultMeta || {}),
    [metaKey]: {
      ...oldMeta,
      ...jobMeta,
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

export function inferTencentModuleFromWorkflowMeta(
  asset: WorkflowAsset,
  metaKey: string
): 'pro' | 'rapid' {
  const snap = String(asset.resultMeta?.[metaKey]?.presetActionIdSnapshot || '').toLowerCase();
  const key = String(metaKey || '').toLowerCase();
  if (snap.includes('rapid') || key.includes('rapid') || key.includes('hunyuan_rapid')) return 'rapid';
  return 'pro';
}
