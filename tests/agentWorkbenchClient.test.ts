import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createAgentWorkbenchClient } = require('../companion-desktop/agent-workbench-client.cjs');

function createClient(overrides: Record<string, unknown> = {}) {
  return createAgentWorkbenchClient({
    getSiteUrl: () => 'https://assetcutter.test/app',
    normalizeSiteUrl: (raw: string) => raw,
    fetchWithPartition: async (_partition: string, url: string, init?: { body?: string }) => {
      if (url.endsWith('/agent/workbench/context')) {
        return { ok: true, status: 200, json: { authenticated: true, user: { id: 'u1' } }, text: '' };
      }
      if (url.endsWith('/agent/workbench/open-project')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        return { ok: true, status: 200, json: { ok: true, projectId: body.projectId }, text: '' };
      }
      if (url.endsWith('/agent/workbench/create-project')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        return { ok: true, status: 200, json: { ok: true, name: body.name || null }, text: '' };
      }
      if (url.endsWith('/agent/workbench/list-assets')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        return { ok: true, status: 200, json: { ok: true, projectId: body.projectId || null, limit: body.limit || null }, text: '' };
      }
      if (url.endsWith('/agent/workbench/get-asset')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        return { ok: true, status: 200, json: { ok: true, projectId: body.projectId || null, assetId: body.assetId }, text: '' };
      }
      if (url.endsWith('/agent/workbench/run-capability')) {
        const body = init?.body ? JSON.parse(init.body) : {};
        return {
          ok: true,
          status: 200,
          json: {
            ok: true,
            presetId: body.presetId,
            projectId: body.projectId || null,
            imageDataUrlPresent: Boolean(body.imageDataUrl),
            inputAssetId: body.inputAssetId || null,
            inputAssetDisplayKey: body.inputAssetDisplayKey || null,
          },
          text: '',
        };
      }
      return { ok: false, status: 404, json: null, text: 'not found' };
    },
    invokeBridge: async (method: string, args: Record<string, unknown>) => {
      if (method === 'getContext') {
        return {
          ok: true,
          authenticated: true,
          activeProjectId: 'p1',
          capabilityPresets: [
            { id: 'text-preset', directRunSupported: true },
            { id: 'manual-preset', directRunSupported: false },
          ],
        };
      }
      if (method === 'createProject') return { ok: true, projectId: 'p-new', projectName: args.name || 'Agent 项目' };
      if (method === 'openProject') return { ok: true, projectId: args.projectId };
      if (method === 'listAssets') return { ok: true, projectId: args.projectId || 'p1', count: 1, assets: [{ id: 'a1', kind: 'text' }] };
      if (method === 'getAsset') return { ok: true, projectId: args.projectId || 'p1', asset: { id: args.assetId, textResults: [{ key: 'k', text: 'hello' }] } };
      if (method === 'runCapability') return { ok: true, kind: 'text', durationMs: 18 };
      return { ok: false, error: 'unknown_method' };
    },
    navigateShell: async () => ({ ok: true }),
    ...overrides,
  });
}

