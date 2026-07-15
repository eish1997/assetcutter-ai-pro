import { describe, expect, it } from 'vitest';

import {
  buildPseudoMultiTurnPromptBlock,
  extractQuickComposeTurnRounds,
  formatQuickComposeTurnContextForPromptOverride,
  patchQuickComposeThreadMessageStatuses,
  QUICK_COMPOSE_ORPHAN_TASK_ERROR,
  resolvePlainTextPromptForModel,
  resolveQuickComposeAssistantMessageStatus,
  resolveWorkflowAssetLatestTextResult,
  workflowAssetHasSuccessfulOutput,
} from '../services/quickComposeTurnContext';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';
import type { WorkflowAsset, WorkflowPendingTask } from '../types';

function msg(
  partial: Partial<QuickComposeThreadMessage> & Pick<QuickComposeThreadMessage, 'role' | 'text'>
): QuickComposeThreadMessage {
  return {
    id: partial.id ?? 'id',
    role: partial.role,
    text: partial.text,
    timestamp: partial.timestamp ?? 0,
    ...partial,
  };
}

describe('quickComposeTurnContext', () => {
  it('extractQuickComposeTurnRounds groups user+assistant pairs', () => {
    const messages: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: 'a' }),
      msg({ id: 'a1', role: 'assistant', text: 'b' }),
      msg({ id: 'u2', role: 'user', text: 'c' }),
    ];
    const rounds = extractQuickComposeTurnRounds(messages);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].user.text).toBe('a');
    expect(rounds[0].assistant?.text).toBe('b');
    expect(rounds[1].assistant).toBeUndefined();
  });

  it('buildPseudoMultiTurnPromptBlock returns empty for no messages', () => {
    expect(buildPseudoMultiTurnPromptBlock([])).toBe('');
  });

  it('buildPseudoMultiTurnPromptBlock formats recent rounds', () => {
    const messages: QuickComposeThreadMessage[] = [
      msg({ id: 'u0', role: 'user', text: 'old request' }),
      msg({ id: 'a0', role: 'assistant', text: 'old reply' }),
      msg({ id: 'u1', role: 'user', text: 'make it red' }),
      msg({ id: 'a1', role: 'assistant', text: 'Applied red tone.' }),
      msg({ id: 'u2', role: 'user', text: 'add stars' }),
      msg({ id: 'a2', role: 'assistant', text: 'Added stars.' }),
    ];
    const block = buildPseudoMultiTurnPromptBlock(messages, 2);
    expect(block).toContain('Recent conversation:');
    expect(block).toContain('User: add stars');
    expect(block).toContain('Assistant: Added stars.');
    expect(block).not.toContain('old request');
  });

  it('buildPseudoMultiTurnPromptBlock includes user-only trailing round', () => {
    const messages: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: 'prior' }),
      msg({ id: 'a1', role: 'assistant', text: 'ok' }),
      msg({ id: 'u2', role: 'user', text: 'pending question' }),
    ];
    const block = buildPseudoMultiTurnPromptBlock(messages, 3);
    expect(block).toContain('User: pending question');
    const afterPending = block.split('User: pending question')[1] ?? '';
    expect(afterPending).not.toContain('Assistant:');
  });

  it('buildPseudoMultiTurnPromptBlock prefers assistant resultText over plan text', () => {
    const messages: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: '写一句问候' }),
      msg({
        id: 'a1',
        role: 'assistant',
        text: '计划：文生文',
        resultText: '你好，很高兴认识你。',
        status: 'done',
      }),
    ];
    const block = buildPseudoMultiTurnPromptBlock(messages, 3);
    expect(block).toContain('Assistant: 你好，很高兴认识你。');
    expect(block).not.toContain('计划：文生文');
  });

  it('formatQuickComposeTurnContextForPromptOverride appends current prompt', () => {
    const prior: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: 'hello' }),
      msg({ id: 'a1', role: 'assistant', text: 'hi' }),
    ];
    const out = formatQuickComposeTurnContextForPromptOverride(prior, 'now brighter');
    expect(out).toContain('Recent conversation:');
    expect(out).toContain('User: hello');
    expect(out).toContain('Assistant: hi');
    expect(out.endsWith('now brighter')).toBe(true);
  });

  it('formatQuickComposeTurnContextForPromptOverride without history returns current only', () => {
    expect(formatQuickComposeTurnContextForPromptOverride([], 'solo prompt')).toBe('solo prompt');
  });

  it('resolvePlainTextPromptForModel skips thread inject when flag set (Agent B-layer)', () => {
    const prior: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: 'old' }),
      msg({ id: 'a1', role: 'assistant', text: 'reply' }),
    ];
    const assembled = '[B-layer]\n\ncurrent agent text';
    expect(
      resolvePlainTextPromptForModel({
        currentTurnText: assembled,
        priorMessages: prior,
        skipThreadContextInject: true,
      })
    ).toBe(assembled);
  });

  it('resolvePlainTextPromptForModel still formats when flag unset', () => {
    const prior: QuickComposeThreadMessage[] = [
      msg({ id: 'u1', role: 'user', text: 'old' }),
      msg({ id: 'a1', role: 'assistant', text: 'reply' }),
    ];
    const out = resolvePlainTextPromptForModel({
      currentTurnText: 'now',
      priorMessages: prior,
    });
    expect(out).toContain('Recent conversation:');
    expect(out.endsWith('now')).toBe(true);
  });

  it('resolvePlainTextPromptForModel prefers pseudoMultiTurnPrompt over skip flag', () => {
    expect(
      resolvePlainTextPromptForModel({
        currentTurnText: 'ignored',
        priorMessages: [],
        pseudoMultiTurnPrompt: 'pseudo block',
        skipThreadContextInject: true,
      })
    ).toBe('pseudo block');
  });

});

