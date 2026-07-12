import { describe, expect, it } from 'vitest';
import {
  createAuthAiGatewayJob,
  getAuthAiGatewayJob,
  listAuthAiGatewayJobs,
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
});

