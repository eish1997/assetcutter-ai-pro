import { describe, expect, it } from 'vitest';

import {
  buildPseudoMultiTurnPromptBlock,
  extractQuickComposeTurnRounds,
  formatQuickComposeTurnContextForPromptOverride,
  QUICK_COMPOSE_ORPHAN_TASK_ERROR,
  resolveQuickComposeAssistantMessageStatus,
} from '../services/quickComposeTurnContext';
import type { QuickComposeThreadMessage } from '../types/quickComposeThread';
import type { WorkflowPendingTask } from '../types';

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
});

describe('resolveQuickComposeAssistantMessageStatus', () => {
  const emptyRuntime = {
    pending: [] as WorkflowPendingTask[],
    executingQueue: null as { tasks: WorkflowPendingTask[] } | null,
    activeTaskIds: new Set<string>(),
    completedTaskIds: new Set<string>(),
    assetErrors: new Map<string, string>(),
    cancelledTaskIds: new Set<string>(),
    resolveModule: () => null,
  };

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
});

describe('QUICK_COMPOSE_ORPHAN_TASK_ERROR', () => {
  it('is a user-facing retry hint', () => {
    expect(QUICK_COMPOSE_ORPHAN_TASK_ERROR).toContain('重试');
  });
});
