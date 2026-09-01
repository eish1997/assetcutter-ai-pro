import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createConnectionPackageBridge, guessHostId, inferKnownHostHint } = require('../companion-desktop/connectionPackageBridge.cjs') as {
  createConnectionPackageBridge: (deps: {
    companionApiRequest: (method: string, path: string, body: unknown, opts?: { timeoutMs?: number }) => Promise<{
      ok: boolean;
      json?: unknown;
      text?: string;
    }>;
  }) => {
    listDrafts: () => Promise<{ ok: boolean; drafts?: unknown[] }>;
    createDraft: (input: { name: string }) => Promise<{ ok: boolean; already?: boolean; draft?: { id: string }; error?: string }>;
    probeDraft: (id: string) => Promise<{ ok: boolean; draftId?: string; error?: string }>;
    discoverRunning: () => Promise<{ ok: boolean; discovered?: number; failed?: number }>;
  };
  guessHostId: (name: string) => string;
  inferKnownHostHint: (input: { hostId?: string; name?: string; replayId?: string; title?: string }) => {
    hostId: string;
    name: string;
  } | null;
};

describe('connectionPackageBridge', () => {
  it('infers known host hints from replay ids and skips unknown tools', () => {
    expect(inferKnownHostHint({ replayId: 'workflow.maya.export_selection_fbx' })).toEqual({
      hostId: 'maya',
      name: 'Maya',
    });
    expect(inferKnownHostHint({ name: 'Blender 4' })).toEqual({ hostId: 'blender', name: 'Blender' });
    expect(inferKnownHostHint({ replayId: 'random-tool' })).toBeNull();
  });

  it('lists only software_connection drafts', async () => {
    const request = vi.fn(async () => ({
      ok: true,
      json: {
        drafts: [
          { id: 'maya', type: 'software_connection', name: 'Maya', connectionState: { maturity: 'connected' } },
          { id: 'tool-1', type: 'tool', name: 'Ignored' },
        ],
      },
    }));
    const bridge = createConnectionPackageBridge({ companionApiRequest: request });
    const out = await bridge.listDrafts();
    expect(out.ok).toBe(true);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts?.[0]).toMatchObject({ id: 'maya', maturity: 'connected' });
  });

  it('proxies probe to capability-packages endpoint', async () => {
    const request = vi.fn(async (_method, path) => ({
      ok: true,
      json: { ok: true, message: 'probed' },
      path,
    }));
    const bridge = createConnectionPackageBridge({ companionApiRequest: request });
    const out = await bridge.probeDraft('maya');
    expect(out.ok).toBe(true);
    expect(request).toHaveBeenCalledWith('POST', '/v1/capability-packages/maya/probe', null, expect.any(Object));
  });

  it('creates a Maya place as a known-host software_connection and skips duplicates', async () => {
    expect(guessHostId('Maya 2024')).toBe('maya');
    const request = vi.fn(async (method, path) => {
      if (method === 'GET' && path === '/v1/capability-packages/drafts') {
        return { ok: true, json: { drafts: [] } };
      }
      return {
        ok: true,
        json: { ok: true, draft: { id: 'maya', type: 'software_connection', name: 'Maya' } },
      };
    });
    const bridge = createConnectionPackageBridge({ companionApiRequest: request });
    const created = await bridge.createDraft({ name: 'Maya' });
    expect(created.ok).toBe(true);
    expect(created.already).toBe(false);
    expect(request).toHaveBeenCalledWith(
      'POST',
      '/v1/capability-packages/drafts',
      expect.objectContaining({
        type: 'software_connection',
        name: 'Maya',
        templateHint: 'conversation_known_host',
        manifest: { hostId: 'maya' },
      }),
      expect.any(Object),
    );

    const again = createConnectionPackageBridge({
      companionApiRequest: async () => ({
        ok: true,
        json: { drafts: [{ id: 'maya', type: 'software_connection', name: 'Maya' }] },
      }),
    });
    const dup = await again.createDraft({ name: 'Maya' });
    expect(dup.ok).toBe(true);
    expect(dup.already).toBe(true);
    expect(dup.draft?.id).toBe('maya');
  });
});
