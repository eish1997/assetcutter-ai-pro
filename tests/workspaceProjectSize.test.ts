import { describe, expect, it } from 'vitest';
import {
  computeWorkspaceProjectTotalBytes,
  estimatePersistedStringBytes,
  formatWorkspaceProjectByteSize,
  sumCompanionManifestBytes,
} from '../services/workspaceProjectSize';

describe('workspaceProjectSize', () => {
  it('estimates data URL payload bytes', () => {
    expect(estimatePersistedStringBytes('data:image/png;base64,AAAA')).toBe(3);
  });

  it('sums manifest entry sizes', () => {
    expect(
      sumCompanionManifestBytes({
        layoutVersion: 1,
        projectId: 'p1',
        updatedAt: 1,
        entries: [
          { key: 'a', relPath: 'a', byteSize: 100, tags: [], lineage: null, updatedAt: 1 },
          { key: 'b', relPath: 'b', byteSize: 250, tags: [], lineage: null, updatedAt: 1 },
        ],
      })
    ).toBe(350);
  });

  it('prefers larger of manifest vs inline media', () => {
    const total = computeWorkspaceProjectTotalBytes(
      {
        assets: [{ id: 'a', original: 'tiny', displayKey: 'original', results: {} }],
        pending: [],
      },
      5000
    );
    expect(total).toBeGreaterThanOrEqual(5000);
  });

  it('formats human-readable sizes', () => {
    expect(formatWorkspaceProjectByteSize(1536)).toBe('1.5 KB');
    expect(formatWorkspaceProjectByteSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
