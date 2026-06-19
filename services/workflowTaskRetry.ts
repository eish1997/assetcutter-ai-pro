import type { CustomAppModule, WorkflowPendingTask } from '../types';

function newTaskId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** 可序列化的失败任务快照，用于运行日志重试 */
export type WorkflowTaskRetrySnapshot = {
  v: 1;
  sourceTaskId: string;
  assetId: string;
  actionType: string;
  inputImage?: string;
  inputImageObjectKey?: string;
  inputImages?: string[];
  inputImagesObjectKeys?: string[];
  tripoMultiviewImages?: WorkflowPendingTask['tripoMultiviewImages'];
  inputSourceDisplayKey?: string;
  inputText?: string;
  promptOverride?: string;
  overrideImageModelRegistryId?: string;
  overrideImageGear?: CustomAppModule['imageGear'];
  overrideTextModelRegistryId?: string;
  overrideImageAspectRatio?: string;
  overrideImageSize?: string;
  overrideSkipUnderstand?: boolean;
  logContext?: WorkflowPendingTask['logContext'];
  sourceGroupAssetId?: string;
  sourceItemIndex?: number;
  displayStepLabel?: string;
};

export type WorkflowRunLogMeta = {
  auditEventId?: string;
  retryable?: boolean;
};

export function isTaskRetryable(task: WorkflowPendingTask): boolean {
  if (task.lightboxAwaitClientResult) return false;
  if (String(task.clientPrefetchedImageResult || '').trim()) return false;
  return true;
}

export function buildRetrySnapshotFromTask(task: WorkflowPendingTask): WorkflowTaskRetrySnapshot | null {
  if (!isTaskRetryable(task)) return null;
  const assetId = String(task.assetId || '').trim();
  const actionType = String(task.actionType || '').trim();
  if (!assetId || !actionType) return null;
  return {
    v: 1,
    sourceTaskId: task.id,
    assetId,
    actionType,
    ...(String(task.inputImage || '').trim() ? { inputImage: String(task.inputImage).trim() } : {}),
    ...(task.inputImageObjectKey?.trim() ? { inputImageObjectKey: task.inputImageObjectKey.trim() } : {}),
    ...(Array.isArray(task.inputImages) && task.inputImages.length
      ? { inputImages: task.inputImages.map((x) => String(x)) }
      : {}),
    ...(Array.isArray(task.inputImagesObjectKeys) && task.inputImagesObjectKeys.length
      ? { inputImagesObjectKeys: task.inputImagesObjectKeys.map((x) => String(x)) }
      : {}),
    ...(task.tripoMultiviewImages ? { tripoMultiviewImages: { ...task.tripoMultiviewImages } } : {}),
    ...(task.inputSourceDisplayKey ? { inputSourceDisplayKey: task.inputSourceDisplayKey } : {}),
    ...(task.inputText?.trim() ? { inputText: task.inputText.trim() } : {}),
    ...(task.promptOverride?.trim() ? { promptOverride: task.promptOverride.trim() } : {}),
    ...(task.overrideImageModelRegistryId
      ? { overrideImageModelRegistryId: task.overrideImageModelRegistryId }
      : {}),
    ...(task.overrideImageGear ? { overrideImageGear: task.overrideImageGear } : {}),
    ...(task.overrideTextModelRegistryId ? { overrideTextModelRegistryId: task.overrideTextModelRegistryId } : {}),
    ...(task.overrideImageAspectRatio ? { overrideImageAspectRatio: task.overrideImageAspectRatio } : {}),
    ...(task.overrideImageSize ? { overrideImageSize: task.overrideImageSize } : {}),
    ...(typeof task.overrideSkipUnderstand === 'boolean'
      ? { overrideSkipUnderstand: task.overrideSkipUnderstand }
      : {}),
    ...(task.logContext ? { logContext: task.logContext } : {}),
    ...(task.sourceGroupAssetId ? { sourceGroupAssetId: task.sourceGroupAssetId } : {}),
    ...(typeof task.sourceItemIndex === 'number' ? { sourceItemIndex: task.sourceItemIndex } : {}),
    ...(task.displayStepLabel?.trim() ? { displayStepLabel: task.displayStepLabel.trim() } : {}),
  };
}

export function parseRetrySnapshotFromAuditDetail(detail: unknown): WorkflowTaskRetrySnapshot | null {
  if (!detail || typeof detail !== 'object') return null;
  const raw = (detail as { retrySnapshot?: unknown }).retrySnapshot;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as WorkflowTaskRetrySnapshot;
  if (s.v !== 1) return null;
  if (!String(s.assetId || '').trim() || !String(s.actionType || '').trim()) return null;
  return s;
}

export function buildPendingTaskFromRetrySnapshot(snapshot: WorkflowTaskRetrySnapshot): WorkflowPendingTask {
  return {
    id: newTaskId(),
    assetId: snapshot.assetId,
    actionType: snapshot.actionType,
    inputImage: snapshot.inputImage ?? '',
    addedAt: Date.now(),
    ...(snapshot.inputImageObjectKey ? { inputImageObjectKey: snapshot.inputImageObjectKey } : {}),
    ...(snapshot.inputImages?.length ? { inputImages: [...snapshot.inputImages] } : {}),
    ...(snapshot.inputImagesObjectKeys?.length ? { inputImagesObjectKeys: [...snapshot.inputImagesObjectKeys] } : {}),
    ...(snapshot.tripoMultiviewImages ? { tripoMultiviewImages: { ...snapshot.tripoMultiviewImages } } : {}),
    ...(snapshot.inputSourceDisplayKey ? { inputSourceDisplayKey: snapshot.inputSourceDisplayKey } : {}),
    ...(snapshot.inputText ? { inputText: snapshot.inputText } : {}),
    ...(snapshot.promptOverride ? { promptOverride: snapshot.promptOverride } : {}),
    ...(snapshot.overrideImageModelRegistryId
      ? { overrideImageModelRegistryId: snapshot.overrideImageModelRegistryId }
      : {}),
    ...(snapshot.overrideImageGear ? { overrideImageGear: snapshot.overrideImageGear } : {}),
    ...(snapshot.overrideTextModelRegistryId
      ? { overrideTextModelRegistryId: snapshot.overrideTextModelRegistryId }
      : {}),
    ...(snapshot.overrideImageAspectRatio ? { overrideImageAspectRatio: snapshot.overrideImageAspectRatio } : {}),
    ...(snapshot.overrideImageSize ? { overrideImageSize: snapshot.overrideImageSize } : {}),
    ...(typeof snapshot.overrideSkipUnderstand === 'boolean'
      ? { overrideSkipUnderstand: snapshot.overrideSkipUnderstand }
      : {}),
    ...(snapshot.logContext ? { logContext: snapshot.logContext } : {}),
    ...(snapshot.sourceGroupAssetId ? { sourceGroupAssetId: snapshot.sourceGroupAssetId } : {}),
    ...(typeof snapshot.sourceItemIndex === 'number' ? { sourceItemIndex: snapshot.sourceItemIndex } : {}),
    ...(snapshot.displayStepLabel ? { displayStepLabel: snapshot.displayStepLabel } : {}),
  };
}

export function validateRetrySnapshot(params: {
  snapshot: WorkflowTaskRetrySnapshot;
  assetExists: boolean;
  moduleExists: boolean;
}): string | null {
  if (!params.assetExists) return '源资产已不存在';
  if (!params.moduleExists) return '能力预设不存在或已禁用';
  return null;
}

export const AC_WORKFLOW_RETRY_TASK_EVENT = 'ac:workflow-retry-task';
