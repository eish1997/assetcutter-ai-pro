import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET,
  __resetProjectAgentKnowledgeForTests,
  addProjectAgentKnowledge,
  deleteProjectAgentKnowledge,
  formatProjectAgentKnowledgeForContext,
  listProjectAgentKnowledge,
  projectAgentKnowledgeStorageKey,
  retrieveProjectAgentKnowledgeForInject,
  setProjectAgentKnowledgeEnabled,
} from '../services/projectAgent/knowledgeStore';
import type { ProjectAgentKnowledgeScope } from '../types/projectAgent';

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

const scope: ProjectAgentKnowledgeScope = {
  userId: 'u-knowledge',
  workspaceProjectId: 'proj-knowledge',
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  __resetProjectAgentKnowledgeForTests();
});

describe('ProjectAgentKnowledgeStore (Phase 3)', () => {
  it('isolates project knowledge by user and project', () => {
    const key = projectAgentKnowledgeStorageKey(scope);
    expect(key).toContain('__u_u-knowledge');
    expect(key).toContain('__p_proj-knowledge');

    addProjectAgentKnowledge({
      scope,
      kind: 'style',
      text: '偏高级灰护肤品主图',
      label: '品牌风格',
    });
    addProjectAgentKnowledge({
      scope: { userId: scope.userId, workspaceProjectId: 'other-project' },
      kind: 'style',
      text: '其他项目',
    });

    expect(listProjectAgentKnowledge(scope)).toHaveLength(1);
    expect(listProjectAgentKnowledge(scope)[0]?.text).toBe('偏高级灰护肤品主图');
  });

  it('survives reload and formats short context lines', () => {
    const saved = addProjectAgentKnowledge({
      scope,
      kind: 'brand_rule',
      text: '不要使用医疗功效暗示',
      label: '品牌禁忌',
      sourceTurnId: 'turn-1',
    });
    __resetProjectAgentKnowledgeForTests();

    const loaded = listProjectAgentKnowledge(scope);
    expect(loaded[0]?.id).toBe(saved.id);
    expect(loaded[0]?.sourceTurnId).toBe('turn-1');
    expect(formatProjectAgentKnowledgeForContext(loaded)).toContain('[brand_rule] 品牌禁忌');
  });

  it('disabled and deleted entries are visible or skipped correctly', () => {
    const a = addProjectAgentKnowledge({ scope, kind: 'style', text: '保留冷白光' });
    const b = addProjectAgentKnowledge({ scope, kind: 'workflow', text: '先出三版再收敛' });

    expect(setProjectAgentKnowledgeEnabled(scope, b.id, false)).toBe(true);
    expect(listProjectAgentKnowledge(scope).map((e) => e.id)).toContain(b.id);
    expect(retrieveProjectAgentKnowledgeForInject({ scope }).knowledgeIdsInjected).toEqual([a.id]);

    expect(deleteProjectAgentKnowledge(scope, a.id)).toBe(true);
    expect(deleteProjectAgentKnowledge(scope, a.id)).toBe(false);
    expect(retrieveProjectAgentKnowledgeForInject({ scope }).entries).toHaveLength(0);
  });

  it('applies inject budget and query', () => {
    expect(PROJECT_AGENT_KNOWLEDGE_INJECT_CHAR_BUDGET).toBe(2400);
    addProjectAgentKnowledge({ scope, kind: 'note', text: 'A'.repeat(50), label: 'alpha' });
    addProjectAgentKnowledge({ scope, kind: 'note', text: 'B'.repeat(50), label: 'beta' });

    const budgeted = retrieveProjectAgentKnowledgeForInject({ scope, charBudget: 60 });
    expect(budgeted.entries).toHaveLength(1);
    expect(budgeted.truncated).toBe(true);

    const queried = retrieveProjectAgentKnowledgeForInject({ scope, query: 'alpha' });
    expect(queried.entries).toHaveLength(1);
    expect(queried.entries[0]?.label).toBe('alpha');
  });

  it('rejects media or base64 text', () => {
    expect(() =>
      addProjectAgentKnowledge({
        scope,
        kind: 'note',
        text: `data:image/png;base64,${'A'.repeat(200)}`,
      })
    ).toThrow(/base64|media/i);
  });
});
