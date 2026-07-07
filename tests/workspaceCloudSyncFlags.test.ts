import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  isWorkspaceCloudProjectIndexAutoSyncEnabled,
  isWorkspaceCompanionDirectorySourceOfTruth,
} from '../services/workspaceCloudSync';

describe('workspaceCloudSync flags', () => {
  const prev = import.meta.env.VITE_WORKSPACE_CLOUD_INDEX_SYNC;

  afterEach(() => {
    import.meta.env.VITE_WORKSPACE_CLOUD_INDEX_SYNC = prev;
  });

  beforeEach(() => {
    import.meta.env.VITE_WORKSPACE_CLOUD_INDEX_SYNC = '';
  });

  it('defaults to companion directory as source of truth', () => {
    expect(isWorkspaceCloudProjectIndexAutoSyncEnabled()).toBe(false);
    expect(isWorkspaceCompanionDirectorySourceOfTruth()).toBe(true);
  });

  it('enables index auto sync when env is true', () => {
    import.meta.env.VITE_WORKSPACE_CLOUD_INDEX_SYNC = '1';
    expect(isWorkspaceCloudProjectIndexAutoSyncEnabled()).toBe(true);
    expect(isWorkspaceCompanionDirectorySourceOfTruth()).toBe(false);
  });
});
