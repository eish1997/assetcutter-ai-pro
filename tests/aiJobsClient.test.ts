import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/httpClient', () => ({
  requestJson: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/apiBase', () => ({
  apiUrl: (path: string) => `https://auth.example${path}`,
}));

import {
  createAiJob,
  getMyAiJob,
  listAdminAiJobs,
  listMyAiJobs,
} from '../services/aiJobsClient';
import { requestJson } from '../services/httpClient';

describe('aiJobsClient', () => {
  beforeEach(() => {
    vi.mocked(requestJson).mockClear();
  });

  it('creates a user AI job through auth-api', async () => {
    await createAiJob({
      id: 'aijob_client_1',
      modality: 'image',
      model: 'gemini-3-pro-image',
      estimatedCredits: 134,
      input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
    });

    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs', {
      method: 'POST',
      body: JSON.stringify({
        id: 'aijob_client_1',
        modality: 'image',
        model: 'gemini-3-pro-image',
        estimatedCredits: 134,
        input: { contents: [{ role: 'user', parts: [{ text: 'render' }] }] },
      }),
    });
  });

  it('lists my jobs with a clamped limit', async () => {
    await listMyAiJobs({ limit: 500 });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs?limit=100', {
      cache: 'no-store',
    });
  });

  it('reads one user job by id', async () => {
    await getMyAiJob('aijob/with space');
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/ai/jobs/aijob%2Fwith%20space', {
      cache: 'no-store',
    });
  });

  it('rejects empty job ids before requesting', async () => {
    expect(() => getMyAiJob('')).toThrow('Invalid AI job id');
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('lists admin job summaries through auth-api', async () => {
    await listAdminAiJobs({ limit: 0 });
    expect(requestJson).toHaveBeenCalledWith('https://auth.example/api/admin/ai/jobs?limit=20', {
      cache: 'no-store',
    });
  });
});

