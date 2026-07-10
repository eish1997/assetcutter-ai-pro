import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendProjectAgentThreadTurn,
  archiveAndResetProjectAgentThread,
  loadOrCreateProjectAgentThread,
} from '../services/projectAgent/threadStore';

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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

describe('archiveAndResetProjectAgentThread (P25)', () => {
  it('new_chat_archives_hot', () => {
    const key = {
      userId: 'test-archive-reset',
      workspaceProjectId: `proj-archive-${Date.now()}`,
    };

    const seeded = appendProjectAgentThreadTurn(key, {
      userText: '画一只猫',
      planText: '计划：文生图',
      taskIds: ['task-archive-1'],
    });
    expect(seeded.messages.length).toBeGreaterThan(0);
    const oldId = seeded.id;

    const { archived, next } = archiveAndResetProjectAgentThread(key);

    expect(archived.id).toBe(oldId);
    expect(archived.messages.length).toBeGreaterThan(0);
    expect(archived.messages.some((m) => m.text.includes('画一只猫'))).toBe(true);

    expect(next.messages).toEqual([]);
    expect(next.id).not.toBe(oldId);
    expect(next.workspaceProjectId).toBe(key.workspaceProjectId);

    const hot = loadOrCreateProjectAgentThread(key);
    expect(hot.id).toBe(next.id);
    expect(hot.messages).toEqual([]);
  });
});
