/**
 * 工作流侧 Gemini 异步恢复：超时后后台续 poll，完成后写回资产。
 */
import type { WorkflowPendingTask } from '../types';
import {
  GEMINI_ASYNC_RECOVERED_EVENT,
  type GeminiAsyncRecoveredDetail,
} from './geminiAsyncJobRecovery';
import { resumeGeminiAsyncJob, isGeminiAsyncPollTimeoutError } from './geminiService';

export function scheduleWorkflowGeminiAsyncRecovery(task: WorkflowPendingTask, jobId: string): void {
  const id = String(jobId || '').trim();
  if (!id) return;
  void resumeGeminiAsyncJob(id).catch((e) => {
    if (isGeminiAsyncPollTimeoutError(e)) return;
  });
}

export type WorkflowGeminiRecoveryApplyArgs = {
  detail: GeminiAsyncRecoveredDetail;
  task: WorkflowPendingTask;
  extractImage: (result: unknown) => string | null;
};

export type WorkflowGeminiRecoveryApplyResult = {
  applied: boolean;
  image?: string | null;
  text?: string | null;
};

export function applyGeminiRecoveredToWorkflowTask(
  args: WorkflowGeminiRecoveryApplyArgs
): WorkflowGeminiRecoveryApplyResult {
  const { detail, task, extractImage } = args;
  if (detail.workflowTaskId && detail.workflowTaskId !== task.id) {
    return { applied: false };
  }
  if (detail.assetId && detail.assetId !== task.assetId) {
    return { applied: false };
  }
  const image = extractImage(detail.result);
  const text =
    typeof (detail.result as { text?: string }).text === 'string'
      ? String((detail.result as { text?: string }).text)
      : null;
  if (!image && !text) return { applied: false };
  return { applied: true, image, text };
}

export { GEMINI_ASYNC_RECOVERED_EVENT };
