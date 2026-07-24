import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { handleAiGatewayRequest } from '../server/ai-gateway/http-handler.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';

function makeReq(method, url, body = null) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

const testGatewayOptions = {
  listProviderKeys: async () => [{ provider: 'vertex-site', enabled: true, hasSecret: true }],
};

describe('AI gateway HTTP job sample', () => {
  it('creates and reads an in-memory image job plan', async () => {
    const store = createInMemoryAiJobStore();
    const createRes = makeRes();
    const handled = await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_1',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: {
          contents: [{ role: 'user', parts: [{ text: 'clean product render' }] }],
        },
      }),
      createRes,
      { store, ...testGatewayOptions }
    );

    expect(handled).toBe(true);
    expect(createRes.statusCode).toBe(202);
    expect(createRes.json()).toMatchObject({
      job: {
        id: 'aijob_http_1',
        status: 'created',
        modality: 'image',
        metadata: {
          creditsGate: {
            mode: 'plan',
            estimatedCredits: 50,
            checked: false,
          },
        },
      },
      route: { providerId: 'vertex-site', workerId: 'image-worker', adapterId: 'ai-worker-proxy' },
      adapterRequest: { method: 'POST', path: '/proxy/gemini/async' },
      workerRequest: { method: 'POST', path: '/proxy/gemini/async' },
    });

    const getRes = makeRes();
    await handleAiGatewayRequest(makeReq('GET', '/ai-gateway/jobs/aijob_http_1'), getRes, { store });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().job.id).toBe('aijob_http_1');
  });

  it('creates an async gray-route plan from HTTP using endpoint mapping priority', async () => {
    const store = createInMemoryAiJobStore();
    const res = makeRes();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_async_priority',
        modality: 'video',
        model: '302ai-video-manual',
        input: {
          prompt: 'short product video',
        },
      }),
      res,
      {
        store,
        listProviderKeys: async () => [
          { provider: '302ai', enabled: true, hasSecret: true },
          { provider: 'aihubmix', enabled: true, hasSecret: true },
        ],
        modelOpsConfig: {
          publishedCanonicalModelAllowlist: ['302ai-video-manual'],
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              priority: 80,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
            {
              routeId: '302ai-video-manual:aihubmix:video',
              enabled: true,
              priority: 10,
              requestPath: '/v1/videos',
              pollPath: '/v1/video-tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.video.url',
              upstreamOverride: 'aihubmix-kling-video',
            },
          ],
        },
      }
    );

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      job: {
        id: 'aijob_http_async_priority',
        provider: 'aihubmix',
        metadata: {
          modelRouteGuard: {
            routeId: '302ai-video-manual:aihubmix:video',
            providerId: 'aihubmix',
            upstreamModelId: 'aihubmix-kling-video',
          },
          aiGatewayFallback: {
            autoSelectedProvider: true,
          },
        },
      },
      route: {
        routeId: '302ai-video-manual:aihubmix:video',
        providerId: 'aihubmix',
        adapterId: 'openai-compatible-async',
      },
      workerRequest: {
        method: 'POST',
        path: '/v1/videos',
        body: {
          model: 'aihubmix-kling-video',
          prompt: 'short product video',
        },
      },
    });
  });

  it('returns a clear HTTP error when endpoint mapping priority is ambiguous', async () => {
    const store = createInMemoryAiJobStore();
    const res = makeRes();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_async_ambiguous',
        modality: 'video',
        model: '302ai-video-manual',
        input: {
          prompt: 'short product video',
        },
      }),
      res,
      {
        store,
        listProviderKeys: async () => [
          { provider: '302ai', enabled: true, hasSecret: true },
          { provider: 'aihubmix', enabled: true, hasSecret: true },
        ],
        modelOpsConfig: {
          publishedCanonicalModelAllowlist: ['302ai-video-manual'],
          endpointMappings: [
            {
              routeId: '302ai-video-manual:302ai:video',
              enabled: true,
              priority: 40,
              requestPath: '/v1/video/generations',
              pollPath: '/v1/tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.output.video_url',
            },
            {
              routeId: '302ai-video-manual:aihubmix:video',
              enabled: true,
              priority: 40,
              requestPath: '/v1/videos',
              pollPath: '/v1/video-tasks/{id}',
              statusPath: 'data.status',
              artifactPath: 'data.video.url',
            },
          ],
        },
      }
    );

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: 'AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS',
      details: {
        routeIds: ['302ai-video-manual:302ai:video', '302ai-video-manual:aihubmix:video'],
        priority: 40,
      },
    });
    expect(store.size()).toBe(0);
  });

  it('lists recent job summaries without exposing large inputs', async () => {
    const store = createInMemoryAiJobStore();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_old',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'old prompt' }] }] },
      }),
      makeRes(),
      { store, ...testGatewayOptions }
    );
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_new',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        metadata: {
          traceOnly: true,
          proxyPath: '/proxy/gemini/async',
          aiGatewayFallback: {
            active: true,
            policy: 'on_rate_limit',
            nextProviderId: 'tinysnow',
            nextAdapterId: 'tinysnow-openai',
            attempts: [
              {
                providerId: 'openai-official',
                adapterId: 'openai-official',
                reason: 'rate_limit',
                retryable: true,
                policyKind: 'on_rate_limit',
                policies: ['on_rate_limit'],
                policyAllowed: true,
                status: 429,
                message: 'HTTP 429',
              },
            ],
          },
        },
        input: { contents: [{ role: 'user', parts: [{ text: 'new prompt' }] }] },
      }),
      makeRes(),
      { store, ...testGatewayOptions }
    );

    const listRes = makeRes();
    await handleAiGatewayRequest(makeReq('GET', '/ai-gateway/jobs?limit=1'), listRes, { store });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toMatchObject({
      limit: 1,
      items: [
        {
          id: 'aijob_http_new',
          traceOnly: true,
          proxyPath: '/proxy/gemini/async',
          route: { providerId: 'vertex-site', workerId: 'image-worker', adapterId: 'ai-worker-proxy' },
          fallback: {
            active: true,
            policy: 'on_rate_limit',
            nextProviderId: 'tinysnow',
            attemptCount: 1,
            lastReason: 'rate_limit',
          },
        },
      ],
    });
    expect(listRes.json().items[0]).not.toHaveProperty('input');
    expect(listRes.json().items[0]).not.toHaveProperty('adapterRequest');
  });

  it('updates job lifecycle status for trace write-back', async () => {
    const store = createInMemoryAiJobStore();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        id: 'aijob_http_lifecycle',
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'lifecycle prompt' }] }] },
      }),
      makeRes(),
      { store, ...testGatewayOptions }
    );

    const patchRes = makeRes();
    await handleAiGatewayRequest(
      makeReq('PATCH', '/ai-gateway/jobs/aijob_http_lifecycle', {
        status: 'succeeded',
        metadata: { proxyJobId: 'gasync_1', proxyStatus: 'completed' },
      }),
      patchRes,
      { store }
    );

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({
      job: {
        id: 'aijob_http_lifecycle',
        status: 'succeeded',
        metadata: { proxyJobId: 'gasync_1', proxyStatus: 'completed' },
      },
    });
    expect(patchRes.json().job.finishedAt).toBeTruthy();

    const listRes = makeRes();
    await handleAiGatewayRequest(makeReq('GET', '/ai-gateway/jobs?limit=1'), listRes, { store });
    expect(listRes.json().items[0]).toMatchObject({
      id: 'aijob_http_lifecycle',
      status: 'succeeded',
      proxyJobId: 'gasync_1',
    });
  });

  it('rejects unsupported modalities without creating a job', async () => {
    const store = createInMemoryAiJobStore();
    const res = makeRes();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', { modality: 'music', model: 'music-model', input: {} }),
      res,
      { store, modelOpsConfig: { publishedCanonicalModelAllowlist: null } }
    );

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND' });
    expect(store.size()).toBe(0);
  });

  it('does not create a job when the injected credits gate rejects', async () => {
    const store = createInMemoryAiJobStore();
    const res = makeRes();
    await handleAiGatewayRequest(
      makeReq('POST', '/ai-gateway/jobs', {
        modality: 'image',
        model: 'gemini-3-pro-image-preview',
        input: { contents: [{ role: 'user', parts: [{ text: 'blocked' }] }] },
      }),
      res,
      {
        store,
        evaluateCreditsGate: async () => ({
          ok: false,
          status: 401,
          body: { error: 'LOGIN_REQUIRED' },
        }),
      }
    );

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'LOGIN_REQUIRED' });
    expect(store.size()).toBe(0);
  });
});
