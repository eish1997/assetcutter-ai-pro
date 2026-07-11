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
        providerId: 'vertex-gemini',
        upstreamBackend: 'vertex',
      },
      adapterRequest: {
        method: 'POST',
        path: '/proxy/gemini/async',
      },
    });
  });
});
