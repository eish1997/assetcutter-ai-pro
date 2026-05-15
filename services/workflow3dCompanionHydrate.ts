import type { WorkflowAsset } from '../types';
import {
  fetchWorkflowModelFromCompanionAsObjectUrl,
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
} from './workflowCompanionAssets';
import { normalizeCompanionBaseUrl } from './companionLocalPrefs';
import {
  isWorkflowModelUrlReadable,
  shouldKeepExistingWorkflowModelSlotUrl,
} from './workflowModelBlob';
import { patchWorkflowAssetsWith3dResult, type Workflow3dJobMetaPatch } from './workflowGenerate3dAssetPatch';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';

export type Workflow3dHydrateLog = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: unknown
) => void;

async function shouldKeepExistingResultPreviewUrl(url: string, companionKey?: string): Promise<boolean> {
  const u = String(url ?? '').trim();
  const ck = String(companionKey || '').trim();
  if (!u) return false;
  if (u.startsWith('data:')) return true;
  if (/^https?:\/\//i.test(u)) {
    if (!ck) return true;
    return await isWorkflowModelUrlReadable(u);
  }
  if (/^blob:/i.test(u)) return await isWorkflowModelUrlReadable(u);
  return false;
}

/** 从伴侣卷恢复 3D 模型槽位预览 URL（stepModel* + 遗留 modelUrls） */
export async function hydrateWorkflowAsset3dModelsFromCompanion(params: {
  asset: WorkflowAsset;
  baseUrl: string;
  projectId: string;
  onLog?: Workflow3dHydrateLog;
}): Promise<{ nextAsset: WorkflowAsset; revokeBlobUrls: string[] }> {
  const base = normalizeCompanionBaseUrl(String(params.baseUrl || '').trim());
  const pid = String(params.projectId || '').trim();
  if (!base || !pid) return { nextAsset: params.asset, revokeBlobUrls: [] };

  const revokeBlobUrls: string[] = [];
  let next: WorkflowAsset = { ...params.asset };
  const nextStepUrls: Record<string, string[]> = { ...(next.stepModelUrls || {}) };
  let stepChanged = false;

  for (const stepKey of Object.keys(next.stepModelCompanionKeys || {})) {
    const mck = next.stepModelCompanionKeys![stepKey] || [];
    const urls = [...(nextStepUrls[stepKey] || [])];
    let keyChanged = false;
    for (let i = 0; i < mck.length; i += 1) {
      const ck = String(mck[i] || '').trim();
      if (!ck) continue;
      const prevU = String(urls[i] ?? '').trim();
      if (await shouldKeepExistingWorkflowModelSlotUrl(prevU, ck)) continue;
      const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, ck, next.modelSourceName);
      if (got.ok === false) {
        params.onLog?.('warn', '本地伴侣 3D 模型恢复失败', `${next.id}/${stepKey}[${i}]: ${got.error}`);
        continue;
      }
      if (/^blob:/i.test(prevU)) revokeBlobUrls.push(prevU);
      while (urls.length <= i) urls.push('');
      urls[i] = got.objectUrl;
      keyChanged = true;
    }
    if (keyChanged) {
      nextStepUrls[stepKey] = urls;
      stepChanged = true;
    }
  }

  const legacyKeys = next.modelCompanionKeys || [];
  const legacyUrls = [...(next.modelUrls || [])];
  let legacyChanged = false;
  for (let i = 0; i < legacyKeys.length; i += 1) {
    const ck = String(legacyKeys[i] || '').trim();
    if (!ck) continue;
    const prevU = String(legacyUrls[i] ?? '').trim();
    if (await shouldKeepExistingWorkflowModelSlotUrl(prevU, ck)) continue;
    const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, ck, next.modelSourceName);
    if (got.ok === false) {
      params.onLog?.('warn', '本地伴侣 3D 模型恢复失败', `${next.id}[${i}]: ${got.error}`);
      continue;
    }
    if (/^blob:/i.test(prevU)) revokeBlobUrls.push(prevU);
    while (legacyUrls.length <= i) legacyUrls.push('');
    legacyUrls[i] = got.objectUrl;
    legacyChanged = true;
  }

  if (stepChanged || legacyChanged) {
    next = {
      ...next,
      ...(stepChanged ? { stepModelUrls: nextStepUrls } : {}),
      ...(legacyChanged ? { modelUrls: legacyUrls } : {}),
    };
  }

  return { nextAsset: next, revokeBlobUrls };
}

