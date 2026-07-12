import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthAiGatewayJob } from '../server/ai-gateway/auth-api-handler.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';

function imageJobBody(id: string) {
  return {
    id,
    modality: 'image',
    model: 'gemini-3-pro-image-preview',
    input: {
      contents: [{ role: 'user', parts: [{ text: 'clean product render' }] }],
      config: { responseModalities: ['IMAGE'] },
      costWeight: 2,
    },
  };
}

function proxyResponse(body: unknown, ok = true, status = 202) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('AI gateway execution handoff', () => {
  const prevExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;
  const user = { id: 'user_exec_1', username: 'alice' };

  afterEach(() => {
    if (prevExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = prevExecution;
  });

  it('keeps auth-api job creation as planning-only when execution is disabled', async () => {
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn();

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_dry'), user, { store, fetchImpl });

    expect(result.status).toBe(202);
    expect(result.body.job.status).toBe('created');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hands image jobs to gemini-proxy when execution is explicitly enabled', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ jobId: 'gasync_exec_1', status: 'queued' }));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_start'), user, { store, fetchImpl });

    expect(result.status).toBe(202);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_start',
      status: 'queued',
      proxyJobId: 'gasync_exec_1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/proxy/gemini/async');
    expect(init.headers).toMatchObject({
      'x-ac-task-envelope': 'aijob_exec_start',
      'X-AC-Fairness-Key': 'user:user_exec_1',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gemini-3-pro-image-preview',
      aiBackend: 'vertex',
      fairnessMeta: {
        aiGatewayTraceJobId: 'aijob_exec_start',
        costWeight: 2,
      },
    });
  });

  it('marks the job failed when proxy handoff is rejected', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ error: 'proxy down' }, false, 502));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_fail'), user, { store, fetchImpl });

    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_fail',
      status: 'failed',
      error: {
        code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
      },
    });
    const stored = await store.get('aijob_exec_fail');
    expect(stored.job.metadata.gatewayExecution.error).toContain('HTTP 502');
  });
});
