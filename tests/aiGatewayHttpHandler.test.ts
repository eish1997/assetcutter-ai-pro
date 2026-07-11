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
      { store }
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
      route: { providerId: 'vertex-gemini', adapterId: 'gemini-proxy' },
      adapterRequest: { method: 'POST', path: '/proxy/gemini/async' },
    });

    const getRes = makeRes();
    await handleAiGatewayRequest(makeReq('GET', '/ai-gateway/jobs/aijob_http_1'), getRes, { store });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().job.id).toBe('aijob_http_1');
  });

  it('rejects unsupported modalities without creating a job', async () => {
    const store = createInMemoryAiJobStore();
    const res = makeRes();
    await handleAiGatewayRequest(makeReq('POST', '/ai-gateway/jobs', { modality: 'music', input: {} }), res, { store });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'AI_GATEWAY_NO_PROVIDER_ROUTE' });
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
