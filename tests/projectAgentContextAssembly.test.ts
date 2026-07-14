import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLocalJson } from '../services/clientPersist';
import {
  assembleProjectAgentContext,
  formatAssembledContextPrefix,
  injectAssembledContextIntoUserText,
  planNeedsConversationContext,
} from '../services/projectAgent/contextAssembly';
import {
  __resetProjectAgentKnowledgeForTests,
  addProjectAgentKnowledge,
  setProjectAgentKnowledgeEnabled,
} from '../services/projectAgent/knowledgeStore';
import {
  loadProjectAgentCompaction,
  maybeCompactProjectAgentThread,
  PROJECT_AGENT_COMPACTION_KEEP_RECENT,
  saveProjectAgentCompaction,
} from '../services/projectAgent/compaction';
import { buildProjectAgentIntent } from '../services/projectAgent/intent';
import { createProjectAgentRuntime } from '../services/projectAgent/runtime';
import { createMemoryHostPort } from '../services/projectAgent/host/memoryHostPort';
import type { ProjectAgentIntent } from '../types/projectAgent';
import type { ProjectAgentThread } from '../services/projectAgent/threadStore';

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

const storeKey = { userId: 'user-ctx', workspaceProjectId: 'proj-ctx' };

function makeThread(partial?: Partial<ProjectAgentThread>): ProjectAgentThread {
  return {
    id: 'thread-1',
    workspaceProjectId: 'proj-ctx',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
  __resetProjectAgentKnowledgeForTests();
});

afterEach(() => {
  try {
    writeLocalJson('ac_project_agent_compaction_v1__u_user-ctx__p_proj-ctx', null);
  } catch {
    /* ignore */
  }
  __resetProjectAgentKnowledgeForTests();
  vi.unstubAllGlobals();
});

describe('assembleProjectAgentContext (pure)', () => {
  it('includes compaction summary and recent lean rounds', () => {
    saveProjectAgentCompaction(storeKey, {
      workspaceProjectId: 'proj-ctx',
      summaryText: 'Earlier: cat sketch',
      coveredMessageIds: ['old1'],
      updatedAt: 1,
    });
    const thread = makeThread({
      messages: [
        { id: 'u1', role: 'user', text: 'draw a fox', timestamp: 1 },
        { id: 'a1', role: 'assistant', text: '计划：文生文', resultText: 'fox outline', timestamp: 2 },
      ],
    });
    const intent = buildProjectAgentIntent({ mode: 'text', text: 'continue' });
    const assembled = assembleProjectAgentContext({ key: storeKey, thread, intent });
    expect(assembled.compactionSummary).toContain('Earlier');
    expect(assembled.recentText).toContain('draw a fox');
    expect(assembled.recentText).toContain('fox outline');
    expect(assembled.truncated).toBe(true);

    const prefix = formatAssembledContextPrefix(assembled);
    expect(prefix).toContain('【更早摘要】');
    expect(prefix).toContain('【最近对话】');
    expect(prefix).not.toMatch(/Intent:/);
    const injected = injectAssembledContextIntoUserText('continue', assembled);
    expect(injected.startsWith(prefix)).toBe(true);
    expect(injected.endsWith('continue')).toBe(true);
  });

  it('strips base64 from assembled recent text', () => {
    const b64 = `data:image/png;base64,${'A'.repeat(120)}`;
    const thread = makeThread({
      messages: [{ id: 'u1', role: 'user', text: `see ${b64}`, timestamp: 1 }],
    });
    const assembled = assembleProjectAgentContext({
      key: storeKey,
      thread,
      intent: buildProjectAgentIntent({ mode: 'text', text: 'hi' }),
    });
    expect(assembled.recentText).toContain('[omitted-base64]');
    expect(assembled.recentText).not.toMatch(/base64,[A-Za-z0-9+/]{20,}/i);
  });

  it('includes enabled project knowledge and skips disabled knowledge', () => {
    const keep = addProjectAgentKnowledge({
      scope: storeKey,
      kind: 'style',
      text: '后续主图统一使用高级灰背景',
      label: '视觉风格',
    });
    const disabled = addProjectAgentKnowledge({
      scope: storeKey,
      kind: 'brand_rule',
      text: '这条禁用后不应注入',
    });
    setProjectAgentKnowledgeEnabled(storeKey, disabled.id, false);

    const assembled = assembleProjectAgentContext({
      key: storeKey,
      thread: makeThread(),
      intent: buildProjectAgentIntent({ mode: 'text', text: '继续' }),
    });
    expect(assembled.projectKnowledge).toContain('高级灰背景');
    expect(assembled.projectKnowledge).not.toContain('不应注入');
    expect(assembled.projectKnowledgeIdsInjected).toEqual([keep.id]);

    const prefix = formatAssembledContextPrefix(assembled);
    expect(prefix).toContain('【项目知识】');
    expect(prefix).toContain('高级灰背景');
  });

  it('planNeedsConversationContext only for text + expert', () => {
    expect(planNeedsConversationContext([{ toolId: 'run_plain_text' }])).toBe(true);
    expect(planNeedsConversationContext([{ toolId: 'invoke_expert' }])).toBe(true);
    expect(planNeedsConversationContext([{ toolId: 'run_plain_t2i' }])).toBe(false);
    expect(planNeedsConversationContext([{ toolId: 'run_preset' }])).toBe(false);
  });
});