const emptyRuntime = {
  pending: [] as WorkflowPendingTask[],
  executingQueue: null as { tasks: WorkflowPendingTask[] } | null,
  activeTaskIds: new Set<string>(),
  completedTaskIds: new Set<string>(),
  assetErrors: new Map<string, string>(),
  cancelledTaskIds: new Set<string>(),
  resolveModule: () => null,
};

describe('resolveQuickComposeAssistantMessageStatus', () => {

  it('marks orphaned task ids as error when no runtime queue entry', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-gone'],
      taskAssetById: { 'task-gone': 'asset-1' },
    });
    expect(status).toBe('error');
  });

  it('uses persisted taskAssetById to detect assetErrors after batch reset', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-1'],
      taskAssetById: { 'task-1': 'asset-1' },
      assetErrors: new Map([['asset-1', '429 Too Many Requests']]),
    });
    expect(status).toBe('error');
  });

  it('returns done when completedTaskIds contains all tasks without errors', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-1'],
      completedTaskIds: new Set(['task-1']),
      taskAssetById: { 'task-1': 'asset-1' },
    });
    expect(status).toBe('done');
  });

  it('returns error for empty taskIds', () => {
    expect(
      resolveQuickComposeAssistantMessageStatus({
        ...emptyRuntime,
        taskIds: [],
      })
    ).toBe('error');
  });

  it('returns done when orphaned task asset already has textResults', () => {
    const asset: WorkflowAsset = {
      id: 'asset-1',
      original: '',
      displayKey: 'plain_text',
      results: {},
      resultOrder: ['plain_text'],
      archived: false,
      hiddenInGrid: true,
      createdAt: 1,
      assetKind: 'text',
      textResults: { plain_text: '生成好的正文' },
    };
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-gone'],
      taskAssetById: { 'task-gone': 'asset-1' },
      resolveAssetById: (id) => (id === 'asset-1' ? asset : null),
    });
    expect(status).toBe('done');
  });

  it('does not orphan while asset catalog is still empty (hydrate)', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-gone'],
      taskAssetById: { 'task-gone': 'asset-1' },
      resolveAssetById: () => null,
      assetCatalogEmpty: true,
    });
    expect(status).toBe('running');
  });

  it('orphans when catalog has assets but hinted id is missing', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-gone'],
      taskAssetById: { 'task-gone': 'asset-missing' },
      resolveAssetById: () => null,
      assetCatalogEmpty: false,
    });
    expect(status).toBe('error');
  });

  it('returns queued when task is only in pending (credit-gate window before executingQueue)', () => {
    const status = resolveQuickComposeAssistantMessageStatus({
      ...emptyRuntime,
      taskIds: ['task-1'],
      taskAssetById: { 'task-1': 'asset-1' },
      pending: [
        {
          id: 'task-1',
          assetId: 'asset-1',
          actionType: 'plain_text',
          inputImage: '',
          addedAt: 1,
        },
      ],
    });
    expect(status).toBe('queued');
  });
});

