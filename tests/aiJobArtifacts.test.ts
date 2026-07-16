import { describe, expect, it } from 'vitest';
import { extractRestorableAiJobArtifacts } from '../services/aiJobArtifacts';
import type { AiJobDetail } from '../services/aiJobsClient';

function makeDetail(overrides: Partial<AiJobDetail['job']> = {}): AiJobDetail {
  return {
    job: {
      id: 'aijob_restore',
      status: 'succeeded',
      modality: 'image',
      capability: 'image.generate',
      provider: 'vertex',
      model: 'gemini-image',
      userId: 'user_1',
      correlationId: 'corr_1',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      route: null,
      traceOnly: false,
      proxyPath: null,
      proxyJobId: null,
      creditsGate: null,
      error: null,
      metadata: {},
      output: null,
      artifacts: [],
      ...overrides,
    },
    route: null,
    adapterRequest: null,
  };
}

describe('aiJobArtifacts', () => {
  it('extracts restorable media from artifacts and output', () => {
    const artifacts = extractRestorableAiJobArtifacts(
      makeDetail({
        artifacts: [{ label: 'result', url: 'https://cdn.example.com/out.png', mimeType: 'image/png' }],
        output: {
          imageUrl: 'https://cdn.example.com/out.png',
          video: { videoUrl: 'https://cdn.example.com/clip.mp4' },
          model: { modelUrl: 'https://cdn.example.com/mesh.glb' },
        },
      })
    );

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['image', 'video', 'model3d']);
    expect(artifacts[0]!.label).toBe('result');
  });

  it('attaches standardized source metadata to restorable artifacts', () => {
    const artifacts = extractRestorableAiJobArtifacts(
      makeDetail({
        provider: 'volcengine-ark',
        model: 'doubao-seedream-5-0',
        route: {
          providerId: 'volcengine-ark',
          workerId: 'image-worker',
          adapterId: 'volcengine-ark-image',
          channel: 'volcengine-ark',
          upstreamBackend: 'ark',
        },
        metadata: {
          canonicalModelId: 'doubao-seedream-5-0',
          registryId: 'doubao-seedream-5-0',
          paramsSnapshot: { size: '1024x1024' },
        },
        artifacts: [{ label: 'ark image', url: 'https://cdn.example.com/ark.png', mimeType: 'image/png' }],
      })
    );

    expect(artifacts[0]!.source).toMatchObject({
      source: 'ai_gateway',
      aiGatewayJobId: 'aijob_restore',
      providerId: 'volcengine-ark',
      modelId: 'doubao-seedream-5-0',
      canonicalModelId: 'doubao-seedream-5-0',
      registryId: 'doubao-seedream-5-0',
      modality: 'image',
      capability: 'image.generate',
      adapterId: 'volcengine-ark-image',
      paramsSnapshot: { size: '1024x1024' },
    });
  });

  it('ignores non-media URLs and duplicate media URLs', () => {
    const artifacts = extractRestorableAiJobArtifacts(
      makeDetail({
        output: {
          pageUrl: 'https://example.com/page',
          nested: [{ image_url: 'https://cdn.example.com/a.webp' }, 'https://cdn.example.com/a.webp'],
        },
      })
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.url).toBe('https://cdn.example.com/a.webp');
  });

  it('extracts restorable audio URLs from music jobs', () => {
    const artifacts = extractRestorableAiJobArtifacts(
      makeDetail({
        modality: 'music',
        capability: 'music.generate',
        output: {
          musicUrl: 'https://cdn.example.com/song.mp3',
        },
      })
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: 'audio',
      url: 'https://cdn.example.com/song.mp3',
    });
  });

  it('extracts text outputs only for text jobs', () => {
    const artifacts = extractRestorableAiJobArtifacts(
      makeDetail({
        modality: 'text',
        capability: 'text.generate',
        output: {
          title: 'Generated copy',
          text: 'A polished launch tagline.',
        },
      })
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: 'text',
      label: 'Generated copy',
      text: 'A polished launch tagline.',
      mimeType: 'text/plain',
    });
  });
});
