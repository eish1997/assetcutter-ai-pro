import type { WorkflowAsset } from '../types';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';
import {
  buildWorkflow3dPersistedSlotUrls,
  normalizeWorkflow3dPreviewResultUrl,
} from './workflowModelSlots';
import { applyVgpAfterSuccessfulGen } from './vgp/vgpStore';

export type Workflow3dJobMetaPatch = {
  aiGatewayJobId?: string;
  tripoTaskId?: string;
  tencentJobId?: string;
  tripoLastError?: undefined;
  tencentLastError?: undefined;
};

function vgpAlreadyHasResultKey(asset: WorkflowAsset, resultKey: string): boolean {
  const vgp = asset.vgp;
  if (!vgp || !resultKey) return false;
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    if (v.stepKey === resultKey) return true;
    if (v.imageRef.kind === 'result_key' && v.imageRef.key === resultKey) return true;
  }
  return false;
}

export function patchWorkflowAssetsWith3dResult(params: {
  prev: WorkflowAsset[];
  task?: { assetId?: string; actionType?: string; resultKey?: string; inputSourceDisplayKey?: string };
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
}): WorkflowAsset[] {
  const {
    prev,
    task,
    preset,
    imageBase64,
    workflowAssetId,
    resultKey,
    localModelUrls,
    modelCompanionKeys,
    stepModelFormats,
    modelSourceName,
    localPreviewUrl,
    previewCompanionKey,
    jobMeta,
  } = params;

  const persistedSlotUrls = buildWorkflow3dPersistedSlotUrls(localModelUrls, modelCompanionKeys);
  const persistedPreviewUrl = normalizeWorkflow3dPreviewResultUrl(localPreviewUrl, previewCompanionKey);
  const key =
    String(resultKey || '').trim() ||
    String(task?.resultKey || '').trim() ||
    String(task?.actionType || '').trim() ||
    preset.id;
  const inputSourceDisplayKey =
    String(task?.inputSourceDisplayKey || '').trim() || 'original';

  const attachVgp = (asset: WorkflowAsset): WorkflowAsset => {
    if (vgpAlreadyHasResultKey(asset, key)) return asset;
    return applyVgpAfterSuccessfulGen(asset, {
      resultKey: key,
      vgpSteps: [],
      semanticSummary: preset.label || '生成3D',
      hadPromptOverride: false,
      inputSourceDisplayKey,
      userPromptRecord: preset.label || '生成3D',
    });
  };

  if (task?.assetId) {
    return prev.map((a) => {
      if (a.id !== task.assetId) return a;
      const hasOrder = (a.resultOrder || []).includes(key);
      const nextOrder = hasOrder ? (a.resultOrder || []) : [...(a.resultOrder || []), key];
      const nextResults =
        persistedPreviewUrl || previewCompanionKey
          ? { ...(a.results || {}), [key]: persistedPreviewUrl }
          : (a.results || {});
      const nextResultsCompanionKeys = { ...(a.resultsCompanionKeys || {}) };
      if (previewCompanionKey) nextResultsCompanionKeys[key] = previewCompanionKey;
      const oldMeta = a.resultMeta?.[key] || { executedAt: Date.now() };
      const nextMeta = {
        ...(a.resultMeta || {}),
        [key]: {
          ...oldMeta,
          executedAt: oldMeta.executedAt ?? Date.now(),
          ...jobMeta,
          presetActionIdSnapshot: oldMeta.presetActionIdSnapshot || preset.id,
          ...(oldMeta.displayStepLabel?.trim() ? {} : { displayStepLabel: preset.label }),
          ...(oldMeta.inputSourceDisplayKeySnapshot
            ? {}
            : { inputSourceDisplayKeySnapshot: inputSourceDisplayKey }),
          ...(persistedPreviewUrl || previewCompanionKey
            ? { mediaKind: 'image' as const }
            : { mediaKind: 'model3d' as const }),
        },
      };
      const patched: WorkflowAsset = {
        ...a,
        results: nextResults,
        resultsCompanionKeys:
          Object.keys(nextResultsCompanionKeys).length > 0 ? nextResultsCompanionKeys : a.resultsCompanionKeys,
        displayKey: key,
        resultOrder: nextOrder,
        stepModelUrls: { ...(a.stepModelUrls || {}), [key]: persistedSlotUrls },
        stepModelCompanionKeys:
          modelCompanionKeys.length > 0
            ? { ...(a.stepModelCompanionKeys || {}), [key]: modelCompanionKeys }
            : a.stepModelCompanionKeys,
        stepModelFormats:
          stepModelFormats.length > 0
            ? { ...(a.stepModelFormats || {}), [key]: stepModelFormats }
            : a.stepModelFormats,
        modelUrls: persistedSlotUrls,
        modelCompanionKeys: modelCompanionKeys.length > 0 ? modelCompanionKeys : undefined,
        modelSourceName: modelSourceName || undefined,
        resultMeta: nextMeta,
        hiddenInGrid: false,
      };
      return attachVgp(patched);
    });
  }

  const now = Date.now();
  const nextResultsCompanionKeys = previewCompanionKey ? { [key]: previewCompanionKey } : undefined;
  const next: WorkflowAsset = {
    id: workflowAssetId,
    original: imageBase64,
    displayKey: key,
    results: persistedPreviewUrl ? { [key]: persistedPreviewUrl } : {},
    resultsCompanionKeys: nextResultsCompanionKeys,
    stepModelUrls: { [key]: persistedSlotUrls },
    stepModelCompanionKeys: modelCompanionKeys.length > 0 ? { [key]: modelCompanionKeys } : undefined,
    stepModelFormats: stepModelFormats.length > 0 ? { [key]: stepModelFormats } : undefined,
    modelUrls: persistedSlotUrls,
    modelCompanionKeys: modelCompanionKeys.length > 0 ? modelCompanionKeys : undefined,
    modelSourceName: modelSourceName || undefined,
    resultOrder: [key],
    resultMeta: {
      [key]: {
        executedAt: now,
        ...jobMeta,
        presetActionIdSnapshot: preset.id,
        displayStepLabel: preset.label,
        inputSourceDisplayKeySnapshot: inputSourceDisplayKey,
        ...(persistedPreviewUrl || previewCompanionKey
          ? { mediaKind: 'image' as const }
          : { mediaKind: 'model3d' as const }),
      },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  return [attachVgp(next), ...prev];
}
