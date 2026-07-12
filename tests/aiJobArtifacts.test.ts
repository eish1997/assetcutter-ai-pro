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
      legacyPath: null,
      proxyJobId: null,
      creditsGate: null,
      error: null,
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
});
