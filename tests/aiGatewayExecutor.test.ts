import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthAiGatewayJob } from '../server/ai-gateway/auth-api-handler.js';
import { recoverAiGatewayQueuedJobs, shouldRecoverAiGatewayJob } from '../server/ai-gateway/recovery.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { pollAiWorkerProxyJob } from '../server/ai-gateway/adapters/ai-worker-proxy-execution.js';
import { verifyAiGatewayHandoffToken } from '../server/ai-gateway/handoff-token.js';

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

function mockedReservedCreditsGate(reserveKey: string, estimatedCredits = 2) {
  return vi.fn().mockResolvedValue({
    ok: true,
    metadata: {
      creditsGate: {
        mode: 'reserve',
        enabled: true,
        estimatedCredits,
        reserveKey,
        checked: true,
        reserved: true,
        reserveAmount: estimatedCredits,
      },
    },
  });
}

describe('AI gateway execution handoff', () => {
  const prevExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;
  const prevHmacSecret = process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET;
  const prevAgentPlatformKey = process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
  const user = { id: 'user_exec_1', username: 'alice' };

  beforeEach(() => {
    process.env.GOOGLE_AGENT_PLATFORM_API_KEY = 'test_agent_platform_key';
  });

  afterEach(() => {
    if (prevExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = prevExecution;
    if (prevHmacSecret === undefined) delete process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET;
    else process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = prevHmacSecret;
    if (prevAgentPlatformKey === undefined) delete process.env.GOOGLE_AGENT_PLATFORM_API_KEY;
    else process.env.GOOGLE_AGENT_PLATFORM_API_KEY = prevAgentPlatformKey;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps auth-api job creation as planning-only when execution is explicitly disabled', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'false';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn();

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_dry'), user, { store, fetchImpl });

    expect(result.status).toBe(202);
    expect(result.body.job.status).toBe('created');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hands image jobs to ai-worker-proxy by default', async () => {
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = 'test_handoff_secret';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ jobId: 'gasync_exec_1', status: 'queued' }));

    const result = await createAuthAiGatewayJob(
      { headers: { cookie: 'ac_session=session_1; ac_csrf=csrf_1' } },
      imageJobBody('aijob_exec_start'),
      user,
      { store, fetchImpl, evaluateCreditsGate: mockedReservedCreditsGate('aijob:aijob_exec_start') }
    );

    expect(result.status).toBe(202);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_start',
      status: 'queued',
      proxyJobId: 'gasync_exec_1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/proxy/gemini/async');
    expect(init.dispatcher).toBeTruthy();
    expect(init.headers).toMatchObject({
      Cookie: 'ac_session=session_1; ac_csrf=csrf_1',
      'x-ac-task-envelope': 'aijob_exec_start',
      'X-AC-Fairness-Key': 'user:user_exec_1',
    });
    expect(init.headers['X-AC-Fairness-Signature']).toMatch(/^\d+\.[a-f0-9]+$/);
    const handoff = verifyAiGatewayHandoffToken(init.headers['X-AC-AI-Gateway-Handoff']);
    expect(handoff).toMatchObject({
      ok: true,
      payload: {
        jobId: 'aijob_exec_start',
        userId: 'user_exec_1',
        reserveKey: 'aijob:aijob_exec_start',
        estimatedCredits: 2,
      },
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

  it('can return queued immediately while execution continues in the background', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = 'test_handoff_secret';
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = await createAuthAiGatewayJob(
      { headers: { cookie: 'ac_session=session_1' } },
      imageJobBody('aijob_exec_background'),
      user,
      {
        store,
        fetchImpl,
        awaitExecution: false,
        evaluateCreditsGate: mockedReservedCreditsGate('aijob:aijob_exec_background'),
      }
    );

    expect(result.status).toBe(202);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_background',
      status: 'queued',
    });
    expect(result.body.job.metadata.gatewayExecution).toMatchObject({
      background: true,
      targetPath: '/proxy/gemini/async',
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });

  it('marks the job failed when proxy handoff is rejected with a non-transient error', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ error: 'bad request' }, false, 400));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_fail'), user, {
      store,
      fetchImpl,
      handoffRetries: 0,
    });

    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_fail',
      status: 'failed',
      error: {
        code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
      },
    });
    const stored = await store.get('aijob_exec_fail');
    expect(stored.job.metadata.gatewayExecution.error).toContain('HTTP 400');
  });

  it('keeps transient proxy handoff failures queued for deferred retry', async () => {
    vi.useFakeTimers();
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse('<!DOCTYPE html><title>502</title>', false, 502));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_defer_502'), user, {
      store,
      fetchImpl,
      handoffRetries: 0,
      handoffHealthProbe: false,
      deferredHandoffDelayMs: 60_000,
      deferredHandoffJitterMs: 0,
      deferredHandoffMaxAttempts: 3,
    });

    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_defer_502',
      status: 'queued',
    });
    expect(result.body.job.error).toBeNull();
    const stored = await store.get('aijob_exec_defer_502');
    expect(stored.job.status).toBe('queued');
    expect(stored.job.metadata.gatewayExecution).toMatchObject({
      deferredAttempt: 1,
      deferredMaxAttempts: 3,
      nextRetryInMs: 60_000,
    });
    expect(stored.job.metadata.gatewayExecution.lastHandoffError).toContain('HTTP 502');
  });

  it('retries transient proxy handoff rate limits before failing the job', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(proxyResponse('Too Many Requests', false, 429))
      .mockResolvedValueOnce(proxyResponse({ jobId: 'gasync_retry_1', status: 'queued' }));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_retry_429'), user, {
      store,
      fetchImpl,
      handoffRetryDelayMs: 0,
      handoffRetryJitterMs: 0,
      handoffRetries: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_retry_429',
      status: 'queued',
      proxyJobId: 'gasync_retry_1',
    });
  });

  it('retries transient worker 502 handoff failures before failing the job', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(proxyResponse('<!DOCTYPE html><title>502</title>', false, 502))
      .mockResolvedValueOnce(proxyResponse({ jobId: 'gasync_retry_502', status: 'queued' }));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_retry_502'), user, {
      store,
      fetchImpl,
      handoffRetryDelayMs: 0,
      handoffRetryJitterMs: 0,
      handoffRetries: 1,
      handoffHealthProbe: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_retry_502',
      status: 'queued',
      proxyJobId: 'gasync_retry_502',
    });
  });

  it('retries transient worker connection failures before failing the job', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(proxyResponse({ jobId: 'gasync_retry_conn', status: 'queued' }));

    const result = await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_retry_conn'), user, {
      store,
      fetchImpl,
      handoffRetryDelayMs: 0,
      handoffRetryJitterMs: 0,
      handoffRetries: 1,
      handoffHealthProbe: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.body.job).toMatchObject({
      id: 'aijob_exec_retry_conn',
      status: 'queued',
      proxyJobId: 'gasync_retry_conn',
    });
  });

  it('polls proxy completion back into auth job store with redacted artifacts', async () => {
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    const store = createInMemoryAiJobStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(proxyResponse({ jobId: 'gasync_done_1', status: 'queued' }))
      .mockResolvedValueOnce(
        proxyResponse({
          status: 'completed',
          result: {
            candidates: [
              {
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJDRA==' } }],
                },
              },
            ],
          },
        }, true, 200)
      );

    await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_done'), user, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      awaitBackgroundPoll: true,
    });

    const stored = await store.get('aijob_exec_done');
    expect(fetchImpl.mock.calls[0][1].dispatcher).toBeTruthy();
    expect(fetchImpl.mock.calls[1][1].dispatcher).toBeTruthy();
    expect(stored.job.status).toBe('succeeded');
    expect(stored.job.artifacts).toEqual([
      expect.objectContaining({
        kind: 'image',
        mimeType: 'image/png',
        bytes: 4,
        inlineData: true,
        url: 'data:image/png;base64,QUJDRA==',
      }),
    ]);
    expect(JSON.stringify(stored.job.output)).not.toContain('QUJDRA==');
    expect(stored.job.output).toMatchObject({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: '[REDACTED_BASE64:4B]' } }],
          },
        },
      ],
    });
  });

  it('clears stale handoff errors when proxy polling succeeds', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'false';
    const store = createInMemoryAiJobStore();
    await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_clear_stale_error'), user, { store });
    await store.update('aijob_exec_clear_stale_error', {
      status: 'queued',
      error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: 'old 502' },
    });
    const plan = await store.get('aijob_exec_clear_stale_error');
    const fetchImpl = vi.fn().mockResolvedValue(
      proxyResponse({
        status: 'completed',
        result: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      }, true, 200)
    );

    await pollAiWorkerProxyJob(plan, 'gasync_clear_error', {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
    });

    const stored = await store.get('aijob_exec_clear_stale_error');
    expect(stored.job.status).toBe('succeeded');
    expect(stored.job.error).toBeNull();
  });

  it('recovers persisted queued jobs whose deferred handoff timer was lost', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'false';
    process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = 'test_recovery_secret';
    const store = createInMemoryAiJobStore();
    await createAuthAiGatewayJob(
      {},
      imageJobBody('aijob_exec_recover'),
      user,
      { store, evaluateCreditsGate: mockedReservedCreditsGate('aijob:aijob_exec_recover') }
    );
    await store.update('aijob_exec_recover', {
      status: 'queued',
      error: { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: 'old 502' },
      metadata: {
        gatewayExecution: {
          deferredAttempt: 1,
          lastHandoffError: 'AI Worker Proxy rejected AI job handoff: HTTP 502',
        },
      },
    });
    const storedBefore = await store.get('aijob_exec_recover');
    expect(shouldRecoverAiGatewayJob(storedBefore, { minAgeMs: 0 })).toBe(true);

    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ jobId: 'gasync_recovered_1', status: 'queued' }));

    const result = await recoverAiGatewayQueuedJobs({
      store,
      fetchImpl,
      minAgeMs: 0,
      disableBackgroundPoll: true,
    });

    expect(result).toMatchObject({ recovered: 1, candidates: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers['X-AC-Fairness-Signature']).toMatch(/^\d+\.[a-f0-9]+$/);
    expect(verifyAiGatewayHandoffToken(fetchImpl.mock.calls[0][1].headers['X-AC-AI-Gateway-Handoff'])).toMatchObject({
      ok: true,
      payload: {
        jobId: 'aijob_exec_recover',
        userId: 'user_exec_1',
        reserveKey: 'aijob:aijob_exec_recover',
      },
    });
    const recovered = await store.get('aijob_exec_recover');
    expect(recovered.job).toMatchObject({
      status: 'queued',
      error: null,
      metadata: expect.objectContaining({
        proxyJobId: 'gasync_recovered_1',
      }),
    });
  });

  it('recovers queued jobs that never received a proxy job id', async () => {
    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'false';
    process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = 'test_recovery_secret';
    const store = createInMemoryAiJobStore();
    await createAuthAiGatewayJob({}, imageJobBody('aijob_exec_recover_no_proxy'), user, { store });
    await store.update('aijob_exec_recover_no_proxy', {
      status: 'queued',
      error: null,
      metadata: {
        gatewayExecution: {
          deferredAt: '2026-07-19T10:00:00.000Z',
        },
      },
    });
    const storedBefore = await store.get('aijob_exec_recover_no_proxy');
    expect(shouldRecoverAiGatewayJob(storedBefore, { minAgeMs: 0 })).toBe(true);

    process.env.AI_GATEWAY_EXECUTION_ENABLED = 'true';
    const fetchImpl = vi.fn().mockResolvedValue(proxyResponse({ jobId: 'gasync_recovered_no_proxy', status: 'queued' }));

    const result = await recoverAiGatewayQueuedJobs({
      store,
      fetchImpl,
      minAgeMs: 0,
      disableBackgroundPoll: true,
    });

    expect(result).toMatchObject({ recovered: 1, candidates: 1 });
    const recovered = await store.get('aijob_exec_recover_no_proxy');
    expect(recovered.job).toMatchObject({
      status: 'queued',
      error: null,
      metadata: expect.objectContaining({
        proxyJobId: 'gasync_recovered_no_proxy',
      }),
    });
  });
});