describe('workflowAssetHasSuccessfulOutput / resolveWorkflowAssetLatestTextResult', () => {
  it('detects textResults and returns latest body', () => {
    const asset: WorkflowAsset = {
      id: 'a',
      original: '',
      displayKey: 'v2',
      results: {},
      resultOrder: ['v1', 'v2'],
      archived: false,
      hiddenInGrid: true,
      createdAt: 1,
      assetKind: 'text',
      textResults: { v1: 'first', v2: 'second' },
    };
    expect(workflowAssetHasSuccessfulOutput(asset)).toBe(true);
    expect(resolveWorkflowAssetLatestTextResult(asset)).toBe('second');
  });
});

describe('patchQuickComposeThreadMessageStatuses', () => {
  it('keeps 已取消 when cancelled task later gets assetErrors (429)', () => {
    const messages = patchQuickComposeThreadMessageStatuses(
      {
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            text: '计划：文生图',
            status: 'error',
            errorMessage: '已取消',
            taskIds: ['t1'],
            taskAssetById: { t1: 'asset-1' },
          }),
        ],
      },
      {
        ...emptyRuntime,
        cancelledTaskIds: new Set(['t1']),
        completedTaskIds: new Set(['t1']),
        assetErrors: new Map([
          ['asset-1', 'Google/Vertex API 配额或 RPM 触顶（原始：Too Many Requests）'],
        ]),
      }
    );
    expect(messages[0].status).toBe('error');
    expect(messages[0].errorMessage).toBe('已取消');
  });

  it('keeps 已取消 sticky after cancelledTaskIds cleared (batch finally / orphan window)', () => {
    const messages = patchQuickComposeThreadMessageStatuses(
      {
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            text: '计划：文生文',
            status: 'error',
            errorMessage: '已取消',
            taskIds: ['t1'],
            taskAssetById: { t1: 'asset-1' },
          }),
        ],
      },
      {
        ...emptyRuntime,
        // 批结束 finally 已清空 cancelled；completed 也可能尚未写入或已被新批清空
        cancelledTaskIds: new Set(),
        completedTaskIds: new Set(),
      }
    );
    expect(messages[0].status).toBe('error');
    expect(messages[0].errorMessage).toBe('已取消');
  });

  it('does not promote 已取消 to done just because completedTaskIds has the task', () => {
    const messages = patchQuickComposeThreadMessageStatuses(
      {
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            text: '计划：文生文',
            status: 'error',
            errorMessage: '已取消',
            taskIds: ['t1'],
            taskAssetById: { t1: 'asset-1' },
          }),
        ],
      },
      {
        ...emptyRuntime,
        cancelledTaskIds: new Set(),
        completedTaskIds: new Set(['t1']),
      }
    );
    expect(messages[0].status).toBe('error');
    expect(messages[0].errorMessage).toBe('已取消');
  });

  it('writes resultText when status becomes done from asset textResults', () => {
    const asset: WorkflowAsset = {
      id: 'asset-1',
      original: '',
      displayKey: 'plain_text',
      results: {},
      resultOrder: ['plain_text'],
      archived: false,
      hiddenInGrid: true,
      createdAt: 1,
      assetKind: 'text',
      textResults: { plain_text: '气泡正文' },
    };
    const messages = patchQuickComposeThreadMessageStatuses(
      {
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            text: '计划：文生文',
            status: 'queued',
            taskIds: ['t1'],
            taskAssetById: { t1: 'asset-1' },
          }),
        ],
      },
      {
        ...emptyRuntime,
        resolveAssetById: (id) => (id === 'asset-1' ? asset : null),
      }
    );
    expect(messages[0].status).toBe('done');
    expect(messages[0].resultText).toBe('气泡正文');
    expect(messages[0].errorMessage).toBeUndefined();
  });
  it('persists taskAssetById from live queue so result thumbs can resolve after completion', () => {
    const messages = patchQuickComposeThreadMessageStatuses(
      {
        messages: [
          msg({
            id: 'a1',
            role: 'assistant',
            text: '璁″垝锛氬浘鐢熷浘',
            status: 'queued',
            taskIds: ['t1'],
          }),
        ],
      },
      {
        ...emptyRuntime,
        pending: [
          {
            id: 't1',
            assetId: 'asset-1',
            actionType: 'gen',
            inputImage: 'data:image/png;base64,src',
            addedAt: 1,
          },
        ],
      }
    );
    expect(messages[0].taskAssetById).toEqual({ t1: 'asset-1' });
  });
});

describe('QUICK_COMPOSE_ORPHAN_TASK_ERROR', () => {
  it('is a user-facing retry hint', () => {
    expect(QUICK_COMPOSE_ORPHAN_TASK_ERROR).toContain('重试');
  });
});
