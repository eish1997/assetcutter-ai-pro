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

  it('also strips :r rev, :ck companion path, and stacked :fp suffixes', () => {
    const a =
      'asset-1:vgp-step-graph:v0:ck:asset-1/image-full-0-abc.jpg:fpold12:r1700000001';
    const b =
      'asset-1:vgp-step-graph:v0:ck:asset-1/image-thumb-0-abc.jpg:fpnew99:r1700000999';
    const stripA = 'lightbox-strip:asset-1:original:fp111:fp222';
    const stripB = 'lightbox-strip:asset-1:original:fp999';
    expect(stableWorkflowPreviewThumbCacheKey(a)).toBe('asset-1:vgp-step-graph:v0');
    expect(stableWorkflowPreviewThumbCacheKey(b)).toBe('asset-1:vgp-step-graph:v0');
    expect(stableWorkflowPreviewThumbCacheKey(stripA)).toBe('lightbox-strip:asset-1:original');
    expect(stableWorkflowPreviewThumbCacheKey(stripB)).toBe('lightbox-strip:asset-1:original');
    expect(workflowPreviewThumbCompanionStorageKey(a, 'thumb', 128)).toBe(
      workflowPreviewThumbCompanionStorageKey(b, 'thumb', 128)
    );
    expect(workflowPreviewThumbCompanionStorageKey(stripA, 'micro', 128)).toBe(
      workflowPreviewThumbCompanionStorageKey(stripB, 'micro', 128)
    );
  });
});
