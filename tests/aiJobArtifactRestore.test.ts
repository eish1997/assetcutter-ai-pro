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
const httpClientMock = vi.hoisted(() => ({
  requestJson: vi.fn(),
}));

vi.mock('../services/workflowCompanionAssets', () => workflowCompanionAssetsMock);
vi.mock('../services/httpClient', () => httpClientMock);

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

function artifact(overrides: Partial<RestorableAiJobArtifact>): RestorableAiJobArtifact {
  return {
    id: 'job:any',
    label: 'artifact',
    url: 'https://cdn.example.com/out.bin',
    mimeType: 'application/octet-stream',
    kind: 'file',
    ...overrides,
  };
}

describe('aiJobArtifactRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
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

  it('writes standardized source metadata into restored asset resultMeta', async () => {
    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_source',
      artifacts: [
        imageArtifact({
          source: {
            source: 'ai_gateway',
            aiGatewayJobId: 'aijob_source',
            providerId: 'volcengine-ark',
            modelId: 'doubao-seedream-5-0',
            canonicalModelId: 'doubao-seedream-5-0',
            registryId: 'doubao-seedream-5-0',
            modality: 'image',
            capability: 'image.generate',
            paramsSnapshot: { aspectRatio: '1:1' },
          },
        }),
      ],
      now: 1100,
    });

    expect(result.assets[0]!.resultMeta?.ai_job_image?.source).toMatchObject({
      source: 'ai_gateway',
      aiGatewayJobId: 'aijob_source',
      providerId: 'volcengine-ark',
      modelId: 'doubao-seedream-5-0',
      canonicalModelId: 'doubao-seedream-5-0',
      paramsSnapshot: { aspectRatio: '1:1' },
    });
  });

  it('builds text assets from text artifacts', async () => {
    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_text',
      artifacts: [
        artifact({
          label: 'Generated copy',
          url: undefined,
          text: 'A polished launch tagline.',
          mimeType: 'text/plain',
          kind: 'text',
        }),
      ],
      now: 1200,
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      assetKind: 'text',
      textTitle: 'Generated copy',
      displayKey: 'ai_job_text',
      textResults: { ai_job_text: 'A polished launch tagline.' },
      resultOrder: ['ai_job_text'],
    });
    expect(result.assets[0]!.resultMeta?.ai_job_text).toMatchObject({
      mediaKind: 'text',
      aiGatewayJobId: 'aijob_text',
    });
  });

  it('builds audio assets from audio artifacts', async () => {
    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_audio',
      artifacts: [
        artifact({
          label: 'Generated music',
          url: 'https://cdn.example.com/song.mp3',
          mimeType: 'audio/mpeg',
          kind: 'audio',
        }),
      ],
      now: 1300,
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      assetKind: 'audio',
      original: 'https://cdn.example.com/song.mp3',
      displayKey: 'ai_job_audio',
      results: { ai_job_audio: 'https://cdn.example.com/song.mp3' },
      resultOrder: ['ai_job_audio'],
    });
    expect(result.assets[0]!.resultMeta?.ai_job_audio).toMatchObject({
      mediaKind: 'audio',
      aiGatewayJobId: 'aijob_audio',
    });
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

  it('keeps asset persistence on companion by default even when cloud context is available', async () => {
    workflowCompanionAssetsMock.imageSrcToDataUrlForCompanion.mockResolvedValue('data:image/png;base64,abc');
    workflowCompanionAssetsMock.putWorkflowOriginalImageToCompanion.mockResolvedValue({
      ok: true,
      key: 'wf-orig-cloud-default',
    });

    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_3',
      artifacts: [imageArtifact()],
      now: 3000,
      cloudUserId: 'user_1',
      cloudUsername: 'alice',
      cloudProjectId: 'project_1',
      companionBaseUrl: 'http://127.0.0.1:17373',
      companionProjectId: 'project_1',
    });

    expect(result.persistedCount).toBe(1);
    expect(result.assets[0]!.originalCompanionKey).toBe('wf-orig-cloud-default');
    expect(result.assets[0]!.originalObjectKey).toBeUndefined();
    expect(httpClientMock.requestJson).not.toHaveBeenCalled();
  });

  it('persists image artifacts to R2 only when explicitly enabled', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    workflowCompanionAssetsMock.imageSrcToDataUrlForCompanion.mockResolvedValue('data:image/png;base64,abc');
    workflowCompanionAssetsMock.parseDataUrlToBlob.mockReturnValue({ blob, mime: 'image/png' });
    httpClientMock.requestJson
      .mockResolvedValueOnce({ uploadUrl: 'https://upload.example.com/put', objectKey: 'ignored' })
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    const result = await buildAiJobRestoreAssets({
      jobId: 'aijob_3',
      artifacts: [imageArtifact()],
      now: 3000,
      cloudUserId: 'user_1',
      cloudUsername: 'alice',
      cloudProjectId: 'project_1',
      cloudAssetPersistenceEnabled: true,
      companionBaseUrl: 'http://127.0.0.1:17373',
      companionProjectId: 'project_1',
    });

    expect(result.persistedCount).toBe(1);
    expect(result.failedPersistCount).toBe(0);
    expect(result.assets[0]!.original).toBe('');
    expect(result.assets[0]!.originalObjectKey).toContain('users/alice-user_1/workspace/projects/project_1/assets/');
    expect(workflowCompanionAssetsMock.putWorkflowOriginalImageToCompanion).not.toHaveBeenCalled();
  });
});
