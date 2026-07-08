/**
 * 档 A：伪多轮 — 将最近 2～3 轮对话文本格式化为 promptOverride 附加上下文。
 */

import type { QuickComposeMessageStatus, QuickComposeThreadMessage } from '../types/quickComposeThread';
import type { WorkflowPendingTask } from '../types';
import type { CustomAppModule } from '../types';
import { getCapabilityEngine } from './capabilityExecutor';

export const DEFAULT_QUICK_COMPOSE_TURN_MAX_ROUNDS = 3;

export type QuickComposeTurnRound = {
  user: QuickComposeThreadMessage;
  assistant?: QuickComposeThreadMessage;
};

function formatRoleLine(role: 'user' | 'assistant', text: string): string {
  const label = role === 'user' ? 'User' : 'Assistant';
  const body = text.trim();
  return body ? `${label}: ${body}` : '';
}

function formatRound(round: QuickComposeTurnRound): string {
  const lines = [formatRoleLine('user', round.user.text)];
  if (round.assistant) {
    const assistantLine = formatRoleLine('assistant', round.assistant.text);
    if (assistantLine) lines.push(assistantLine);
  }
  return lines.filter(Boolean).join('\n');
}

/** 按时间序将消息切成 user→assistant 轮次。 */
export function extractQuickComposeTurnRounds(
  messages: QuickComposeThreadMessage[]
): QuickComposeTurnRound[] {
  const rounds: QuickComposeTurnRound[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role !== 'user') {
      i += 1;
      continue;
    }
    const round: QuickComposeTurnRound = { user: m };
    const next = messages[i + 1];
    if (next?.role === 'assistant') {
      round.assistant = next;
      i += 2;
    } else {
      i += 1;
    }
    rounds.push(round);
  }
  return rounds;
}

/**
 * 将最近 maxRounds 轮格式化为附加上下文块（不含当前待提交句）。
 * 无历史时返回空串。
 */
export function buildPseudoMultiTurnPromptBlock(
  messages: QuickComposeThreadMessage[],
  maxRounds: number = DEFAULT_QUICK_COMPOSE_TURN_MAX_ROUNDS
): string {
  const cap = Math.max(1, Math.floor(maxRounds));
  const rounds = extractQuickComposeTurnRounds(messages);
  const recent = rounds.slice(-cap);
  const blocks = recent.map(formatRound).filter(Boolean);
  if (blocks.length === 0) return '';
  return `Recent conversation:\n${blocks.join('\n\n')}`;
}

/**
 * 历史块 + 当前用户句，供写入 promptOverride。
 * 无历史时仅返回 currentUserPrompt。
 */
export function formatQuickComposeTurnContextForPromptOverride(
  priorMessages: QuickComposeThreadMessage[],
  currentUserPrompt: string,
  maxRounds: number = DEFAULT_QUICK_COMPOSE_TURN_MAX_ROUNDS
): string {
  const history = buildPseudoMultiTurnPromptBlock(priorMessages, maxRounds);
  const current = currentUserPrompt.trim();
  if (!history) return current;
  if (!current) return history;
  return `${history}\n\n${current}`;
}

function findTaskById(
  taskId: string,
  pending: WorkflowPendingTask[],
  executingQueue: { tasks: WorkflowPendingTask[] } | null
): WorkflowPendingTask | null {
  return pending.find((t) => t.id === taskId) ?? executingQueue?.tasks.find((t) => t.id === taskId) ?? null;
}

function taskNeedsUnderstandPhase(task: WorkflowPendingTask, module: CustomAppModule | null): boolean {
  if (task.overrideSkipUnderstand === true) return false;
  if (task.overrideSkipUnderstand === false) return true;
  if (!module || module.skipUnderstand === true) return false;
  return getCapabilityEngine(module) === 'gen_image';
}

/** 根据关联 taskIds 推导助手消息状态 */
export function resolveQuickComposeAssistantMessageStatus(args: {
  taskIds: string[];
  pending: WorkflowPendingTask[];
  executingQueue: { tasks: WorkflowPendingTask[] } | null;
  activeTaskIds: ReadonlySet<string>;
  completedTaskIds: ReadonlySet<string>;
  assetErrors: ReadonlyMap<string, string>;
  cancelledTaskIds: ReadonlySet<string>;
  resolveModule: (actionType: string) => CustomAppModule | null;
}): QuickComposeMessageStatus {
  const {
    taskIds,
    pending,
    executingQueue,
    activeTaskIds,
    completedTaskIds,
    assetErrors,
    cancelledTaskIds,
    resolveModule,
  } = args;
  if (taskIds.length === 0) return 'queued';

  let anyActive = false;
  let anyUnderstanding = false;
  let allCompleted = true;
  let anyError = false;

  for (const taskId of taskIds) {
    if (cancelledTaskIds.has(taskId)) {
      anyError = true;
      continue;
    }
    const task = findTaskById(taskId, pending, executingQueue);
    if (!task) {
      if (!completedTaskIds.has(taskId)) allCompleted = false;
      continue;
    }
    const assetErr = assetErrors.get(task.assetId);
    if (assetErr) {
      anyError = true;
      continue;
    }
    if (completedTaskIds.has(taskId)) continue;
    allCompleted = false;
    if (activeTaskIds.has(taskId)) {
      anyActive = true;
      if (taskNeedsUnderstandPhase(task, resolveModule(task.actionType))) anyUnderstanding = true;
    }
  }

  if (anyError) return 'error';
  if (allCompleted) return 'done';
  if (anyUnderstanding) return 'understanding';
  if (anyActive) return 'running';
  return 'queued';
}

export function patchQuickComposeThreadMessageStatuses(
  thread: { messages: QuickComposeThreadMessage[] },
  args: Omit<Parameters<typeof resolveQuickComposeAssistantMessageStatus>[0], 'taskIds'>
): QuickComposeThreadMessage[] {
  let changed = false;
  const next = thread.messages.map((m) => {
    if (m.role !== 'assistant' || !m.taskIds?.length) return m;
    const status = resolveQuickComposeAssistantMessageStatus({
      ...args,
      taskIds: m.taskIds,
    });
    let errorMessage: string | undefined;
    if (status === 'error') {
      for (const taskId of m.taskIds) {
        const task = findTaskById(taskId, args.pending, args.executingQueue);
        if (task) {
          const err = args.assetErrors.get(task.assetId);
          if (err) {
            errorMessage = err;
            break;
          }
        }
      }
      errorMessage = errorMessage ?? m.errorMessage;
    }
    if (m.status === status && m.errorMessage === errorMessage) return m;
    changed = true;
    return {
      ...m,
      status,
      ...(status === 'error' && errorMessage ? { errorMessage } : {}),
    };
  });
  return changed ? next : thread.messages;
}
