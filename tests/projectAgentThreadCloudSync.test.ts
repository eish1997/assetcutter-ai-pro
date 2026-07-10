import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAgentThread } from '../services/projectAgent/threadStore';
import { workspaceRootPrefix } from '../services/workspaceCloudSync';
import {
  PROJECT_AGENT_COMPACTION_KEEP_RECENT,
  maybeCompactProjectAgentThread,
  saveProjectAgentCompaction,
  loadProjectAgentCompaction,
} from '../services/projectAgent/compaction';
import { assembleProjectAgentContext } from '../services/projectAgent/contextAssembly';
import type { ProjectAgentIntent } from '../types/projectAgent';
import { writeLocalJson } from '../services/clientPersist';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}
const isWorkspaceCloudEnabledMock = vi.fn(() => true);

vi.mock('../services/workspaceCloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/workspaceCloudSync')>();
  return {
    ...actual,
    isWorkspaceCloudEnabled: () => isWorkspaceCloudEnabledMock(),
  };
});

const requestJsonMock = vi.fn();

vi.mock('../services/httpClient', () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
}));

import {
  __resetProjectAgentThreadCloudSyncForTests,
  cancelPendingProjectAgentHotBackup,
  flushProjectAgentBackupRetryQueue,
  hydrateProjectAgentThreadFromCloud,
  mergeProjectAgentThreadLww,
  pullProjectAgentThreadHot,
  scheduleProjectAgentThreadArchiveBackup,
  scheduleProjectAgentThreadBackup,
  type ProjectAgentCloudSyncKey,
} from '../services/projectAgent/threadCloudSync';

function makeThread(overrides?: Partial<ProjectAgentThread>): ProjectAgentThread {
  return {
    id: 'thread-1',
    workspaceProjectId: 'proj-1',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'hello',
        timestamp: 1,
      },
    ],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function makeKey(overrides?: Partial<ProjectAgentCloudSyncKey>): ProjectAgentCloudSyncKey {
  return {
    userId: 'user-1',
    workspaceProjectId: 'proj-1',
    ...overrides,
  };
}

function makeIntent(overrides?: Partial<ProjectAgentIntent>): ProjectAgentIntent {
  return {
    text: 'hi',
    mode: 'text',
    presetIds: [],
    mentions: [],
    surface: { kind: 'none' },
    ...overrides,
  };
}

function installSuccessfulPutMocks() {
  requestJsonMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/upload-url')) {
      return { uploadUrl: 'https://r2.example/put', objectKey: 'k' };
    }
    if (u.includes('/register-upload')) {
      return { ok: true };
    }
    throw new Error(`unexpected requestJson url: ${u}`);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200 }))
  );
}

