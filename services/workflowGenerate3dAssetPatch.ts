import type { WorkflowAsset } from '../types';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';
import {
  buildWorkflow3dPersistedSlotUrls,
  normalizeWorkflow3dPreviewResultUrl,
} from './workflowModelSlots';

export type Workflow3dJobMetaPatch = {
  aiGatewayJobId?: string;
  tripoTaskId?: string;
  tencentJobId?: string;
  tripoLastError?: undefined;
  tencentLastError?: undefined;
};

export function patchWorkflowAssetsWith3dResult(params: {
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

  if (task?.assetId) {
    return prev.map((a) => {
      if (a.id !== task.assetId) return a;
      const key = task.actionType || preset.id;
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
          ...(persistedPreviewUrl || previewCompanionKey
            ? { mediaKind: 'image' as const }
            : { mediaKind: 'model3d' as const }),
        },
      };
      return {
        ...a,
        results: nextResults,
        resultsCompanionKeys:
          Object.keys(nextResultsCompanionKeys).length > 0 ? nextResultsCompanionKeys : a.resultsCompanionKeys,
        displayKey: persistedPreviewUrl || previewCompanionKey ? key : a.displayKey,
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
    });
  }

  const now = Date.now();
  const presetKey = preset.id;
  const nextResultsCompanionKeys = previewCompanionKey ? { [presetKey]: previewCompanionKey } : undefined;
  const next: WorkflowAsset = {
    id: workflowAssetId,
    original: imageBase64,
    displayKey: persistedPreviewUrl || previewCompanionKey ? presetKey : 'original',
    results: persistedPreviewUrl ? { [presetKey]: persistedPreviewUrl } : {},
    resultsCompanionKeys: nextResultsCompanionKeys,
    stepModelUrls: { [presetKey]: persistedSlotUrls },
    stepModelCompanionKeys: modelCompanionKeys.length > 0 ? { [presetKey]: modelCompanionKeys } : undefined,
    stepModelFormats: stepModelFormats.length > 0 ? { [presetKey]: stepModelFormats } : undefined,
    modelUrls: persistedSlotUrls,
    modelCompanionKeys: modelCompanionKeys.length > 0 ? modelCompanionKeys : undefined,
    modelSourceName: modelSourceName || undefined,
    resultOrder: persistedPreviewUrl || previewCompanionKey ? [presetKey] : [],
    resultMeta: {
      [presetKey]: {
        executedAt: now,
        ...jobMeta,
        presetActionIdSnapshot: preset.id,
        displayStepLabel: preset.label,
        ...(persistedPreviewUrl || previewCompanionKey ? { mediaKind: 'image' as const } : {}),
      },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  return [next, ...prev];
}
