import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memory, resetMemory } = vi.hoisted(() => {
  const memory: Record<string, string> = {};
  return {
    memory,
    resetMemory: () => {
      for (const k of Object.keys(memory)) delete memory[k];
    },
  };
});

vi.mock('../services/clientPersist', () => ({
  scopedStorageKey: (baseKey: string, preferenceScope: string | null | undefined) => {
    const s = String(preferenceScope ?? '').trim();
    return s ? `${baseKey}__u_${s}` : `${baseKey}__guest`;
  },
  readLocalJson: <T>(key: string, fallback: T, normalize?: (parsed: unknown) => T | null): T => {
    const raw = memory[key];
    if (raw == null || raw === '') return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (normalize) {
        const n = normalize(parsed);
        return n == null ? fallback : n;
      }
      return parsed as T;
    } catch {
      return fallback;
    }
  },
  writeLocalJson: (key: string, value: unknown) => {
    memory[key] = JSON.stringify(value);
  },
}));

async function loadStore() {
  return import('../services/quickComposeThreadStore');
}

describe('quickComposeThreadStore', () => {
  beforeEach(() => {
    resetMemory();
    vi.resetModules();
  });

  const workspaceKey = {
    userId: 'user-1',
    workspaceProjectId: 'proj-a',
    scope: 'workspace' as const,
  };

  it('load returns null when empty', async () => {
    const { loadQuickComposeThread } = await loadStore();
    expect(loadQuickComposeThread(workspaceKey)).toBeNull();
  });

  it('save and load roundtrip', async () => {
    const { createQuickComposeThread, saveQuickComposeThread, loadQuickComposeThread } =
      await loadStore();
    const thread = createQuickComposeThread(workspaceKey);
    thread.messages.push({
      id: 'm1',
      role: 'user',
      text: 'hello',
      timestamp: 1000,
      status: 'submitted',
    });
    saveQuickComposeThread(workspaceKey, thread);

    const loaded = loadQuickComposeThread(workspaceKey);
    expect(loaded?.id).toBe(thread.id);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0].text).toBe('hello');
  });

  it('append creates thread when missing', async () => {
    const { appendQuickComposeThreadMessage, loadQuickComposeThread } = await loadStore();
    const msg = appendQuickComposeThreadMessage(workspaceKey, {
      role: 'user',
      text: 'first',
      status: 'submitted',
    });
    expect(msg.id).toBeTruthy();
    const loaded = loadQuickComposeThread(workspaceKey);
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.messages[0].text).toBe('first');
  });

  it('trim keeps newest 50 messages', async () => {
    const { trimQuickComposeThreadMessages, QUICK_COMPOSE_THREAD_MAX_MESSAGES } =
      await loadStore();
    const messages = Array.from({ length: 55 }, (_, i) => ({
      id: `m-${i}`,
      role: 'user' as const,
      text: `msg-${i}`,
      timestamp: i,
    }));
    const trimmed = trimQuickComposeThreadMessages(messages);
    expect(trimmed).toHaveLength(QUICK_COMPOSE_THREAD_MAX_MESSAGES);
    expect(trimmed[0].text).toBe('msg-5');
    expect(trimmed[49].text).toBe('msg-54');
  });

  it('append trims persisted thread to max messages', async () => {
    const { appendQuickComposeThreadMessage, loadQuickComposeThread } = await loadStore();
    for (let i = 0; i < 52; i += 1) {
      appendQuickComposeThreadMessage(workspaceKey, {
        role: 'user',
        text: `n-${i}`,
        timestamp: i,
      });
    }
    const loaded = loadQuickComposeThread(workspaceKey);
    expect(loaded?.messages).toHaveLength(50);
    expect(loaded?.messages[0].text).toBe('n-2');
    expect(loaded?.messages[49].text).toBe('n-51');
  });

  it('workspace and lightbox use separate storage keys', async () => {
    const { appendQuickComposeThreadMessage, loadQuickComposeThread, quickComposeThreadStorageKey } =
      await loadStore();

    appendQuickComposeThreadMessage(workspaceKey, { role: 'user', text: 'ws' });
    appendQuickComposeThreadMessage(
      {
        userId: 'user-1',
        workspaceProjectId: 'proj-a',
        scope: 'lightbox',
        lightboxSessionKey: 'asset-1:original',
      },
      { role: 'user', text: 'lb' }
    );

    const wsKey = quickComposeThreadStorageKey(workspaceKey);
    const lbKey = quickComposeThreadStorageKey({
      userId: 'user-1',
      workspaceProjectId: 'proj-a',
      scope: 'lightbox',
      lightboxSessionKey: 'asset-1:original',
    });
    expect(wsKey).not.toBe(lbKey);
    expect(loadQuickComposeThread(workspaceKey)?.messages[0].text).toBe('ws');
    expect(
      loadQuickComposeThread({
        userId: 'user-1',
        workspaceProjectId: 'proj-a',
        scope: 'lightbox',
        lightboxSessionKey: 'asset-1:original',
      })?.messages[0].text
    ).toBe('lb');
  });

  it('persists assetIds and taskIds without extra fields', async () => {
    const { appendQuickComposeThreadMessage, loadQuickComposeThread } = await loadStore();
    appendQuickComposeThreadMessage(workspaceKey, {
      role: 'assistant',
      text: 'done',
      status: 'done',
      assetIds: ['a1', 'a2'],
      taskIds: ['t1'],
    });
    const loaded = loadQuickComposeThread(workspaceKey);
    expect(loaded?.messages[0].assetIds).toEqual(['a1', 'a2']);
    expect(loaded?.messages[0].taskIds).toEqual(['t1']);
    expect(loaded?.messages[0]).not.toHaveProperty('resultImageBase64');
  });
});
