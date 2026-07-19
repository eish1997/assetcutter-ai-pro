import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { assertAiWorkerProxyCreditsGate } from '../server/ai-worker-proxy-credits-gate.js';
import { AI_GATEWAY_HANDOFF_HEADER_LOWER, signAiGatewayHandoffToken } from '../server/ai-gateway/handoff-token.js';

function listen(server: http.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('server did not bind to a TCP port'));
      else resolve(address.port);
    });
  });
}

function readJson(req: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

describe('ai-worker-proxy credits gate server handoff', () => {
  const prevAuthBase = process.env.AUTH_API_BASE;
  const prevGate = process.env.AI_WORKER_PROXY_CREDITS_GATE;
  const prevHmac = process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET;
  const prevInternal = process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET;
  const prevGeminiInternal = process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET;
  const prevGlobalInternal = process.env.INTERNAL_API_SECRET;

  afterEach(() => {
    if (prevAuthBase === undefined) delete process.env.AUTH_API_BASE;
    else process.env.AUTH_API_BASE = prevAuthBase;
    if (prevGate === undefined) delete process.env.AI_WORKER_PROXY_CREDITS_GATE;
    else process.env.AI_WORKER_PROXY_CREDITS_GATE = prevGate;
    if (prevHmac === undefined) delete process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET;
    else process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = prevHmac;
    if (prevInternal === undefined) delete process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET;
    else process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET = prevInternal;
    if (prevGeminiInternal === undefined) delete process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET;
    else process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET = prevGeminiInternal;
    if (prevGlobalInternal === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = prevGlobalInternal;
  });

  it('accepts an auth-api validated AI Gateway handoff without browser cookies or shared proxy secrets', async () => {
    delete process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET;
    delete process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET;
    delete process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET;
    delete process.env.INTERNAL_API_SECRET;
    process.env.AI_WORKER_PROXY_CREDITS_GATE = 'true';

    let received: Record<string, unknown> | null = null;
    const authApi = http.createServer(async (req, res) => {
      if (req.url !== '/api/internal/ai-gateway/validate-handoff' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      received = await readJson(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, amount: 134 }));
    });
    const port = await listen(authApi);
    process.env.AUTH_API_BASE = `http://127.0.0.1:${port}`;

    try {
      const token = signAiGatewayHandoffToken({
        jobId: 'aijob_handoff_gate',
        userId: 'user_gate_1',
        reserveKey: 'aijob:aijob_handoff_gate',
        estimatedCredits: 134,
      });
      const gate = await assertAiWorkerProxyCreditsGate(
        {
          headers: {
            'x-ac-fairness-key': 'user:user_gate_1',
            'x-ac-credits-reserve': 'aijob:aijob_handoff_gate',
            [AI_GATEWAY_HANDOFF_HEADER_LOWER]: token,
          },
        } as http.IncomingMessage,
        50
      );

      expect(gate).toEqual({ ok: true });
      expect(received).toMatchObject({
        userId: 'user_gate_1',
        reserveKey: 'aijob:aijob_handoff_gate',
        estimatedCredits: 50,
      });
    } finally {
      await new Promise<void>((resolve) => authApi.close(() => resolve()));
    }
  });

  it('uses the AI Gateway handoff token as fallback when proxy HMAC signatures are mismatched', async () => {
    process.env.AI_WORKER_PROXY_CREDITS_HMAC_SECRET = 'worker-side-different-secret';
    delete process.env.AI_WORKER_PROXY_CREDITS_INTERNAL_SECRET;
    delete process.env.GEMINI_PROXY_CREDITS_INTERNAL_SECRET;
    delete process.env.INTERNAL_API_SECRET;
    process.env.AI_WORKER_PROXY_CREDITS_GATE = 'true';

    const authApi = http.createServer(async (req, res) => {
      if (req.url !== '/api/internal/ai-gateway/validate-handoff' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
      }
      await readJson(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, amount: 134 }));
    });
    const port = await listen(authApi);
    process.env.AUTH_API_BASE = `http://127.0.0.1:${port}`;

    try {
      const token = signAiGatewayHandoffToken({
        jobId: 'aijob_handoff_bad_hmac',
        userId: 'user_gate_2',
        reserveKey: 'aijob:aijob_handoff_bad_hmac',
        estimatedCredits: 134,
      });
      const gate = await assertAiWorkerProxyCreditsGate(
        {
          headers: {
            'x-ac-fairness-key': 'user:user_gate_2',
            'x-ac-credits-reserve': 'aijob:aijob_handoff_bad_hmac',
            'x-ac-credits-gate-signature': '1.bad',
            [AI_GATEWAY_HANDOFF_HEADER_LOWER]: token,
          },
        } as http.IncomingMessage,
        50
      );

      expect(gate).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve) => authApi.close(() => resolve()));
    }
  });
});
