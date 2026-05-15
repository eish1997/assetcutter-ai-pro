import type { WorkflowAsset } from '../types';
import type { WorkflowModelSlotFormat } from './tripoModelPersist';

export type Workflow3dJobMetaPatch = {
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

  if (task?.assetId) {
    return prev.map((a) => {
      if (a.id !== task.assetId) return a;
      const key = task.actionType || preset.id;
      const hasOrder = (a.resultOrder || []).includes(key);
      const nextOrder = hasOrder ? (a.resultOrder || []) : [...(a.resultOrder || []), key];
      const nextResults = localPreviewUrl ? { ...(a.results || {}), [key]: localPreviewUrl } : (a.results || {});
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
          ...(localPreviewUrl ? { mediaKind: 'image' as const } : { mediaKind: 'model3d' as const }),
        },
      };
      return {
        ...a,
        results: nextResults,
        resultsCompanionKeys:
          Object.keys(nextResultsCompanionKeys).length > 0 ? nextResultsCompanionKeys : a.resultsCompanionKeys,
        displayKey: localPreviewUrl ? key : a.displayKey,
        resultOrder: nextOrder,
        stepModelUrls: { ...(a.stepModelUrls || {}), [key]: localModelUrls },
        stepModelCompanionKeys:
          modelCompanionKeys.length > 0
            ? { ...(a.stepModelCompanionKeys || {}), [key]: modelCompanionKeys }
            : a.stepModelCompanionKeys,
        stepModelFormats:
          stepModelFormats.length > 0
            ? { ...(a.stepModelFormats || {}), [key]: stepModelFormats }
            : a.stepModelFormats,
        modelUrls: localModelUrls,
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
    displayKey: localPreviewUrl ? presetKey : 'original',
    results: localPreviewUrl ? { [presetKey]: localPreviewUrl } : {},
    resultsCompanionKeys: nextResultsCompanionKeys,
    stepModelUrls: { [presetKey]: localModelUrls },
    stepModelCompanionKeys: modelCompanionKeys.length > 0 ? { [presetKey]: modelCompanionKeys } : undefined,
    stepModelFormats: stepModelFormats.length > 0 ? { [presetKey]: stepModelFormats } : undefined,
    modelUrls: localModelUrls,
    modelCompanionKeys: modelCompanionKeys.length > 0 ? modelCompanionKeys : undefined,
    modelSourceName: modelSourceName || undefined,
    resultOrder: localPreviewUrl ? [presetKey] : [],
    resultMeta: {
      [presetKey]: {
        executedAt: now,
        ...jobMeta,
        presetActionIdSnapshot: preset.id,
        displayStepLabel: preset.label,
        ...(localPreviewUrl ? { mediaKind: 'image' as const } : {}),
      },
    },
    archived: false,
    hiddenInGrid: false,
    createdAt: now,
  };
  return [next, ...prev];
}
