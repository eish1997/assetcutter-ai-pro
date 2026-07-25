import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({ value: { version: 1, users: [], sessions: [] } }));

vi.mock('../server/auth-store.js', () => ({
  readDb: () => mockDb.value,
  writeDb: (next) => {
    mockDb.value = JSON.parse(JSON.stringify(next));
  },
  USE_POSTGRES: false,
  getPool: () => null,
  ensurePostgres: async () => {},
}));

describe('persistent AI gateway job store', () => {
  beforeEach(() => {
    mockDb.value = { version: 1, users: [], sessions: [] };
  });

  it('persists and restores job plans through the JSON fallback shape', async () => {
    const { createAiGatewayJobPlan } = await import('../server/ai-gateway/index.js');
    const { createPersistentAiJobStore } = await import('../server/ai-gateway/persistent-job-store.js');
    const store = createPersistentAiJobStore();
    const plan = createAiGatewayJobPlan(
      {
        id: 'aijob_persist_1',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_1',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'persist me' }] }],
        },
      },
      { nowIso: '2026-07-11T00:00:00.000Z' }
    );

    await store.put(plan);
    expect(mockDb.value.aiGatewayJobs).toHaveLength(1);

    const restored = await store.get('aijob_persist_1');
    expect(restored).toMatchObject({
      job: {
        id: 'aijob_persist_1',
        status: 'created',
        modality: 'image',
        userId: 'user_1',
      },
      route: {
        providerId: 'vertex-site',
        upstreamBackend: 'vertex',
      },
      adapterRequest: {
        method: 'POST',
        path: '/proxy/gemini/async',
      },
    });

    const listed = await store.list({ limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0].job.id).toBe('aijob_persist_1');

    const otherPlan = createAiGatewayJobPlan(
      {
        id: 'aijob_persist_2',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_2',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'other user' }] }],
        },
      },
      { nowIso: '2026-07-11T00:01:00.000Z' }
    );
    await store.put(otherPlan);
    const userOnly = await store.list({ limit: 10, userId: 'user_1' });
    expect(userOnly.map((item) => item.job.id)).toEqual(['aijob_persist_1']);

    await store.update('aijob_persist_1', {
      status: 'failed',
      error: { code: 'UPSTREAM_FAILED', message: 'provider failed' },
      metadata: { proxyJobId: 'gasync_persist_1' },
    });

    const updated = await store.get('aijob_persist_1');
    expect(updated).toMatchObject({
      job: {
        id: 'aijob_persist_1',
        status: 'failed',
        error: { code: 'UPSTREAM_FAILED', message: 'provider failed' },
        metadata: { proxyJobId: 'gasync_persist_1' },
      },
    });
    expect(updated.job.finishedAt).toBeTruthy();
  });

  it('redacts transient 3D image inputs from persisted job records', async () => {
    const { createAiGatewayJobPlan } = await import('../server/ai-gateway/index.js');
    const { createPersistentAiJobStore } = await import('../server/ai-gateway/persistent-job-store.js');
    const store = createPersistentAiJobStore();
    const plan = createAiGatewayJobPlan({
      id: 'aijob_persist_3d',
      provider: 'tripo',
      modality: 'model3d',
      input: {
        type: 'image_to_model',
        prompt: 'crate',
        imageBase64DataUrl: 'data:image/png;base64,QUJDRA==',
        multiviewImageBase64DataUrls: {
          front: 'data:image/png;base64,RlJPTlQ=',
        },
      },
    });

    await store.put(plan);

    const raw = JSON.stringify(mockDb.value.aiGatewayJobs[0]);
    expect(raw).not.toContain('QUJDRA==');
    expect(raw).not.toContain('RlJPTlQ=');
    expect(raw).toContain('[REDACTED_MEDIA:');
  });

  it('redacts large inline media outputs and artifacts from persisted job records', async () => {
    const { createAiGatewayJobPlan } = await import('../server/ai-gateway/index.js');
    const { createPersistentAiJobStore } = await import('../server/ai-gateway/persistent-job-store.js');
    const store = createPersistentAiJobStore();
    const plan = createAiGatewayJobPlan({
      id: 'aijob_persist_large_output',
      modality: 'image',
      model: 'gemini-3-pro-image-preview',
      input: { contents: [{ role: 'user', parts: [{ text: 'tiny prompt' }] }] },
    });

    await store.put(plan);
    await store.update('aijob_persist_large_output', {
      status: 'succeeded',
      output: {
        image: 'data:image/png;base64,' + 'A'.repeat(10000),
        rawImage: 'data:image/png;base64,' + 'C'.repeat(10000),
        publicUrl: 'https://cdn.example.com/result.png',
      },
      artifacts: [
        {
          type: 'image',
          url: 'data:image/png;base64,' + 'B'.repeat(10000),
          previewUrl: 'https://cdn.example.com/preview.png',
        },
      ],
    });

    const raw = JSON.stringify(mockDb.value.aiGatewayJobs[0]);
    expect(raw).not.toContain('A'.repeat(100));
    expect(raw).not.toContain('B'.repeat(100));
    expect(raw).not.toContain('C'.repeat(100));
    expect(raw).toContain('[REDACTED_MEDIA:');
    expect(raw).toContain('https://cdn.example.com/result.png');
    expect(raw).toContain('https://cdn.example.com/preview.png');
  });

  it('filters JSON fallback job lists by status, provider, modality, and keyword', async () => {
    const { createAiGatewayJobPlan } = await import('../server/ai-gateway/index.js');
    const { createPersistentAiJobStore } = await import('../server/ai-gateway/persistent-job-store.js');
    const store = createPersistentAiJobStore();
    const imagePlan = createAiGatewayJobPlan(
      {
        id: 'aijob_filter_image',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_filter_1',
        input: { contents: [{ role: 'user', parts: [{ text: 'filter image' }] }] },
      },
      { nowIso: '2026-07-11T00:00:00.000Z' }
    );
    const modelPlan = createAiGatewayJobPlan(
      {
        id: 'aijob_filter_model',
        modality: 'model3d',
        provider: 'tripo',
        userId: 'user_filter_2',
        input: { prompt: 'filter crate' },
      },
      { nowIso: '2026-07-11T00:01:00.000Z' }
    );

    await store.put(imagePlan);
    await store.put(modelPlan);
    await store.update('aijob_filter_model', {
      status: 'failed',
      error: { code: 'TRIPO_FAILED', message: 'tripo upstream failed' },
    });

    expect((await store.list({ limit: 10, status: 'failed' })).map((item) => item.job.id)).toEqual(['aijob_filter_model']);
    expect((await store.list({ limit: 10, provider: 'tripo' })).map((item) => item.job.id)).toEqual(['aijob_filter_model']);
    expect((await store.list({ limit: 10, modality: 'image' })).map((item) => item.job.id)).toEqual(['aijob_filter_image']);
    expect((await store.list({ limit: 10, q: 'upstream' })).map((item) => item.job.id)).toEqual(['aijob_filter_model']);
  });

  it('B7: filters JSON fallback lists by gatewayFailure stage/owner including __missing__', async () => {
    const { createAiGatewayJobPlan } = await import('../server/ai-gateway/index.js');
    const { createPersistentAiJobStore } = await import('../server/ai-gateway/persistent-job-store.js');
    const store = createPersistentAiJobStore();
    const upstream = createAiGatewayJobPlan(
      {
        id: 'aijob_fail_upstream',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_fail_1',
        input: { contents: [{ role: 'user', parts: [{ text: 'x' }] }] },
      },
      { nowIso: '2026-07-11T00:02:00.000Z' }
    );
    const bare = createAiGatewayJobPlan(
      {
        id: 'aijob_fail_bare',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        userId: 'user_fail_2',
        input: { contents: [{ role: 'user', parts: [{ text: 'y' }] }] },
      },
      { nowIso: '2026-07-11T00:03:00.000Z' }
    );
    await store.put(upstream);
    await store.put(bare);
    await store.update('aijob_fail_upstream', {
      status: 'failed',
      error: { code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED', message: '429' },
      metadata: {
        gatewayFailure: {
          stage: 'upstream',
          owner: 'upstream',
          code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
        },
      },
    });
    await store.update('aijob_fail_bare', {
      status: 'failed',
      error: { code: 'AI_GATEWAY_JOB_FAILED', message: 'bare' },
    });

    expect((await store.list({ limit: 10, failureStage: 'upstream' })).map((item) => item.job.id)).toEqual([
      'aijob_fail_upstream',
    ]);
    expect((await store.list({ limit: 10, failureOwner: 'upstream' })).map((item) => item.job.id)).toEqual([
      'aijob_fail_upstream',
    ]);
    expect((await store.list({ limit: 10, failureStage: '__missing__' })).map((item) => item.job.id)).toEqual([
      'aijob_fail_bare',
    ]);
    expect((await store.list({ limit: 10, failureOwner: '__missing__' })).map((item) => item.job.id)).toEqual([
      'aijob_fail_bare',
    ]);
  });
});