/** 从伴侣卷恢复 3D 步骤预览图（results + resultsCompanionKeys） */
export async function hydrateWorkflowAsset3dResultPreviewsFromCompanion(params: {
  asset: WorkflowAsset;
  baseUrl: string;
  projectId: string;
  onLog?: Workflow3dHydrateLog;
}): Promise<{ nextAsset: WorkflowAsset; revokeBlobUrls: string[] }> {
  const base = normalizeCompanionBaseUrl(String(params.baseUrl || '').trim());
  const pid = String(params.projectId || '').trim();
  if (!base || !pid) return { nextAsset: params.asset, revokeBlobUrls: [] };

  const revokeBlobUrls: string[] = [];
  const rck = params.asset.resultsCompanionKeys || {};
  const nextResults = { ...(params.asset.results || {}) };
  let changed = false;

  for (const stepId of Object.keys(rck)) {
    const ck = String(rck[stepId] || '').trim();
    if (!ck) continue;
    const prevU = String(nextResults[stepId] ?? '').trim();
    if (await shouldKeepExistingResultPreviewUrl(prevU, ck)) continue;
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, ck);
    if (got.ok === false) {
      params.onLog?.('warn', '本地伴侣 3D 预览图恢复失败', `${params.asset.id}/${stepId}: ${got.error}`);
      continue;
    }
    if (/^blob:/i.test(prevU)) revokeBlobUrls.push(prevU);
    nextResults[stepId] = got.objectUrl;
    changed = true;
  }

  if (!changed) return { nextAsset: params.asset, revokeBlobUrls };
  return {
    nextAsset: { ...params.asset, results: nextResults },
    revokeBlobUrls,
  };
}

/** 3D 落盘/重拉后：模型槽位 + 预览图一并从伴侣 hydrate */
export async function hydrateWorkflowAssetAfter3dPersist(params: {
  asset: WorkflowAsset;
  baseUrl: string;
  projectId: string;
  onLog?: Workflow3dHydrateLog;
}): Promise<{ nextAsset: WorkflowAsset; revokeBlobUrls: string[] }> {
  const models = await hydrateWorkflowAsset3dModelsFromCompanion(params);
  const previews = await hydrateWorkflowAsset3dResultPreviewsFromCompanion({
    asset: models.nextAsset,
    baseUrl: params.baseUrl,
    projectId: params.projectId,
    onLog: params.onLog,
  });
  return {
    nextAsset: previews.nextAsset,
    revokeBlobUrls: [...models.revokeBlobUrls, ...previews.revokeBlobUrls],
  };
}

/**
 * 仅恢复「当前 3D 结果键」对应的模型槽位与预览图（用于生成完成瞬间 hydrate）。
 * 禁止遍历整张资产卡上所有历史步骤的伴侣键，否则一键生成会对每个空槽位串行 await fetch，
 * 长时间阻塞主线程并压垮本地伴侣 HTTP，表现为整页/伴侣壳黑屏假死。
 */
