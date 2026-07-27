import { describe, expect, it } from 'vitest';
import { resolveWorkspaceTruthPolicy } from '../services/workspaceTruthPolicy';

const base = {
  companionOnline: true,
  companionDirectorySourceOfTruth: false,
  cloudEnabled: true,
  cloudBundleMergeEnabled: true,
  canSyncProjectToCloud: true,
  cloudPushAllowed: true,
  cloudQuotaSuspended: false,
};

describe('resolveWorkspaceTruthPolicy', () => {
  it('offline without cloud merge → IDB cache', () => {
    const p = resolveWorkspaceTruthPolicy({
      ...base,
      companionOnline: false,
      cloudBundleMergeEnabled: false,
    });
    expect(p.mode).toBe('idb_cache_offline');
    expect(p.runCloudBundleMerge).toBe(false);
    expect(p.preferCompanionWorkflowOnOpen).toBe(false);
    expect(p.mediaBytesSource).toBe('memory_only');
  });

  it('offline but cloud merge eligible → merge path, no companion prefer', () => {
    const p = resolveWorkspaceTruthPolicy({ ...base, companionOnline: false });
    expect(p.mode).toBe('cloud_merge_then_align_companion');
    expect(p.runCloudBundleMerge).toBe(true);
    expect(p.preferCompanionWorkflowOnOpen).toBe(false);
    expect(p.mediaBytesSource).toBe('memory_only');
  });

  it('directory source of truth → companion prefer, never cloud merge', () => {
    const p = resolveWorkspaceTruthPolicy({
      ...base,
      companionDirectorySourceOfTruth: true,
    });
    expect(p.mode).toBe('companion_directory_source');
    expect(p.runCloudBundleMerge).toBe(false);
    expect(p.preferCompanionWorkflowOnOpen).toBe(true);
    expect(p.forbidden).toContain('cloud_merge_overwrite_local_locator');
  });

  it('cloud merge on → merge then align; blocks parallel companion prefer', () => {
    const p = resolveWorkspaceTruthPolicy(base);
    expect(p.mode).toBe('cloud_merge_then_align_companion');
    expect(p.runCloudBundleMerge).toBe(true);
    expect(p.preferCompanionWorkflowOnOpen).toBe(false);
    expect(p.forbidden).toContain('parallel_companion_prefer');
  });

  it('companion online without cloud merge → prefer companion over IDB', () => {
    const p = resolveWorkspaceTruthPolicy({
      ...base,
      cloudBundleMergeEnabled: false,
    });
    expect(p.mode).toBe('companion_prefer_over_idb');
    expect(p.runCloudBundleMerge).toBe(false);
    expect(p.preferCompanionWorkflowOnOpen).toBe(true);
  });
});
