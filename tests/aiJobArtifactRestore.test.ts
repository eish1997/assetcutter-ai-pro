import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestorableAiJobArtifact } from '../services/aiJobArtifacts';

const workflowCompanionAssetsMock = vi.hoisted(() => ({
  fetchWorkflowModelFromCompanionAsObjectUrl: vi.fn(),
  imageSrcToDataUrlForCompanion: vi.fn(),
  parseDataUrlToBlob: vi.fn(),
  putWorkflowModelBlobToCompanion: vi.fn(),
  putWorkflowOriginalImageToCompanion: vi.fn(),
  putWorkflowResultImageToCompanion: vi.fn(),
}));

vi.mock('../services/workflowCompanionAssets', () => workflowCompanionAssetsMock);

const { buildAiJobRestoreAssets } = await import('../services/aiJobArtifactRestore');

function imageArtifact(overrides: Partial<RestorableAiJobArtifact> = {}): RestorableAiJobArtifact {
  return {
    id: 'job:0',
    label: 'image',
    url: 'https://cdn.example.com/out.png',
    mimeType: 'image/png',
    kind: 'image',
    ...overrides,
  };
}

describe('aiJobArtifactRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds restorable workspace assets without requiring companion persistence', async () => {
    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_1',
      artifacts: [imageArtifact()],
      now: 1000,
    });

    expect(result.persistedCount).toBe(0);
    expect(result.failedPersistCount).toBe(0);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!).toMatchObject({
      original: 'https://cdn.example.com/out.png',
      displayKey: 'original',
      archived: false,
      hiddenInGrid: false,
      createdAt: 1000,
    });
    expect(result.assets[0]!.resultMeta?.ai_job_image?.aiGatewayJobId).toBe('aijob_1');
  });

  it('persists image artifacts to companion when companion context is available', async () => {
    workflowCompanionAssetsMock.imageSrcToDataUrlForCompanion.mockResolvedValue('data:image/png;base64,abc');
    workflowCompanionAssetsMock.putWorkflowOriginalImageToCompanion.mockResolvedValue({
      ok: true,
      key: 'wf-orig-a',
    });

    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_2',
      artifacts: [imageArtifact()],
      now: 2000,
      companionBaseUrl: 'http://127.0.0.1:17373',
      companionProjectId: 'project_1',
    });

    expect(result.persistedCount).toBe(1);
    expect(result.failedPersistCount).toBe(0);
    expect(result.assets[0]!.original).toBe('data:image/png;base64,abc');
    expect(result.assets[0]!.originalCompanionKey).toBe('wf-orig-a');
  });
});