export async function hydrateWorkflowAssetSingle3dResultKeyFromCompanion(params: {
  asset: WorkflowAsset;
  resultKey: string;
  baseUrl: string;
  projectId: string;
  onLog?: Workflow3dHydrateLog;
}): Promise<{ nextAsset: WorkflowAsset; revokeBlobUrls: string[] }> {
  const base = normalizeCompanionBaseUrl(String(params.baseUrl || '').trim());
  const pid = String(params.projectId || '').trim();
  const resultKey = String(params.resultKey || '').trim();
  if (!base || !pid || !resultKey) return { nextAsset: params.asset, revokeBlobUrls: [] };

  const revokeBlobUrls: string[] = [];
  let asset: WorkflowAsset = { ...params.asset };

  const mck = (asset.stepModelCompanionKeys || {})[resultKey] || [];
  const nextStepUrls: Record<string, string[]> = { ...(asset.stepModelUrls || {}) };
  const urls = [...(nextStepUrls[resultKey] || [])];
  let stepChanged = false;

  for (let i = 0; i < mck.length; i += 1) {
    const ck = String(mck[i] || '').trim();
    if (!ck) continue;
    const prevU = String(urls[i] ?? '').trim();
    if (await shouldKeepExistingWorkflowModelSlotUrl(prevU, ck)) continue;
    const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, ck, asset.modelSourceName);
    if (got.ok === false) {
      params.onLog?.('warn', '本地伴侣 3D 模型恢复失败', `${asset.id}/${resultKey}[${i}]: ${got.error}`);
      continue;
    }
    if (/^blob:/i.test(prevU)) revokeBlobUrls.push(prevU);
    while (urls.length <= i) urls.push('');
    urls[i] = got.objectUrl;
    stepChanged = true;
  }

  if (stepChanged) {
    nextStepUrls[resultKey] = urls;
    asset = {
      ...asset,
      stepModelUrls: nextStepUrls,
      // 与 patchWorkflowAssetsWith3dResult 一致：modelUrls 与当前步槽位同一行数据
      modelUrls: urls,
    };
  } else if (mck.length === 0 && (asset.modelCompanionKeys?.length ?? 0) > 0) {
    const legacyKeys = asset.modelCompanionKeys || [];
    const legacyUrls = [...(asset.modelUrls || [])];
    let legacyChanged = false;
    for (let i = 0; i < legacyKeys.length; i += 1) {
      const ck = String(legacyKeys[i] || '').trim();
      if (!ck) continue;
      const prevU = String(legacyUrls[i] ?? '').trim();
      if (await shouldKeepExistingWorkflowModelSlotUrl(prevU, ck)) continue;
      const got = await fetchWorkflowModelFromCompanionAsObjectUrl(base, pid, ck, asset.modelSourceName);
      if (got.ok === false) {
        params.onLog?.('warn', '本地伴侣 3D 模型恢复失败', `${asset.id}[${i}]: ${got.error}`);
        continue;
      }
      if (/^blob:/i.test(prevU)) revokeBlobUrls.push(prevU);
      while (legacyUrls.length <= i) legacyUrls.push('');
      legacyUrls[i] = got.objectUrl;
      legacyChanged = true;
    }
    if (legacyChanged) {
      asset = { ...asset, modelUrls: legacyUrls };
    }
  }

  const previewCk = String((asset.resultsCompanionKeys || {})[resultKey] || '').trim();
  if (previewCk) {
    const prevPreview = String((asset.results || {})[resultKey] ?? '').trim();
    if (!(await shouldKeepExistingResultPreviewUrl(prevPreview, previewCk))) {
      const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, previewCk);
      if (got.ok === false) {
        params.onLog?.('warn', '本地伴侣 3D 预览图恢复失败', `${asset.id}/${resultKey}: ${got.error}`);
      } else {
        if (/^blob:/i.test(prevPreview)) revokeBlobUrls.push(prevPreview);
        asset = {
          ...asset,
          results: { ...(asset.results || {}), [resultKey]: got.objectUrl },
        };
      }
    }
  }

  return { nextAsset: asset, revokeBlobUrls };
}

/** 生成 3D 回填资产后同步 hydrate（避免 bundle 瘦身导致预览空窗） */
export async function patchWorkflowAssetsWith3dResultAndHydrate(params: {
  prev: WorkflowAsset[];
  task?: { assetId?: string; actionType?: string };
  preset: { id: string; label: string };
  imageBase64: string;
  workflowAssetId: string;
  resultKey: string;
  localModelUrls: string[];
  modelCompanionKeys: string[];
  stepModelFormats: WorkflowModelSlotFormat[];
  modelSourceName?: string;
  localPreviewUrl: string;
  previewCompanionKey: string;
  jobMeta: Workflow3dJobMetaPatch;
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  onLog?: Workflow3dHydrateLog;
}): Promise<{ assets: WorkflowAsset[]; revokeBlobUrls: string[] }> {
  const patched = patchWorkflowAssetsWith3dResult(params);
  const base = String(params.companionBaseUrl || '').trim();
  const pid = String(params.companionProjectId || '').trim();
  const assetId = String(params.task?.assetId || params.workflowAssetId || '').trim();
  if (!base || !pid || pid === 'default' || !assetId) {
    return { assets: patched, revokeBlobUrls: [] };
  }

  const target = patched.find((a) => a.id === assetId);
  if (!target) return { assets: patched, revokeBlobUrls: [] };

  const resultKey = String(params.resultKey || '').trim();
  const hydrated = resultKey
    ? await hydrateWorkflowAssetSingle3dResultKeyFromCompanion({
        asset: target,
        resultKey,
        baseUrl: base,
        projectId: pid,
        onLog: params.onLog,
      })
    : await hydrateWorkflowAssetAfter3dPersist({
        asset: target,
        baseUrl: base,
        projectId: pid,
        onLog: params.onLog,
      });

  return {
    assets: patched.map((a) => (a.id === assetId ? hydrated.nextAsset : a)),
    revokeBlobUrls: hydrated.revokeBlobUrls,
  };
}