function installFailingPutMocks() {
  requestJsonMock.mockImplementation(async () => {
    throw new Error('network down');
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 500 }))
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  isWorkspaceCloudEnabledMock.mockReturnValue(true);
  requestJsonMock.mockReset();
  __resetProjectAgentThreadCloudSyncForTests();
  installSuccessfulPutMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  __resetProjectAgentThreadCloudSyncForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('projectAgent threadCloudSync (3B / P24)', () => {
  it('no-ops when userId is null / empty / guest', async () => {
    for (const userId of [null, '', '  ', 'guest', 'GUEST'] as const) {
      __resetProjectAgentThreadCloudSyncForTests();
      requestJsonMock.mockClear();
      scheduleProjectAgentThreadBackup(makeKey({ userId }), makeThread());
      await vi.advanceTimersByTimeAsync(2000);
      expect(requestJsonMock).not.toHaveBeenCalled();
    }
  });

  it('no-ops when workspace cloud is disabled', async () => {
    isWorkspaceCloudEnabledMock.mockReturnValue(false);
    scheduleProjectAgentThreadBackup(makeKey(), makeThread());
    await vi.advanceTimersByTimeAsync(2000);
    expect(requestJsonMock).not.toHaveBeenCalled();
  });

  it('debounces hot backup and keeps latest thread for same key', async () => {
    const key = makeKey();
    scheduleProjectAgentThreadBackup(key, makeThread({ updatedAt: 1, messages: [] }));
    scheduleProjectAgentThreadBackup(
      key,
      makeThread({
        updatedAt: 99,
        messages: [{ id: 'm2', role: 'assistant', text: 'latest', timestamp: 2 }],
      })
    );

    expect(requestJsonMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);

    await vi.waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalled();
    });

    const uploadCalls = requestJsonMock.mock.calls.filter((c) =>
      String(c[0]).includes('/upload-url')
    );
    expect(uploadCalls).toHaveLength(1);

    const body = JSON.parse(String((uploadCalls[0]?.[1] as { body?: string })?.body || '{}')) as {
      objectKey?: string;
    };
    const expectedKey = `${workspaceRootPrefix('user-1')}/projects/proj-1/agent/thread-hot.json`;
    expect(body.objectKey).toBe(expectedKey);

    const putFetch = vi.mocked(fetch);
    expect(putFetch).toHaveBeenCalled();
    const putInit = putFetch.mock.calls[0]?.[1] as { body?: string };
    const uploaded = JSON.parse(String(putInit?.body || '{}')) as ProjectAgentThread;
    expect(uploaded.updatedAt).toBe(99);
    expect(uploaded.messages).toHaveLength(1);
    expect(uploaded.messages[0]?.id).toBe('m2');
  });

  it('backup_fail_does_not_block_send — schedule never throws; flush can retry', async () => {
    installFailingPutMocks();
    const key = makeKey();
    const thread = makeThread();

    expect(() => scheduleProjectAgentThreadBackup(key, thread)).not.toThrow();
    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve();
    await Promise.resolve();

    expect(requestJsonMock).toHaveBeenCalled();

    // Cloud recovers — flush drains retry queue
    // Production: App.tsx wires flush on window `online` + document visibility visible
    installSuccessfulPutMocks();
    await expect(flushProjectAgentBackupRetryQueue()).resolves.toBeUndefined();

    const uploadCalls = requestJsonMock.mock.calls.filter((c) =>
      String(c[0]).includes('/upload-url')
    );
    expect(uploadCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('archive backup writes thread-archive/{threadId}.json', async () => {
    const archived = makeThread({ id: 'archived-99' });
    scheduleProjectAgentThreadArchiveBackup(makeKey(), archived);

    await vi.waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalled();
    });

    const uploadCalls = requestJsonMock.mock.calls.filter((c) =>
      String(c[0]).includes('/upload-url')
    );
    expect(uploadCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(String((uploadCalls[0]?.[1] as { body?: string })?.body || '{}')) as {
      objectKey?: string;
    };
    expect(body.objectKey).toBe(
      `${workspaceRootPrefix('user-1')}/projects/proj-1/agent/thread-archive/archived-99.json`
    );
  });

  it('flush never throws when put keeps failing', async () => {
    installFailingPutMocks();
    scheduleProjectAgentThreadArchiveBackup(makeKey(), makeThread({ id: 'a1' }));
    await Promise.resolve();
    await Promise.resolve();

    await expect(flushProjectAgentBackupRetryQueue()).resolves.toBeUndefined();
    await expect(flushProjectAgentBackupRetryQueue()).resolves.toBeUndefined();
  });

  it('cancelPendingProjectAgentHotBackup drops stale debounced hot backup', async () => {
    const key = makeKey();
    scheduleProjectAgentThreadBackup(
      key,
      makeThread({
        updatedAt: 1,
        messages: [{ id: 'old', role: 'user', text: 'stale', timestamp: 1 }],
      })
    );
    cancelPendingProjectAgentHotBackup(key);

    await vi.advanceTimersByTimeAsync(2000);
    expect(requestJsonMock).not.toHaveBeenCalled();
  });

  it('cancelPending then schedule empty hot — only empty thread is uploaded', async () => {
    const key = makeKey();
    scheduleProjectAgentThreadBackup(
      key,
      makeThread({
        id: 'old-hot',
        updatedAt: 1,
        messages: [{ id: 'm-old', role: 'user', text: 'before clear', timestamp: 1 }],
      })
    );
    cancelPendingProjectAgentHotBackup(key);
    const emptyHot = makeThread({
      id: 'new-hot',
      updatedAt: 99,
      messages: [],
    });
    scheduleProjectAgentThreadBackup(key, emptyHot);

    await vi.advanceTimersByTimeAsync(800);
    await vi.waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalled();
    });

    const putFetch = vi.mocked(fetch);
    expect(putFetch).toHaveBeenCalled();
    const putInit = putFetch.mock.calls[0]?.[1] as { body?: string };
    const uploaded = JSON.parse(String(putInit?.body || '{}')) as ProjectAgentThread;
    expect(uploaded.id).toBe('new-hot');
    expect(uploaded.messages).toHaveLength(0);
    expect(uploaded.updatedAt).toBe(99);
  });
});

