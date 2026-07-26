import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentCliStore } from '../server/agent-cli-store.js';
import { handleAgentCliRoutes } from '../server/agent-cli-api.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function mockRes() {
  const state: { status?: number; body?: any; headers: Record<string, string> } = { headers: {} };
  return {
    state,
    writeHead(code: number, headers?: Record<string, string>) {
      state.status = code;
      if (headers) Object.assign(state.headers, headers);
    },
    end(body?: string) {
      state.body = body;
    },
    setHeader(k: string, v: string) {
      state.headers[k] = v;
    },
  };
}

describe('agent-cli API routes', () => {
  it('run creates platform asset and audit via PAT', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-cli-api-'));
    dirs.push(root);
    const store = createAgentCliStore({ root });
    const { token } = store.createPat({ userId: 'u9', username: 'cli', label: 'test' });

    const jsonBodies: any[] = [];
    const ctx = {
      store,
      requireAuth: async () => null,
      json: (_res: any, status: number, body: object) => {
        jsonBodies.push({ status, body });
      },
      readBody: async () => ({ prompt: 'hello agent', wait: true }),
      publicSiteUrl: 'http://localhost:3000',
      authApiPublicUrl: 'http://127.0.0.1:9100',
    };

    const req = {
      method: 'POST',
      url: '/api/agent/cli/run',
      headers: { authorization: `Bearer ${token}` },
    };
    const res = mockRes();
    const handled = await handleAgentCliRoutes(req as any, res as any, '/api/agent/cli/run', ctx as any);
    expect(handled).toBe(true);
    expect(jsonBodies[0].status).toBe(200);
    expect(jsonBodies[0].body.ok).toBe(true);
    expect(jsonBodies[0].body.asset?.source || jsonBodies[0].body.asset?.id).toBeTruthy();
    expect(jsonBodies[0].body.asset.id.startsWith('aga_')).toBe(true);

    const assets = store.listPlatformAssets({ userId: 'u9' });
    expect(assets.length).toBeGreaterThan(0);
    const audit = store.listAudit({ userId: 'u9' });
    expect(audit.some((e) => e.action === 'run.complete' && e.ok)).toBe(true);
  });
});
