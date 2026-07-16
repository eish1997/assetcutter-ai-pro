import { describe, expect, it } from 'vitest';

import { buildModelAvailabilitySummary } from '../server/ai-gateway/model-availability-summary.js';

function model(canonicalModelId, modality, providerId) {
  return {
    canonicalModelId,
    modality,
    routes: [{ providerId, modality }],
  };
}

describe('AI gateway model availability summary', () => {
  it('marks OpenAI-compatible routes as key missing until a platform key exists', async () => {
    const missing = await buildModelAvailabilitySummary(
      { models: [model('gpt-image-2', 'image', 'openai-official')] },
      { listProviderKeys: async () => [] }
    );
    expect(missing.models[0]).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      status: 'key_missing',
      workspaceSelectable: false,
      reasonCode: 'key_missing',
    });

    const ready = await buildModelAvailabilitySummary(
      { models: [model('gpt-image-2', 'image', 'openai-official')] },
      { listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }] }
    );
    expect(ready.models[0]).toMatchObject({
      status: 'ready',
      workspaceSelectable: true,
      reasonCode: 'ready',
    });
  });

  it('marks ToAPIs, Jimeng video, and Tripo P1 ready when matching platform keys exist', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('gpt-image-2', 'image', 'toapis'),
          model('jimeng-video-ti2v-v30-pro', 'video', 'volcengine-jimeng'),
          model('tripo-p1', 'model3d', 'tripo'),
        ],
      },
      {
        listProviderKeys: async () => [
          { provider: 'toapis', enabled: true, hasSecret: true },
          { provider: 'volcengine-jimeng', enabled: true, hasCredentials: true },
          { provider: 'tripo', enabled: true, hasSecret: true },
        ],
      }
    );

    expect(summary.models.map((row) => [row.canonicalModelId, row.status])).toEqual([
      ['gpt-image-2', 'ready'],
      ['jimeng-video-ti2v-v30-pro', 'ready'],
      ['tripo-p1', 'ready'],
    ]);
    expect(summary.totals.ready).toBe(3);
  });

  it('marks Volcengine Ark text, Seedream image, Seedance video, and Seed3D ready when a key exists', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          model('doubao-seed-2-0-pro', 'text', 'volcengine-ark'),
          model('doubao-seedream-5-0', 'image', 'volcengine-ark'),
          model('doubao-seedance-2-0', 'video', 'volcengine-ark'),
          model('doubao-seed3d-2-0', 'model3d', 'volcengine-ark'),
        ],
      },
      { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
    );

    expect(summary.models.map((row) => [row.canonicalModelId, row.status])).toEqual([
      ['doubao-seed-2-0-pro', 'ready'],
      ['doubao-seedream-5-0', 'ready'],
      ['doubao-seedance-2-0', 'ready'],
      ['doubao-seed3d-2-0', 'ready'],
    ]);
  });

  it('marks Volcengine Ark executable draft models as key missing until configured', async () => {
    const summary = await buildModelAvailabilitySummary(
      { models: [model('doubao-seedance-2-0', 'video', 'volcengine-ark')] },
      { listProviderKeys: async () => [] }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'key_missing',
      workspaceSelectable: false,
      reasonCode: 'key_missing',
    });
  });

  it('marks route candidates with endpoint mapping gaps as parameter pending', async () => {
    const summary = await buildModelAvailabilitySummary(
      {
        models: [
          {
            canonicalModelId: 'custom-image-model',
            modality: 'image',
            routes: [
              {
                providerId: 'volcengine-ark',
                modality: 'image',
                executionStatus: 'requires_endpoint_mapping',
                requiresEndpointMapping: true,
              },
            ],
          },
        ],
      },
      { listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }] }
    );

    expect(summary.models[0]).toMatchObject({
      status: 'parameter_pending',
      workspaceSelectable: false,
      reasonCode: 'parameter_pending',
    });
    expect(summary.totals.parameterPending).toBe(1);
  });
});
