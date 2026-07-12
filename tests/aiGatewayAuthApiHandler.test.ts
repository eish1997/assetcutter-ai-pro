import { describe, expect, it } from 'vitest';
import {
  cancelAuthAiGatewayJob,
  createAuthAiGatewayJob,
  getAuthAiGatewayJob,
  listAuthAiGatewayJobs,
  retryAuthAiGatewayJob,
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
  it('creates a user-owned job and hides provider request bodies from the auth response', async () => {
    const store = createInMemoryAiJobStore();
    const user = { id: 'user_1', username: 'alice' };
    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_auth_1'), user, { store });

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
