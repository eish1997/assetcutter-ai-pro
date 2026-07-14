/**
 * Phase 4B — ExpertMemoryStore (§17.6 memory_* / clear_memory).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXPERT_MEMORY_INJECT_CHAR_BUDGET,
  __resetExpertMemoryStoreForTests,
  addExpertMemory,
  clearExpertMemories,
  deleteExpertMemory,
  expertMemoryStorageKey,
  listExpertMemories,
  retrieveExpertMemoriesForInject,
} from '../services/projectAgent/experts/memoryStore';
import {
  PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET,
  __resetProjectAgentKnowledgeForTests,
  addProjectAgentKnowledge,
  deleteProjectAgentKnowledge,
  listProjectAgentKnowledge,
  projectAgentKnowledgeStorageKey,
  retrieveProjectAgentKnowledgeForInject,
  setProjectAgentKnowledgeEnabled,
} from '../services/projectAgent/knowledgeStore';
import type { ExpertMemoryScope, ProjectAgentKnowledgeScope } from '../types/projectAgent';

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

const scope: ExpertMemoryScope = {
  userId: 'u-mem-test',
  expertId: 'expert.prompt_smith',
  workspaceProjectId: 'proj-mem-1',
};

const knowledgeScope: ProjectAgentKnowledgeScope = {
  userId: 'u-mem-test',
  workspaceProjectId: 'proj-mem-1',
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  __resetExpertMemoryStoreForTests();
  __resetProjectAgentKnowledgeForTests();
});

describe('ExpertMemoryStore (4B / §17.6)', () => {
  it('expertMemoryStorageKey isolates by user + expert + optional project', () => {
    const withProj = expertMemoryStorageKey(scope);
    const userLevel = expertMemoryStorageKey({
      userId: scope.userId,
      expertId: scope.expertId,
    });
    const otherExpert = expertMemoryStorageKey({
      ...scope,
      expertId: 'expert.brief_outliner',
    });
    expect(withProj).toContain('__u_u-mem-test');
    expect(withProj).toContain('__e_expert.prompt_smith');
    expect(withProj).toContain('__p_proj-mem-1');
    expect(userLevel).not.toContain('__p_');
    expect(otherExpert).not.toBe(withProj);
  });

  it('memory_survives_reload', () => {
    const saved = addExpertMemory({
      scope,
      kind: 'preference',
      text: '以后都偏胶片感',
    });
    expect(listExpertMemories(scope).map((e) => e.id)).toContain(saved.id);

    // Simulate reload: drop in-memory cache; localStorage mock retains blob
    __resetExpertMemoryStoreForTests();

    const loaded = listExpertMemories(scope);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(saved.id);
    expect(loaded[0]?.text).toBe('以后都偏胶片感');
  });

  it('memory_budget_truncates', () => {
    const budget = 80;
    addExpertMemory({
      scope,
      kind: 'preference',
      text: 'A'.repeat(50),
    });
    addExpertMemory({
      scope,
      kind: 'preference',
      text: 'B'.repeat(50),
    });
    addExpertMemory({
      scope,
      kind: 'summary',
      text: 'C'.repeat(50),
    });

    const result = retrieveExpertMemoriesForInject({ scope, charBudget: budget });
    expect(result.truncated).toBe(true);
    const totalChars = result.entries.reduce((n, e) => n + e.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(budget);
    expect(result.memoryIdsInjected.length).toBe(result.entries.length);
    expect(result.memoryIdsInjected.length).toBeGreaterThan(0);
    expect(result.memoryIdsInjected.length).toBeLessThan(3);
  });

  it('uses default char budget constant', () => {
    expect(EXPERT_MEMORY_INJECT_CHAR_BUDGET).toBe(2000);
    addExpertMemory({
      scope,
      kind: 'preference',
      text: '短偏好',
    });
    const result = retrieveExpertMemoriesForInject({ scope });
    expect(result.truncated).toBe(false);
    expect(result.entries).toHaveLength(1);
  });

  it('clear_memory soft-deletes and stops inject', () => {
    addExpertMemory({ scope, kind: 'preference', text: '记住风格 A' });
    addExpertMemory({ scope, kind: 'rejection', text: '不要血腥' });
    expect(listExpertMemories(scope)).toHaveLength(2);

    const cleared = clearExpertMemories(scope);
    expect(cleared).toBe(2);
    expect(listExpertMemories(scope)).toHaveLength(0);

    const injected = retrieveExpertMemoriesForInject({ scope });
    expect(injected.entries).toHaveLength(0);
    expect(injected.memoryIdsInjected).toEqual([]);
  });

  it('delete soft-deletes one entry; retrieve skips deleted', () => {
    const a = addExpertMemory({ scope, kind: 'preference', text: 'keep me' });
    const b = addExpertMemory({ scope, kind: 'preference', text: 'delete me' });

    expect(deleteExpertMemory(scope, b.id)).toBe(true);
    expect(deleteExpertMemory(scope, b.id)).toBe(false);

    const listed = listExpertMemories(scope);
    expect(listed.map((e) => e.id)).toEqual([a.id]);

    const injected = retrieveExpertMemoriesForInject({ scope });
    expect(injected.memoryIdsInjected).toEqual([a.id]);
    expect(injected.entries.every((e) => e.deletedAt == null)).toBe(true);
  });

  it('isolates memories by expertId', () => {
    const other: ExpertMemoryScope = {
      ...scope,
      expertId: 'expert.brief_outliner',
    };
    addExpertMemory({ scope, kind: 'preference', text: 'smith only' });
    addExpertMemory({ scope: other, kind: 'preference', text: 'outliner only' });

    expect(listExpertMemories(scope)).toHaveLength(1);
    expect(listExpertMemories(scope)[0]?.text).toBe('smith only');
    expect(listExpertMemories(other)[0]?.text).toBe('outliner only');

    const smithInject = retrieveExpertMemoriesForInject({ scope });
    expect(smithInject.entries.every((e) => e.scope.expertId === scope.expertId)).toBe(true);
  });

  it('rejects base64 / data-url media text', () => {
    expect(() =>
      addExpertMemory({
        scope,
        kind: 'summary',
        text: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      })
    ).toThrow(/base64|media/i);
  });
});

describe('ProjectAgentKnowledgeStore (Phase 3)', () => {
  it('projectAgentKnowledgeStorageKey isolates by user + project', () => {
    const key = projectAgentKnowledgeStorageKey(knowledgeScope);
    const otherProject = projectAgentKnowledgeStorageKey({
      ...knowledgeScope,
      workspaceProjectId: 'proj-mem-2',
    });
    const otherUser = projectAgentKnowledgeStorageKey({
      ...knowledgeScope,
      userId: 'u-other',
    });

    expect(key).toContain('__u_u-mem-test');
    expect(key).toContain('__p_proj-mem-1');
    expect(otherProject).not.toBe(key);
    expect(otherUser).not.toBe(key);
  });

  it('stores short project knowledge and survives reload', () => {
    const saved = addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'brand_rule',
      label: 'Brand rule',
      text: 'Use clean skincare visuals and avoid heavy shadows.',
      sourceTurnId: 'turn-k1',
    });

    expect(listProjectAgentKnowledge(knowledgeScope).map((entry) => entry.id)).toContain(saved.id);

    __resetProjectAgentKnowledgeForTests();

    const loaded = listProjectAgentKnowledge(knowledgeScope);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe(saved.id);
    expect(loaded[0]?.label).toBe('Brand rule');
    expect(loaded[0]?.sourceTurnId).toBe('turn-k1');
  });

  it('disabled and deleted project knowledge does not inject', () => {
    const keep = addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'style',
      text: 'Keep packaging background matte white.',
      id: 'keep',
    });
    const disabled = addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'preference',
      text: 'Prefer neon gradients.',
      id: 'disabled',
    });
    const deleted = addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'note',
      text: 'Temporary competitor reference.',
      id: 'deleted',
    });

    expect(setProjectAgentKnowledgeEnabled(knowledgeScope, disabled.id, false)).toBe(true);
    expect(deleteProjectAgentKnowledge(knowledgeScope, deleted.id)).toBe(true);

    const listed = listProjectAgentKnowledge(knowledgeScope);
    expect(listed.map((entry) => entry.id)).toEqual(expect.arrayContaining([keep.id, disabled.id]));
    expect(listed.map((entry) => entry.id)).not.toContain(deleted.id);

    const injected = retrieveProjectAgentKnowledgeForInject({ scope: knowledgeScope });
    expect(injected.knowledgeIdsInjected).toEqual([keep.id]);
    expect(injected.entries[0]?.text).toContain('matte white');

    expect(setProjectAgentKnowledgeEnabled(knowledgeScope, disabled.id, true)).toBe(true);
    const reinjected = retrieveProjectAgentKnowledgeForInject({ scope: knowledgeScope });
    expect(reinjected.knowledgeIdsInjected).toEqual(expect.arrayContaining([keep.id, disabled.id]));
  });

  it('project knowledge injection respects budget and rejects media text', () => {
    expect(PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET).toBe(2400);
    addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'note',
      text: 'A'.repeat(70),
    });
    addProjectAgentKnowledge({
      scope: knowledgeScope,
      kind: 'note',
      text: 'B'.repeat(70),
    });

    const result = retrieveProjectAgentKnowledgeForInject({
      scope: knowledgeScope,
      charBudget: 80,
    });
    expect(result.truncated).toBe(true);
    const totalChars = result.entries.reduce((sum, entry) => sum + entry.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(80);
    expect(result.entries.length).toBe(1);

    expect(() =>
      addProjectAgentKnowledge({
        scope: knowledgeScope,
        kind: 'note',
        text: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      })
    ).toThrow(/base64|media/i);
  });
});