describe('agent workbench client', () => {
  it('uses configured Agent API origin when the visible workbench origin is unavailable', async () => {
    const requestedUrls: string[] = [];
    const client = createClient({
      getSiteUrl: () => '',
      getAgentApiOrigin: () => 'https://auth.assetcutter.test',
      fetchWithPartition: async (_partition: string, url: string) => {
        requestedUrls.push(url);
        return { ok: true, status: 200, json: { authenticated: true }, text: '' };
      },
    });

    const result = await client.getContext();
    expect(result.ok).toBe(true);
    expect(requestedUrls[0]).toBe('https://auth.assetcutter.test/api/agent/workbench/context');
    expect(result.structured.activeProjectId).toBe('p1');
    expect(result.structured.capabilityPresets[0].id).toBe('text-preset');
  });

  it('falls back to Agent API origin when the workbench site does not host agent routes', async () => {
    const requestedUrls: string[] = [];
    const client = createClient({
      getAgentApiOrigin: () => 'https://auth.assetcutter.test',
      fetchWithPartition: async (_partition: string, url: string) => {
        requestedUrls.push(url);
        if (url.startsWith('https://assetcutter.test/')) {
          return { ok: false, status: 404, json: null, text: 'not found' };
        }
        return { ok: true, status: 200, json: { authenticated: true }, text: '' };
      },
    });

    const result = await client.getContext();
    expect(result.ok).toBe(true);
    expect(requestedUrls).toEqual([
      'https://assetcutter.test/api/agent/workbench/context',
      'https://auth.assetcutter.test/api/agent/workbench/context',
    ]);
    expect(result.structured.serverRequest.source).toBe('agent-api');
  });

  it('adds a workbench Origin header for server-side write requests', async () => {
    let observedOrigin = '';
    const client = createClient({
      fetchWithPartition: async (_partition: string, url: string, init?: { headers?: Record<string, string>; body?: string }) => {
        if (url.endsWith('/agent/workbench/context')) {
          return { ok: true, status: 200, json: { authenticated: true }, text: '' };
        }
        observedOrigin = String(init?.headers?.Origin || init?.headers?.origin || '');
        return { ok: true, status: 200, json: { ok: true, name: 'Project' }, text: '' };
      },
    });

    const result = await client.createProject({ name: 'Project' });
    expect(result.ok).toBe(true);
    expect(observedOrigin).toBe('https://assetcutter.test');
  });

  it('returns structured runCapability result for agent planning', async () => {
    const client = createClient();
    const result = await client.runCapability({
      presetId: 'line-art',
      projectId: 'p1',
      inputText: 'hello',
      imageDataUrl: 'data:image/png;base64,abc',
      inputAssetId: 'asset-1',
      inputAssetDisplayKey: 'original',
    });

    expect(result.ok).toBe(true);
    expect(result.structured.action).toBe('runCapability');
    expect(result.structured.presetId).toBe('line-art');
    expect(result.structured.projectId).toBe('p1');
    expect(result.structured.server.imageDataUrlPresent).toBe(true);
    expect(result.structured.server.inputAssetId).toBe('asset-1');
    expect(result.structured.imageDataUrl).toBe('[data-url]');
    expect(result.structured.inputAssetId).toBe('asset-1');
    expect(result.structured.inputAssetDisplayKey).toBe('original');
    expect(result.structured.nextStep).toBe('done');
    expect(result.structured.bridge.durationMs).toBe(18);
  });

  it('ensures workbench readiness before agents operate it', async () => {
    const navigated: string[] = [];
    const client = createClient({
      navigateShell: async (view: string) => {
        navigated.push(view);
        return { ok: true };
      },
    });

    const result = await client.ensureReady({ requireProject: true });
    expect(result.ok).toBe(true);
    expect(result.structured.action).toBe('ensureReady');
    expect(result.structured.ready).toBe(true);
    expect(result.structured.activeProjectId).toBe('p1');
    expect(result.structured.directRunPresetCount).toBe(1);
    expect(navigated).toContain('workbench');
  });

  it('can create a project during readiness when explicitly requested', async () => {
    const client = createClient({
      invokeBridge: async (method: string, args: Record<string, unknown>) => {
        if (method === 'getContext') return { ok: true, authenticated: true, activeProjectId: null, capabilityPresets: [] };
        if (method === 'createProject') return { ok: true, projectId: 'p-new', project: { id: 'p-new', name: args.name } };
        return { ok: false, error: 'unknown_method' };
      },
    });

    const result = await client.ensureReady({
      requireProject: true,
      createIfMissing: true,
      projectName: 'Smoke Project',
    });
    expect(result.ok).toBe(true);
    expect(result.structured.activeProjectId).toBe('p-new');
    expect(result.structured.createdProject.id).toBe('p-new');
  });

  it('keeps server context and gives next step when bridge is unavailable', async () => {
    const client = createClient({
      invokeBridge: async () => {
        throw new Error('bridge_unavailable');
      },
    });

    const result = await client.openProject('p2');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_WORKBENCH_BRIDGE');
    expect(result.structured.action).toBe('openProject');
    expect(result.structured.server.projectId).toBe('p2');
    expect(result.structured.nextStep).toContain('BrowserView');
  });

  it('creates a project through server auth check and workbench bridge', async () => {
    const client = createClient();
    const result = await client.createProject({ name: 'Agent 新项目' });
    expect(result.ok).toBe(true);
    expect(result.structured.action).toBe('createProject');
    expect(result.structured.name).toBe('Agent 新项目');
    expect(result.structured.projectId).toBe('p-new');
    expect(result.structured.bridge.projectId).toBe('p-new');
    expect(result.structured.nextStep).toBe('done');
  });

  it('lists lightweight workbench assets through server auth check and bridge', async () => {
    const client = createClient();
    const result = await client.listAssets({ projectId: 'p1', limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.structured.action).toBe('listAssets');
    expect(result.structured.server.limit).toBe(10);
    expect(result.structured.assets[0].id).toBe('a1');
    expect(result.structured.bridge.assets[0].id).toBe('a1');
  });

  it('gets a single workbench asset through server auth check and bridge', async () => {
    const client = createClient();
    const result = await client.getAsset({ projectId: 'p1', assetId: 'a1' });
    expect(result.ok).toBe(true);
    expect(result.structured.action).toBe('getAsset');
    expect(result.structured.server.assetId).toBe('a1');
    expect(result.structured.asset.id).toBe('a1');
    expect(result.structured.bridge.asset.textResults[0].text).toBe('hello');
  });

  it('maps bridge input requirements to a standard input-required error', async () => {
    const client = createClient({
      invokeBridge: async () => ({
        ok: false,
        error: 'input_image_required',
        requiresInput: true,
        requiredInput: 'imageDataUrl',
        nextStep: '请补充 imageDataUrl',
      }),
    });

    const result = await client.runCapability({ presetId: 'image-preset' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_INPUT_REQUIRED');
    expect(result.structured.bridge.requiresInput).toBe(true);
    expect(result.structured.bridge.requiredInput).toBe('imageDataUrl');
    expect(result.structured.nextStep).toContain('imageDataUrl');
  });

  it('maps missing active project to a stable project-required error', async () => {
    const client = createClient({
      invokeBridge: async () => ({
        ok: false,
        error: 'project_required',
        nextStep: '请先创建项目',
      }),
    });

    const result = await client.runCapability({ presetId: 'text-preset' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_PROJECT_REQUIRED');
    expect(result.structured.bridge.error).toBe('project_required');
    expect(result.structured.nextStep).toContain('创建项目');
  });

  it('returns structured getContext diagnostics when workbench HTTP fails', async () => {
    const client = createClient({
      fetchWithPartition: async () => ({
        ok: false,
        status: 503,
        json: { error: 'service_unavailable' },
        text: 'service unavailable',
      }),
    });

    const result = await client.getContext();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_WORKBENCH_HTTP');
    expect(result.structured.action).toBe('getContext');
    expect(result.structured.retryable).toBe(true);
    expect(result.structured.server.status).toBe(503);
    expect(result.structured.nextStep).toContain('主站服务');
    expect(result.content).toContain('service unavailable');
  });

  it('keeps request origin diagnostics when workbench fetch throws', async () => {
    const client = createClient({
      fetchWithPartition: async () => {
        throw new Error('connection refused');
      },
    });

    const result = await client.getContext();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_WORKBENCH_HTTP');
    expect(result.structured.server.requestOrigin).toBe('https://assetcutter.test');
    expect(result.structured.server.error).toBe('connection refused');
  });

  it('includes embedded session diagnostics when workbench auth is missing', async () => {
    const client = createClient({
      getAgentApiOrigin: () => 'https://auth.assetcutter.test',
      fetchWithPartition: async () => ({
        ok: false,
        status: 401,
        json: { code: 'AGENT_AUTH_REQUIRED' },
        text: '{"code":"AGENT_AUTH_REQUIRED"}',
        authRequired: true,
      }),
      inspectPartitionSession: async (partition: string, url: string) => ({
        partition,
        origin: url,
        cookieCount: 0,
        cookieNames: [],
        hasLikelyAuthCookie: false,
      }),
    });

    const result = await client.getContext();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('AGENT_AUTH_REQUIRED');
    expect(result.structured.authRequired).toBe(true);
    expect(result.structured.authDiagnostics).toMatchObject({
      partition: 'persist:assetcutter-team',
      apiOrigin: 'https://auth.assetcutter.test',
      siteOrigin: 'https://assetcutter.test',
      sameOrigin: false,
    });
    expect(result.structured.authDiagnostics.session.cookieCount).toBe(0);
    expect(result.structured.authDiagnostics.nextStep).toContain('embedded Workbench');
  });
});
