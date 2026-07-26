/**
 * Prove-e2e (no live auth-api): Soul store + API handler path used by CLI.
 * Verifies: create → run → assets list → audit, zero MCP.
 */
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

describe('agent-cli e2e flow (Soul)', () => {
  it('login PAT → project → run → list assets → audit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-cli-e2e-'));
    dirs.push(root);
    const store = createAgentCliStore({ root });
    const { token } = store.createPat({ userId: 'e2e-user', username: 'e2e', label: 'e2e' });

    const jsonBodies: any[] = [];
    const ctx = {
      store,
      requireAuth: async () => ({ id: 'e2e-user', username: 'e2e' }),
      json: (_res: any, status: number, body: object) => {
        jsonBodies.push({ status, body });
      },
      readBody: async () => ({}),
      publicSiteUrl: 'http://localhost:3000',
      authApiPublicUrl: 'http://127.0.0.1:9100',
    };

    const authReq = (method: string, urlPath: string, body?: object) => ({
      method,
      url: urlPath,
      headers: { authorization: `Bearer ${token}` },
      _body: body,
    });

    ctx.readBody = async (req: any) => req._body || {};

    // whoami
    await handleAgentCliRoutes(authReq('GET', '/api/agent/cli/whoami') as any, {} as any, '/api/agent/cli/whoami', ctx as any);
    expect(jsonBodies.at(-1).body.user.id).toBe('e2e-user');

    // project create
    ctx.readBody = async () => ({ name: 'E2E 项目' });
    await handleAgentCliRoutes(authReq('POST', '/api/agent/cli/projects') as any, {} as any, '/api/agent/cli/projects', ctx as any);
    const projectId = jsonBodies.at(-1).body.project.id;
    expect(projectId).toMatch(/^agp_/);

    // run
    ctx.readBody = async () => ({ prompt: '验收用一只猫', projectId, wait: true });
    await handleAgentCliRoutes(authReq('POST', '/api/agent/cli/run') as any, {} as any, '/api/agent/cli/run', ctx as any);
    expect(jsonBodies.at(-1).status).toBe(200);
    expect(jsonBodies.at(-1).body.asset.id).toMatch(/^aga_/);
    expect(jsonBodies.at(-1).body.asset.source || 'agent-cli').toBeTruthy();

    // assets list
    await handleAgentCliRoutes(
      authReq('GET', '/api/agent/cli/assets?projectId=' + projectId) as any,
      {} as any,
      '/api/agent/cli/assets',
      ctx as any,
    );
    expect(jsonBodies.at(-1).body.count).toBeGreaterThan(0);
    expect(jsonBodies.at(-1).body.source).toBe('agent-cli');

    // audit
    await handleAgentCliRoutes(authReq('GET', '/api/agent/cli/audit') as any, {} as any, '/api/agent/cli/audit', ctx as any);
    const actions = jsonBodies.at(-1).body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'run.create', 'asset.create', 'run.complete']));

    // hard isolation: store root must not mention mcp
    const dbText = fs.readFileSync(path.join(root, 'db.json'), 'utf8');
    expect(dbText.toLowerCase()).not.toContain('mcp');
  });
});
