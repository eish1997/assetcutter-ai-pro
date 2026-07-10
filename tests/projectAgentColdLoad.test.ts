import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetProjectAgentColdLoadForTests,
  hasEarlierMessagesLocal,
  listEarlierMessagesLocal,
  listLocalThreadArchives,
  loadEarlierMessagesIntoHot,
  loadLocalThreadArchive,
  mergeEarlierMessages,
  saveLocalThreadArchive,
  stashColdOverflowMessages,
  stashMessagesDroppedFromHot,
} from '../services/projectAgent/threadColdLoad';
import {
  PROJECT_AGENT_THREAD_MAX_MESSAGES,
  type ProjectAgentThread,
} from '../services/projectAgent/threadStore';
import { saveProjectAgentCompaction } from '../services/projectAgent/compaction';

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

function makeMsg(
  id: string,
  ts: number,
  text = id
): ProjectAgentThread['messages'][number] {
  return { id, role: 'user', text, timestamp: ts, status: 'submitted' };
}

function makeThread(overrides?: Partial<ProjectAgentThread>): ProjectAgentThread {
  return {
    id: 'hot-1',
    workspaceProjectId: 'proj-cold-1',
    messages: [makeMsg('h1', 100), makeMsg('h2', 200)],
    createdAt: 50,
    updatedAt: 200,
    ...overrides,
  };
}

const key = {
  userId: 'user-cold',
  workspaceProjectId: 'proj-cold-1',
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  __resetProjectAgentColdLoadForTests(key);
});

describe('threadColdLoad (5C)', () => {
  it('saveLocalThreadArchive + list/load', () => {
    const archived = makeThread({
      id: 'arch-1',
      messages: [makeMsg('a1', 10), makeMsg('a2', 20)],
    });
    saveLocalThreadArchive(key, archived);
    const metas = listLocalThreadArchives(key);
    expect(metas).toHaveLength(1);
    expect(metas[0].threadId).toBe('arch-1');
    const loaded = loadLocalThreadArchive(key, 'arch-1');
    expect(loaded?.messages.map((m) => m.id)).toEqual(['a1', 'a2']);
  });

  it('listEarlierMessagesLocal excludes hot ids and prefers compaction covered', () => {
    saveLocalThreadArchive(
      key,
      makeThread({
        id: 'arch-2',
        messages: [makeMsg('old1', 1), makeMsg('old2', 2), makeMsg('h1', 100)],
      })
    );
    stashColdOverflowMessages(key, [makeMsg('cold1', 3)]);
    saveProjectAgentCompaction(key, {
      workspaceProjectId: key.workspaceProjectId,
      summaryText: 'sum',
      coveredMessageIds: ['cold1', 'old2'],
      updatedAt: Date.now(),
    });

    const hot = makeThread();
    const earlier = listEarlierMessagesLocal(key, hot);
    expect(earlier.map((m) => m.id)).not.toContain('h1');
    expect(earlier.map((m) => m.id)).toEqual(expect.arrayContaining(['old1', 'old2', 'cold1']));
    // covered ids come first
    expect(earlier[0].id === 'cold1' || earlier[0].id === 'old2').toBe(true);
    expect(hasEarlierMessagesLocal(key, hot)).toBe(true);
  });

  it('mergeEarlierMessages dedupes by id, sorts by timestamp, trims to hot window', () => {
    const hot = makeThread({
      messages: [makeMsg('m50', 50), makeMsg('m60', 60)],
    });
    const earlier = [makeMsg('m10', 10), makeMsg('m50', 50), makeMsg('m5', 5)];
    const merged = mergeEarlierMessages(hot, earlier);
    expect(merged.messages.map((m) => m.id)).toEqual(['m5', 'm10', 'm50', 'm60']);

    const manyEarlier = Array.from({ length: 100 }, (_, i) => makeMsg(`e${i}`, i));
    const fullHot = makeThread({
      messages: Array.from({ length: 40 }, (_, i) => makeMsg(`h${i}`, 1000 + i)),
    });
    const trimmed = mergeEarlierMessages(fullHot, manyEarlier);
    expect(trimmed.messages.length).toBeLessThanOrEqual(PROJECT_AGENT_THREAD_MAX_MESSAGES);
    // newest survive
    expect(trimmed.messages[trimmed.messages.length - 1].id).toBe('h39');
  });

  it('stashMessagesDroppedFromHot then loadEarlierIntoHot after clear', () => {
    const before = Array.from({ length: 5 }, (_, i) => makeMsg(`d${i}`, i));
    const after = before.slice(-2);
    stashMessagesDroppedFromHot(key, before, after);
    expect(listEarlierMessagesLocal(key, makeThread({ messages: after })).map((m) => m.id)).toEqual(
      expect.arrayContaining(['d0', 'd1', 'd2'])
    );

    const emptyHot = makeThread({ id: 'new-hot', messages: [] });
    saveLocalThreadArchive(
      key,
      makeThread({ id: 'cleared', messages: [makeMsg('arch-x', 1)] })
    );
    const { thread, candidateCount } = loadEarlierMessagesIntoHot(key, emptyHot);
    expect(candidateCount).toBeGreaterThan(0);
    expect(thread.messages.some((m) => m.id === 'arch-x')).toBe(true);
  });

  it('hasEarlierMessagesLocal false when only hot messages exist', () => {
    const hot = makeThread();
    expect(hasEarlierMessagesLocal(key, hot)).toBe(false);
  });
});

describe('pullProjectAgentThreadArchive (mocked)', () => {
  it('is exported and callable shape (smoke via dynamic import mock)', async () => {
    vi.resetModules();
    const pull = vi.fn(async () =>
      makeThread({ id: 'remote-arch', messages: [makeMsg('r1', 1)] })
    );
    vi.doMock('../services/projectAgent/threadCloudSync', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../services/projectAgent/threadCloudSync')>();
      return { ...actual, pullProjectAgentThreadArchive: pull };
    });
    const { fetchEarlierMessagesFromKnownArchives } = await import(
      '../services/projectAgent/threadColdLoad'
    );
    // Index entry without local body → triggers cloud pull
    const { writeLocalJson, scopedStorageKey } = await import('../services/clientPersist');
    writeLocalJson(`${scopedStorageKey('ac_project_agent_archive_index_v1', key.userId)}__p_${key.workspaceProjectId}`, {
      workspaceProjectId: key.workspaceProjectId,
      items: [
        {
          threadId: 'remote-arch',
          archivedAt: Date.now(),
          messageCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const msgs = await fetchEarlierMessagesFromKnownArchives(
      { userId: key.userId, workspaceProjectId: key.workspaceProjectId },
      makeThread({ messages: [] })
    );
    expect(pull).toHaveBeenCalled();
    expect(msgs.some((m) => m.id === 'r1')).toBe(true);
  });
});
