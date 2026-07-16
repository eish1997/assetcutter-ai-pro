import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelAuthAiGatewayJob,
  createAuthAiGatewayJob,
  getAuthAiGatewayJob,
  listAuthAiGatewayJobs,
  retryAuthAiGatewayJob,
  summarizeAuthAiGatewayJobs,
} from '../server/ai-gateway/auth-api-handler.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';

function imageJobBody(id, text = 'product render') {
  return {
    id,
    modality: 'image',
    model: 'gemini-3-pro-image-preview',
    input: {
      contents: [{ role: 'user', parts: [{ text }] }],
    },
  };
}

describe('AI gateway auth-api facade', () => {
  const previousExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;

  beforeEach(() => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'false';
  });

  afterEach(() => {
    if (previousExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = previousExecution;
  });

  it('creates a user-owned job and hides provider request bodies from the auth response', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };
    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_1'), user, {
      store,
      modelOpsConfig: { publishedCanonicalModelAllowlist: ['gemini-3-pro-image-preview'] },
    });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      job: {
        id: 'aijob_auth_1',
        userId: 'user_1',
        status: 'created',
      },
      adapterRequest: {
        method: 'POST',
        path: '/proxy/gemini/async',
      },
    });
    expect(result.body.adapterRequest).not.toHaveProperty('body');

    const stored = await store.get('aijob_auth_1');
    expect(stored.job.userId).toBe('user_1');
    expect(stored.job.metadata.authApiFacade).toBe(true);
    expect(stored.job.metadata.modelPublication).toMatchObject({
      canonicalModelId: 'gemini-3-pro-image-preview',
      restricted: true,
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'gemini-3-pro-image-preview',
      providerId: 'vertex-site',
      executionStatus: 'platform_ready',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: false,
    });
  });

  it('rejects auth-api jobs for models not published to the workspace', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    await expect(
      createAuthAiGatewayJob({}, imageJobBody('aijob_auth_blocked'), user, {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['gpt-image-2'] },
      })
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_MODEL_NOT_PUBLISHED',
    });

    expect(await store.get('aijob_auth_blocked')).toBeNull();
  });

  it('keeps Gemini auth job routing aligned with ops fallback instead of pinning a paused Vertex route', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };
    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_vertex_paused'), user, {
      store,
      modelOpsConfig: { publishedCanonicalModelAllowlist: ['gemini-3-pro-image-preview'] },
      opsControl: {
        disabledProviders: ['vertex-site'],
        disabledModels: [],
        modelOverrides: [],
      },
    });

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_vertex_paused');
    expect(stored.job.provider).toBe('gemini-aistudio');
    expect(stored.route).toMatchObject({
      providerId: 'gemini-aistudio',
      workerId: 'image-worker',
      adapterId: 'legacy-gemini-proxy',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      providerId: 'gemini-aistudio',
      gatewayExecutionStatus: 'gateway_ready',
    });
  });

  it('rejects published Ark async models when no usable provider key exists', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    await expect(
      createAuthAiGatewayJob(
        {},
        {
          id: 'aijob_auth_ark_pending',
          modality: 'video',
          model: 'doubao-seedance-2-0',
          provider: 'volcengine-ark',
          input: { prompt: 'render' },
        },
        user,
        {
          store,
          modelOpsConfig: { publishedCanonicalModelAllowlist: ['doubao-seedance-2-0'] },
        }
      )
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
    });

    expect(await store.get('aijob_auth_ark_pending')).toBeNull();
  });

  it('rejects platform-key models when no usable provider key is available', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    await expect(
      createAuthAiGatewayJob(
        {},
        {
          id: 'aijob_auth_tripo_no_key',
          modality: 'model3d',
          provider: 'tripo',
          model: 'tripo-p1',
          input: { type: 'image_to_model' },
        },
        user,
        {
          store,
          modelOpsConfig: { publishedCanonicalModelAllowlist: ['tripo-p1'] },
          listProviderKeys: async () => [],
        }
      )
    ).rejects.toMatchObject({
      code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
    });

    expect(await store.get('aijob_auth_tripo_no_key')).toBeNull();
  });

  it('allows Tripo 3D jobs when a usable provider key exists', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_tripo_ready',
        modality: 'model3d',
        provider: 'tripo',
        model: 'tripo-p1',
        input: { type: 'text_to_model', prompt: 'small crate' },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['tripo-p1'] },
        listProviderKeys: async () => [{ provider: 'tripo', enabled: true, hasSecret: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_tripo_ready');
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'tripo-p1',
      providerId: 'tripo',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows Jimeng video jobs when AK/SK provider credentials exist', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_jimeng_ready',
        modality: 'video',
        provider: 'volcengine-jimeng',
        model: 'jimeng-video-ti2v-v30-pro',
        input: { registryId: 'jimeng-video-ti2v-v30-pro', prompt: 'product clip' },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['jimeng-video-ti2v-v30-pro'] },
        listProviderKeys: async () => [{ provider: 'volcengine-jimeng', enabled: true, hasCredentials: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_jimeng_ready');
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'jimeng-video-ti2v-v30-pro',
      providerId: 'volcengine-jimeng',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows Jimeng image jobs when AK/SK provider credentials exist', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_jimeng_image_ready',
        modality: 'image',
        provider: 'volcengine-jimeng',
        model: 'jimeng-image-t2i-v40',
        input: { registryId: 'jimeng-image-t2i-v40', prompt: 'product image' },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['jimeng-image-t2i-v40'] },
        listProviderKeys: async () => [{ provider: 'volcengine-jimeng', enabled: true, hasCredentials: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_jimeng_image_ready');
    expect(stored.job.provider).toBe('volcengine-jimeng');
    expect(stored.route).toMatchObject({
      providerId: 'volcengine-jimeng',
      workerId: 'image-worker',
      adapterId: 'jimeng-visual',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'jimeng-image-t2i-v40',
      providerId: 'volcengine-jimeng',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows OpenAI image jobs when a platform API key exists and pins the provider route', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_openai_ready',
        modality: 'image',
        model: 'gpt-image-2',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'product image' }] }],
        },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['gpt-image-2'] },
        listProviderKeys: async () => [{ provider: 'openai-official', enabled: true, hasSecret: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_openai_ready');
    expect(stored.job.provider).toBe('openai-official');
    expect(stored.route).toMatchObject({
      providerId: 'openai-official',
      adapterId: 'openai-official',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      providerId: 'openai-official',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows ToAPIs OpenAI-compatible jobs when explicitly requested and a key exists', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_toapis_ready',
        modality: 'image',
        provider: 'toapis',
        model: 'gpt-image-2',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'product image via toapis' }] }],
        },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['gpt-image-2'] },
        listProviderKeys: async () => [{ provider: 'toapis', enabled: true, hasSecret: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_toapis_ready');
    expect(stored.job.provider).toBe('toapis');
    expect(stored.route).toMatchObject({
      providerId: 'toapis',
      adapterId: 'toapis-openai',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'gpt-image-2',
      providerId: 'toapis',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows Volcengine Ark text jobs when a platform API key exists', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_ark_text_ready',
        modality: 'text',
        provider: 'volcengine-ark',
        model: 'doubao-seed-2-0-pro',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'hello ark' }] }],
        },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['doubao-seed-2-0-pro'] },
        listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_ark_text_ready');
    expect(stored.job.provider).toBe('volcengine-ark');
    expect(stored.route).toMatchObject({
      providerId: 'volcengine-ark',
      adapterId: 'volcengine-ark-openai',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'doubao-seed-2-0-pro',
      providerId: 'volcengine-ark',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('allows Volcengine Ark Seedream image jobs when a platform API key exists', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };

    const result = await createAuthAiGatewayJob(
      {},
      {
        id: 'aijob_auth_ark_image_ready',
        modality: 'image',
        provider: 'volcengine-ark',
        model: 'doubao-seedream-5-0',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'product image via ark' }] }],
        },
      },
      user,
      {
        store,
        modelOpsConfig: { publishedCanonicalModelAllowlist: ['doubao-seedream-5-0'] },
        listProviderKeys: async () => [{ provider: 'volcengine-ark', enabled: true, hasSecret: true }],
      }
    );

    expect(result.status).toBe(202);
    const stored = await store.get('aijob_auth_ark_image_ready');
    expect(stored.job.provider).toBe('volcengine-ark');
    expect(stored.route).toMatchObject({
      providerId: 'volcengine-ark',
      adapterId: 'volcengine-ark-image',
    });
    expect(stored.job.metadata.modelRouteGuard).toMatchObject({
      canonicalModelId: 'doubao-seedream-5-0',
      providerId: 'volcengine-ark',
      gatewayExecutionStatus: 'gateway_ready',
      platformKeyRequired: true,
    });
  });

  it('lists only the current user jobs unless admin mode is requested', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    const bob = { id: 'user_2', username: 'bob' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_alice'), alice, { store });
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_bob'), bob, { store });

    const userList = await listAuthAiGatewayJobs(alice, { limit: 10 }, { store });
    expect(userList.status).toBe(200);
    expect(userList.body.items.map((item) => item.id)).toEqual(['aijob_auth_alice']);
    expect(userList.body.items[0]).not.toHaveProperty('input');

    const adminList = await listAuthAiGatewayJobs(alice, { limit: 10 }, { store, admin: true });
    expect(adminList.body.items.map((item) => item.id)).toEqual(['aijob_auth_bob', 'aijob_auth_alice']);
  });

  it('summarizes recent admin jobs for operator health checks', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_ops_ok'), alice, { store });
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_ops_429'), alice, { store });
    await store.update('aijob_auth_ops_ok', { status: 'succeeded' });
    await store.update('aijob_auth_ops_429', {
      status: 'failed',
      error: { code: 'UPSTREAM_429', message: 'Too Many Requests' },
    });

    const summary = await summarizeAuthAiGatewayJobs(alice, { limit: 10 }, { store, admin: true });
    expect(summary.status).toBe(200);
    expect(summary.body.sampleSize).toBe(2);
    expect(summary.body.totals.statusCounts.failed).toBe(1);
    expect(summary.body.totals.errorCounts.rate_limited).toBe(1);
  });

  it('does not reveal another user job by id', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    const bob = { id: 'user_2', username: 'bob' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_bob_private'), bob, { store });

    const forbidden = await getAuthAiGatewayJob('aijob_auth_bob_private', alice, { store });
    expect(forbidden.status).toBe(404);

    const admin = await getAuthAiGatewayJob('aijob_auth_bob_private', alice, { store, admin: true });
    expect(admin.status).toBe(200);
    expect(admin.body.job.id).toBe('aijob_auth_bob_private');
  });

  it('cancels only the current user cancellable jobs', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    const bob = { id: 'user_2', username: 'bob' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_cancel'), alice, { store });

    const hidden = await cancelAuthAiGatewayJob('aijob_auth_cancel', bob, { store });
    expect(hidden.status).toBe(404);

    const cancelled = await cancelAuthAiGatewayJob('aijob_auth_cancel', alice, { store });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job).toMatchObject({
      id: 'aijob_auth_cancel',
      status: 'cancelled',
      error: { code: 'AI_GATEWAY_JOB_CANCELLED' },
    });
    const stored = await store.get('aijob_auth_cancel');
    expect(stored?.job.metadata.workerCancel).toMatchObject({
      cancelled: false,
      mode: 'soft',
      reason: 'legacy_adapter_cancel_not_supported',
    });
  });

  it('creates a new user-owned job when retrying failed or cancelled jobs', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_retry_original'), alice, { store });
    await store.update('aijob_auth_retry_original', {
      status: 'failed',
      error: { code: 'UPSTREAM_429', message: 'Too Many Requests' },
    });

    const retry = await retryAuthAiGatewayJob(
      'aijob_auth_retry_original',
      alice,
      { id: 'aijob_auth_retry_new' },
      { store }
    );
    expect(retry.status).toBe(202);
    expect(retry.body.job).toMatchObject({
      id: 'aijob_auth_retry_new',
      status: 'created',
      userId: 'user_1',
    });

    const stored = await store.get('aijob_auth_retry_new');
    expect(stored.job.input).toEqual(imageJobBody('ignored').input);
    expect(stored.job.metadata).toMatchObject({
      retryOfJobId: 'aijob_auth_retry_original',
      retryOfStatus: 'failed',
      authApiFacade: true,
    });
  });

  it('rejects retry for jobs that are still active', async () => {
    const store = createInMemoryAiJobStore();
    const alice = { id: 'user_1', username: 'alice' };
    await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_active'), alice, { store });

    const retry = await retryAuthAiGatewayJob('aijob_auth_active', alice, {}, { store });
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe('AI_GATEWAY_JOB_NOT_RETRYABLE');
  });
});
