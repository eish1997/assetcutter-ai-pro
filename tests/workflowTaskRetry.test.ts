import { describe, expect, it } from 'vitest';
import type { WorkflowPendingTask } from '../types';
import {
  buildPendingTaskFromRetrySnapshot,
  buildRetrySnapshotFromTask,
  isTaskRetryable,
  parseRetrySnapshotFromAuditDetail,
  validateRetrySnapshot,
} from '../services/workflowTaskRetry';

function baseTask(overrides: Partial<WorkflowPendingTask> = {}): WorkflowPendingTask {
  return {
    id: 't1',
    assetId: 'a1',
    actionType: 'preset_img',
    inputImage: 'data:image/png;base64,abc',
    addedAt: 1,
    inputText: 'hello',
    promptOverride: 'override prompt',
    ...overrides,
  };
}

describe('workflowTaskRetry', () => {
  it('isTaskRetryable excludes lightbox deferred and prefetched results', () => {
    expect(isTaskRetryable(baseTask())).toBe(true);
    expect(isTaskRetryable(baseTask({ lightboxAwaitClientResult: true }))).toBe(false);
    expect(isTaskRetryable(baseTask({ clientPrefetchedImageResult: 'data:image/png;base64,x' }))).toBe(false);
  });

  it('buildRetrySnapshotFromTask round-trips key fields', () => {
    const task = baseTask({
      inputImages: ['ref1'],
      overrideImageModelRegistryId: 'img-model',
      logContext: 'quick_compose_bar_plain',
    });
    const snapshot = buildRetrySnapshotFromTask(task);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.v).toBe(1);
    expect(snapshot!.inputText).toBe('hello');
    expect(snapshot!.promptOverride).toBe('override prompt');
    expect(snapshot!.inputImages).toEqual(['ref1']);
    expect(snapshot!.overrideImageModelRegistryId).toBe('img-model');
    expect(snapshot!.logContext).toBe('quick_compose_bar_plain');

    const pending = buildPendingTaskFromRetrySnapshot(snapshot!);
    expect(pending.assetId).toBe('a1');
    expect(pending.actionType).toBe('preset_img');
    expect(pending.inputText).toBe('hello');
    expect(pending.promptOverride).toBe('override prompt');
    expect(pending.id).not.toBe('t1');
  });

  it('parseRetrySnapshotFromAuditDetail reads nested snapshot', () => {
    const snapshot = buildRetrySnapshotFromTask(baseTask());
    const parsed = parseRetrySnapshotFromAuditDetail({ retrySnapshot: snapshot, retryable: true });
    expect(parsed?.assetId).toBe('a1');
    expect(parseRetrySnapshotFromAuditDetail(null)).toBeNull();
    expect(parseRetrySnapshotFromAuditDetail({ retrySnapshot: { v: 2 } })).toBeNull();
  });

  it('validateRetrySnapshot checks asset and module', () => {
    const snapshot = buildRetrySnapshotFromTask(baseTask())!;
    expect(
      validateRetrySnapshot({ snapshot, assetExists: false, moduleExists: true })
    ).toBe('源资产已不存在');
    expect(
      validateRetrySnapshot({ snapshot, assetExists: true, moduleExists: false })
    ).toBe('能力预设不存在或已禁用');
    expect(
      validateRetrySnapshot({ snapshot, assetExists: true, moduleExists: true })
    ).toBeNull();
  });
});
