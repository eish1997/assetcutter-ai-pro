import { describe, expect, it } from 'vitest';

import {
  stableWorkflowPreviewThumbCacheKey,
  workflowPreviewThumbCompanionStorageKey,
} from '../services/workflowPreviewThumbCompanion';

describe('workflowPreviewThumbCompanionStorageKey', () => {
  it('strips :fp fingerprint so content updates overwrite the same companion object', () => {
    const a = 'asset-1:original:fpabc123';
    const b = 'asset-1:original:fpzzz999';
    expect(stableWorkflowPreviewThumbCacheKey(a)).toBe('asset-1:original');
    expect(stableWorkflowPreviewThumbCacheKey(b)).toBe('asset-1:original');
    expect(workflowPreviewThumbCompanionStorageKey(a, 'micro', 74)).toBe(
      workflowPreviewThumbCompanionStorageKey(b, 'micro', 74)
    );
    expect(workflowPreviewThumbCompanionStorageKey(a, 'thumb', 256)).toBe(
      workflowPreviewThumbCompanionStorageKey(b, 'thumb', 256)
    );
    expect(workflowPreviewThumbCompanionStorageKey(a, 'micro', 74)).not.toBe(
      workflowPreviewThumbCompanionStorageKey(a, 'thumb', 74)
    );
  });
});