describe('submitTurn injects assembled context via HostPort.getThread', () => {
  it('prefixes intent.text for run_plain_text when getThread provides history', async () => {
    const thread = makeThread({
      messages: [
        { id: 'u0', role: 'user', text: 'prior user ask', timestamp: 1 },
        { id: 'a0', role: 'assistant', text: '计划', resultText: 'prior answer', timestamp: 2 },
      ],
    });
    let capturedIntent: ProjectAgentIntent | null = null;
    const mem = createMemoryHostPort();
    const host = {
      ...mem,
      getThread: () => thread,
      getThreadStoreKey: () => storeKey,
      executePlan: (intent: ProjectAgentIntent) => {
        capturedIntent = intent;
        return { taskIds: [], resultText: 'ok' };
      },
    };
    const runtime = createProjectAgentRuntime(host);
    const result = await runtime.submitTurn({
      turnId: 'turn-ctx-text-1',
      threadId: thread.id,
      workspaceProjectId: 'proj-ctx',
      intent: buildProjectAgentIntent({ mode: 'text', text: 'follow up' }),
    });
    expect(result.ok).toBe(true);
    expect(capturedIntent).not.toBeNull();
    expect(capturedIntent!.text).toContain('prior user ask');
    expect(capturedIntent!.text).toContain('prior answer');
    expect(capturedIntent!.text).toContain('follow up');
    expect(capturedIntent!.text).toContain('【最近对话】');
  });

  it('does not prefix intent.text for image (t2i) plans', async () => {
    const thread = makeThread({
      messages: [
        { id: 'u0', role: 'user', text: 'secret history', timestamp: 1 },
        { id: 'a0', role: 'assistant', text: 'plan', resultText: 'done', timestamp: 2 },
      ],
    });
    let capturedIntent: ProjectAgentIntent | null = null;
    const mem = createMemoryHostPort();
    const host = {
      ...mem,
      getThread: () => thread,
      getThreadStoreKey: () => storeKey,
      executePlan: (intent: ProjectAgentIntent) => {
        capturedIntent = intent;
        return { taskIds: ['t1'] };
      },
    };
    const runtime = createProjectAgentRuntime(host);
    await runtime.submitTurn({
      turnId: 'turn-ctx-img-1',
      threadId: thread.id,
      workspaceProjectId: 'proj-ctx',
      intent: buildProjectAgentIntent({ mode: 'image', text: '一只猫' }),
    });
    expect(capturedIntent!.text).toBe('一只猫');
    expect(capturedIntent!.text).not.toContain('secret history');
    expect(capturedIntent!.text).not.toContain('【最近对话】');
  });

  it('prefixes invoke_expert path and skips when getThread missing', async () => {
    const thread = makeThread({
      messages: [
        { id: 'u0', role: 'user', text: 'expert prior', timestamp: 1 },
        { id: 'a0', role: 'assistant', text: '计划', resultText: 'expert reply', timestamp: 2 },
      ],
    });
    let withThreadText = '';
    const mem = createMemoryHostPort();
    const withThread = createProjectAgentRuntime({
      ...mem,
      getThread: () => thread,
      getThreadStoreKey: () => storeKey,
      executePlan: (intent) => {
        withThreadText = intent.text;
        return { taskIds: [], resultText: 'expert-out' };
      },
    });
    await withThread.submitTurn({
      turnId: 'turn-ctx-expert-1',
      threadId: thread.id,
      workspaceProjectId: 'proj-ctx',
      intent: buildProjectAgentIntent({
        mode: 'text',
        text: 'polish this',
        mentions: [{ kind: 'expert', id: 'expert.prompt_smith', label: '提示词专家' }],
      }),
    });
    expect(withThreadText).toContain('expert prior');
    expect(withThreadText).toContain('polish this');

    let noThreadText = '';
    const without = createProjectAgentRuntime({
      ...createMemoryHostPort(),
      executePlan: (intent) => {
        noThreadText = intent.text;
        return { taskIds: [], resultText: 'x' };
      },
    });
    await without.submitTurn({
      turnId: 'turn-ctx-expert-2',
      threadId: 't2',
      workspaceProjectId: 'proj-ctx',
      intent: buildProjectAgentIntent({
        mode: 'text',
        text: 'polish this',
        mentions: [{ kind: 'expert', id: 'expert.prompt_smith' }],
      }),
    });
    expect(noThreadText).toBe('polish this');
  });

  it('swallows assemble failures and still executes', async () => {
    const mem = createMemoryHostPort();
    const host = {
      ...mem,
      getThread: () => {
        throw new Error('boom');
      },
      executePlan: vi.fn(() => ({ taskIds: [], resultText: 'ok' })),
    };
    const runtime = createProjectAgentRuntime(host);
    const result = await runtime.submitTurn({
      turnId: 'turn-ctx-fail-1',
      threadId: 't',
      workspaceProjectId: 'proj-ctx',
      intent: buildProjectAgentIntent({ mode: 'text', text: 'hi' }),
    });
    expect(result.ok).toBe(true);
    expect(host.executePlan).toHaveBeenCalled();
  });
});

describe('maybeCompact after long thread', () => {
  it('writes summary when messages exceed keep-recent', () => {
    const messages = Array.from({ length: PROJECT_AGENT_COMPACTION_KEEP_RECENT + 2 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `line-${i}`,
      timestamp: i + 1,
    }));
    const compaction = maybeCompactProjectAgentThread(storeKey, makeThread({ messages }));
    expect(compaction?.summaryText).toContain('line-0');
    expect(loadProjectAgentCompaction(storeKey)?.coveredMessageIds.length).toBe(2);
  });
});