describe('projectAgent threadCloudSync 4F pull/LWW/hydrate', () => {
  it('mergeProjectAgentThreadLww prefers newer updatedAt; tie prefers remote', () => {
    const olderLocal = makeThread({ id: 'local-old', updatedAt: 10 });
    const newerRemote = makeThread({ id: 'remote-new', updatedAt: 20 });
    expect(mergeProjectAgentThreadLww(olderLocal, newerRemote)?.id).toBe('remote-new');

    const newerLocal = makeThread({ id: 'local-new', updatedAt: 30 });
    const olderRemote = makeThread({ id: 'remote-old', updatedAt: 10 });
    expect(mergeProjectAgentThreadLww(newerLocal, olderRemote)?.id).toBe('local-new');

    const tieLocal = makeThread({
      id: 'L',
      updatedAt: 50,
      messages: [{ id: 'a', role: 'user', text: 'L', timestamp: 1 }],
    });
    const tieRemote = makeThread({
      id: 'R',
      updatedAt: 50,
      messages: [{ id: 'b', role: 'user', text: 'R', timestamp: 1 }],
    });
    expect(mergeProjectAgentThreadLww(tieLocal, tieRemote)?.id).toBe('R');
    expect(mergeProjectAgentThreadLww(null, newerRemote)?.id).toBe('remote-new');
    expect(mergeProjectAgentThreadLww(olderLocal, null)?.id).toBe('local-old');
    expect(mergeProjectAgentThreadLww(null, null)).toBeNull();
  });

  it('pull returns null for guest / cloud off', async () => {
    await expect(pullProjectAgentThreadHot(makeKey({ userId: 'guest' }))).resolves.toBeNull();
    isWorkspaceCloudEnabledMock.mockReturnValue(false);
    await expect(pullProjectAgentThreadHot(makeKey())).resolves.toBeNull();
    expect(requestJsonMock).not.toHaveBeenCalled();
  });

  it('pull downloads thread-hot.json and parses lean payload', async () => {
    const remote = makeThread({ id: 'cloud-hot', updatedAt: 999 });
    requestJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/download-url')) {
        return { downloadUrl: 'https://r2.example/get', objectKey: 'k' };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(remote),
      }))
    );

    const pulled = await pullProjectAgentThreadHot(makeKey());
    expect(pulled?.id).toBe('cloud-hot');
    expect(pulled?.updatedAt).toBe(999);

    const dlBody = JSON.parse(
      String((requestJsonMock.mock.calls[0]?.[1] as { body?: string })?.body || '{}')
    ) as { objectKey?: string };
    expect(dlBody.objectKey).toBe(
      `${workspaceRootPrefix('user-1')}/projects/proj-1/agent/thread-hot.json`
    );
  });

  it('hydrate falls back to local on pull failure and never throws', async () => {
    requestJsonMock.mockImplementation(async () => {
      throw new Error('network down');
    });
    const local = makeThread({ id: 'local-only' });
    await expect(hydrateProjectAgentThreadFromCloud(makeKey(), local)).resolves.toEqual(local);
    await expect(hydrateProjectAgentThreadFromCloud(makeKey({ userId: null }), local)).resolves.toEqual(
      local
    );
  });

  it('hydrate getFreshLocal wins LWW when fresher than open-project snapshot', async () => {
    const snapshot = makeThread({
      id: 'snap-at-open',
      updatedAt: 100,
      messages: [{ id: 'm0', role: 'user', text: 'old', timestamp: 1 }],
    });
    const fresh = makeThread({
      id: 'fresh-after-send',
      updatedAt: 500,
      messages: [{ id: 'm-new', role: 'user', text: 'sent during hydrate', timestamp: 2 }],
    });
    // Remote newer than snapshot but older than fresh — without getFreshLocal would clobber.
    const remote = makeThread({
      id: 'cloud-mid',
      updatedAt: 200,
      messages: [{ id: 'm-cloud', role: 'assistant', text: 'stale cloud', timestamp: 1 }],
    });

    requestJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/download-url')) {
        return { downloadUrl: 'https://r2.example/get', objectKey: 'k' };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(remote),
      }))
    );

    const withoutFresh = await hydrateProjectAgentThreadFromCloud(makeKey(), snapshot);
    expect(withoutFresh?.id).toBe('cloud-mid');

    const withFresh = await hydrateProjectAgentThreadFromCloud(makeKey(), snapshot, {
      getFreshLocal: () => fresh,
    });
    expect(withFresh?.id).toBe('fresh-after-send');
    expect(withFresh?.updatedAt).toBe(500);
    expect(withFresh?.messages[0]?.id).toBe('m-new');
  });

  it('hot backup serialize strips data URLs and long base64 from uploaded body', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(80)}`;
    const longB64 = `${'B'.repeat(300)}=`;
    const key = makeKey();
    scheduleProjectAgentThreadBackup(
      key,
      makeThread({
        updatedAt: 42,
        messages: [
          {
            id: 'm-img',
            role: 'user',
            text: `see ${dataUrl}`,
            timestamp: 1,
          },
          {
            id: 'm-b64',
            role: 'assistant',
            text: longB64,
            timestamp: 2,
          },
        ],
      })
    );

    await vi.advanceTimersByTimeAsync(800);
    await vi.waitFor(() => {
      expect(requestJsonMock).toHaveBeenCalled();
    });

    const putFetch = vi.mocked(fetch);
    expect(putFetch).toHaveBeenCalled();
    const putInit = putFetch.mock.calls[0]?.[1] as { body?: string };
    const uploadedRaw = String(putInit?.body || '');
    expect(uploadedRaw).not.toContain('data:image');
    expect(uploadedRaw).not.toMatch(/AAAA{20,}/);
    expect(uploadedRaw).not.toMatch(/BBBB{20,}/);
    const uploaded = JSON.parse(uploadedRaw) as ProjectAgentThread;
    expect(uploaded.messages[0]?.text).toContain('[omitted-data-url]');
    expect(uploaded.messages[1]?.text).toBe('[omitted-base64]');
  });
});

describe('projectAgent compaction + assembly (4F)', () => {
  const storeKey = { userId: 'user-1', workspaceProjectId: 'proj-1' };

  afterEach(() => {
    try {
      writeLocalJson('ac_project_agent_compaction_v1__u_user-1__p_proj-1', null);
    } catch {
      /* ignore */
    }
  });

  it('maybeCompact truncates older messages into summary + coveredMessageIds', () => {
    const messages = Array.from({ length: PROJECT_AGENT_COMPACTION_KEEP_RECENT + 4 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `msg-${i}`,
      timestamp: i + 1,
    }));
    const thread = makeThread({ messages, updatedAt: 1 });
    const compaction = maybeCompactProjectAgentThread(storeKey, thread);
    expect(compaction).not.toBeNull();
    expect(compaction!.coveredMessageIds).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(compaction!.summaryText).toContain('msg-0');
    expect(compaction!.summaryText).not.toContain(`msg-${PROJECT_AGENT_COMPACTION_KEEP_RECENT}`);
    const loaded = loadProjectAgentCompaction(storeKey);
    expect(loaded?.coveredMessageIds).toEqual(compaction!.coveredMessageIds);
  });

  it('assemble includes summary, strips base64, marks truncated', () => {
    saveProjectAgentCompaction(storeKey, {
      workspaceProjectId: 'proj-1',
      summaryText: 'Earlier: hello world',
      coveredMessageIds: ['old1'],
      updatedAt: 1,
    });
    const b64 = `data:image/png;base64,${'A'.repeat(120)}`;
    const thread = makeThread({
      messages: [
        { id: 'u1', role: 'user', text: `see ${b64}`, timestamp: 1 },
        { id: 'a1', role: 'assistant', text: 'plan', resultText: 'ok result', timestamp: 2 },
      ],
    });
    const assembled = assembleProjectAgentContext({
      key: storeKey,
      thread,
      intent: makeIntent(),
      expertContext: `expert notes ${b64}`,
    });
    expect(assembled.compactionSummary).toContain('Earlier');
    expect(assembled.recentText).toContain('ok result');
    expect(assembled.recentText).not.toMatch(/base64,[A-Za-z0-9+/]{20,}/i);
    expect(assembled.recentText).toContain('[omitted-base64]');
    expect(assembled.expertContext).toContain('[omitted-base64]');
    expect(assembled.expertContext).not.toMatch(/AAAA{10,}/);
    expect(assembled.truncated).toBe(true);
  });
});
