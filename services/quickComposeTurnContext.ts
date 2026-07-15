/**
 * 档 A：伪多轮 — 将最近 2～3 轮对话文本格式化为 promptOverride 附加上下文。
 */

import type { QuickComposeMessageStatus, QuickComposeThreadMessage } from '../types/quickComposeThread';
import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import type { CustomAppModule } from '../types';
import { getCapabilityEngine } from './capabilityEngineKind';

export const DEFAULT_QUICK_COMPOSE_TURN_MAX_ROUNDS = 3;

/** 用户取消 turn 后气泡固定文案（勿被迟到 assetErrors / 429 覆盖） */
export const QUICK_COMPOSE_CANCELLED_MESSAGE = '已取消';

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
    // 文生文终态正文在 resultText；计划句在 text — 注入模型时优先正文
    const assistantBody =
      (typeof round.assistant.resultText === 'string' && round.assistant.resultText.trim()) ||
      round.assistant.text;
    const assistantLine = formatRoleLine('assistant', assistantBody);
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

/**
 * 文工具入模本文：pseudo 优先；Agent 已注入 B 层时 skip 伪多轮；否则可选注入近期轮次。
 */
export function resolvePlainTextPromptForModel(opts: {
  currentTurnText: string;
  priorMessages: QuickComposeThreadMessage[];
  pseudoMultiTurnPrompt?: string;
  skipThreadContextInject?: boolean;
  maxRounds?: number;
}): string {
  const current = opts.currentTurnText.trim();
  const pseudo = opts.pseudoMultiTurnPrompt?.trim();
  if (pseudo) return pseudo;
  if (opts.skipThreadContextInject) return current;
  if (opts.priorMessages.length > 0) {
    return formatQuickComposeTurnContextForPromptOverride(
      opts.priorMessages,
      current,
      opts.maxRounds
    );
  }
  return current;
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

/** 关联 task 已从运行时队列消失且无法判定成功时的助手消息错误文案 */
export const QUICK_COMPOSE_ORPHAN_TASK_ERROR = '任务已结束或失败，请重试';

function taskAssetIdForHint(
  taskId: string,
  taskAssetById?: Readonly<Record<string, string>>
): string | undefined {
  const assetId = taskAssetById?.[taskId];
  return assetId?.trim() || undefined;
}

function resolveLiveTaskAssetId(
  taskId: string,
  pending: WorkflowPendingTask[],
  executingQueue: { tasks: WorkflowPendingTask[] } | null
): string | undefined {
  const task = findTaskById(taskId, pending, executingQueue);
  return task?.assetId?.trim() || undefined;
}

function mergeTaskAssetHints(
  taskIds: string[],
  taskAssetById: Readonly<Record<string, string>> | undefined,
  pending: WorkflowPendingTask[],
  executingQueue: { tasks: WorkflowPendingTask[] } | null
): Record<string, string> | undefined {
  const next: Record<string, string> = {};
  for (const rawTaskId of taskIds) {
    const taskId = String(rawTaskId || '').trim();
    if (!taskId) continue;
    const assetId =
      taskAssetIdForHint(taskId, taskAssetById) ||
      resolveLiveTaskAssetId(taskId, pending, executingQueue);
    if (assetId) next[taskId] = assetId;
  }
  return Object.keys(next).length ? next : undefined;
}

/** 任务已出队后：资产上是否已有成功产出（文/图），用于避免误报「任务已结束或失败」。 */
export function workflowAssetHasSuccessfulOutput(asset: WorkflowAsset | null | undefined): boolean {
  if (!asset) return false;
  const textResults = asset.textResults;
  if (textResults && typeof textResults === 'object') {
    for (const v of Object.values(textResults)) {
      if (typeof v === 'string' && v.trim()) return true;
    }
  }
  const results = asset.results;
  if (results && typeof results === 'object') {
    for (const v of Object.values(results)) {
      if (typeof v === 'string' && v.trim()) return true;
    }
  }
  return false;
}

/** 从资产取最新文生文结果（供对话气泡回写）。 */
export function resolveWorkflowAssetLatestTextResult(asset: WorkflowAsset | null | undefined): string {
  if (!asset) return '';
  const order = Array.isArray(asset.resultOrder) ? asset.resultOrder : [];
  const textResults = asset.textResults || {};
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const key = String(order[i] || '').trim();
    if (!key) continue;
    const body = textResults[key];
    if (typeof body === 'string' && body.trim()) return body.trim();
  }
  for (const body of Object.values(textResults)) {
    if (typeof body === 'string' && body.trim()) return body.trim();
  }
  return '';
}

/** 根据关联 taskIds 推导助手消息状态 */
export function resolveQuickComposeAssistantMessageStatus(args: {
  taskIds: string[];
  /** 持久化在助手消息上的 taskId→assetId，用于任务已出队后仍能对齐 assetErrors */
  taskAssetById?: Readonly<Record<string, string>>;
  pending: WorkflowPendingTask[];
  executingQueue: { tasks: WorkflowPendingTask[] } | null;
  activeTaskIds: ReadonlySet<string>;
  completedTaskIds: ReadonlySet<string>;
  assetErrors: ReadonlyMap<string, string>;
  cancelledTaskIds: ReadonlySet<string>;
  resolveModule: (actionType: string) => CustomAppModule | null;
  /** 可选：任务出队后用资产产出判定成功（刷新/重载后 completedTaskIds 为空） */
  resolveAssetById?: (assetId: string) => WorkflowAsset | null | undefined;
  /**
   * 资产目录是否仍为空（初始 hydrate 中）。
   * 为 true 时，hinted 资产尚未解析到不标 orphan，避免默认打开误报红。
   */
  assetCatalogEmpty?: boolean;
}): QuickComposeMessageStatus {
  const {
    taskIds,
    taskAssetById,
    pending,
    executingQueue,
    activeTaskIds,
    completedTaskIds,
    assetErrors,
    cancelledTaskIds,
    resolveModule,
    resolveAssetById,
    assetCatalogEmpty,
  } = args;
  if (taskIds.length === 0) return 'error';

  let anyActive = false;
  let anyUnderstanding = false;
  let allCompleted = true;
  let anyError = false;
  let anyStale = false;

  for (const taskId of taskIds) {
    if (cancelledTaskIds.has(taskId)) {
      anyError = true;
      continue;
    }
    const hintedAssetId = taskAssetIdForHint(taskId, taskAssetById);
    const hintedAssetErr = hintedAssetId ? assetErrors.get(hintedAssetId) : undefined;
    const task = findTaskById(taskId, pending, executingQueue);
    if (!task) {
      if (hintedAssetErr) {
        anyError = true;
        continue;
      }
      if (completedTaskIds.has(taskId)) {
        continue;
      }
      if (hintedAssetId && resolveAssetById) {
        const asset = resolveAssetById(hintedAssetId);
        if (asset == null) {
          // 目录仍空：多半是 hydrate 中；目录已有其它资产仍找不到 → 按 orphan
          if (assetCatalogEmpty) {
            allCompleted = false;
            anyActive = true;
            continue;
          }
        } else if (workflowAssetHasSuccessfulOutput(asset)) {
          continue;
        }
      }
      anyStale = true;
      allCompleted = false;
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
  if (anyStale && !anyActive && !anyUnderstanding) return 'error';
  if (allCompleted) return 'done';
  if (anyUnderstanding) return 'understanding';
  if (anyActive) return 'running';
  return 'queued';
}

function resolveAssistantResultText(
  message: QuickComposeThreadMessage,
  resolveAssetById?: (assetId: string) => WorkflowAsset | null | undefined
): string | undefined {
  const existing = typeof message.resultText === 'string' ? message.resultText.trim() : '';
  if (existing) return existing;
  if (!resolveAssetById || !message.taskIds?.length) return undefined;
  for (const taskId of message.taskIds) {
    const assetId = taskAssetIdForHint(taskId, message.taskAssetById);
    if (!assetId) continue;
    const text = resolveWorkflowAssetLatestTextResult(resolveAssetById(assetId));
    if (text) return text;
  }
  return undefined;
}

function assistantTurnIsUserCancelled(
  taskIds: string[],
  cancelledTaskIds: ReadonlySet<string>,
  activeTaskIds: ReadonlySet<string>,
  pending: WorkflowPendingTask[],
  executingQueue: { tasks: WorkflowPendingTask[] } | null
): boolean {
  if (taskIds.length === 0) return false;
  const cancelled = taskIds.filter((id) => cancelledTaskIds.has(id));
  if (cancelled.length === 0) return false;
  if (cancelled.length === taskIds.length) return true;
  // 部分取消：若其余 task 已不在跑，整 turn 视为用户取消（保留「已取消」）
  return !taskIds.some((id) => {
    if (cancelledTaskIds.has(id)) return false;
    if (activeTaskIds.has(id)) return true;
    return Boolean(findTaskById(id, pending, executingQueue));
  });
}

/** 气泡已标「已取消」时粘性保留，避免批结束清空 cancelled 后被推成 done/orphan。 */
export function isQuickComposeCancelledErrorMessage(errorMessage: string | undefined): boolean {
  return (errorMessage || '').trim() === QUICK_COMPOSE_CANCELLED_MESSAGE;
}

export function patchQuickComposeThreadMessageStatuses(
  thread: { messages: QuickComposeThreadMessage[] },
  args: Omit<Parameters<typeof resolveQuickComposeAssistantMessageStatus>[0], 'taskIds'>
): QuickComposeThreadMessage[] {
  let changed = false;
  const next = thread.messages.map((m) => {
    if (m.role !== 'assistant' || !m.taskIds?.length) return m;
    const taskAssetById = mergeTaskAssetHints(
      m.taskIds,
      m.taskAssetById,
      args.pending,
      args.executingQueue
    );

    // 用户取消粘性：不依赖 cancelledTaskIdsRef 是否仍存活（批 finally / 刷新后可能已空）
    if (m.status === 'error' && isQuickComposeCancelledErrorMessage(m.errorMessage)) {
      return m;
    }

    const status = resolveQuickComposeAssistantMessageStatus({
      ...args,
      taskIds: m.taskIds,
      taskAssetById,
    });
    let errorMessage: string | undefined;
    if (status === 'error') {
      const userCancelled = assistantTurnIsUserCancelled(
        m.taskIds,
        args.cancelledTaskIds,
        args.activeTaskIds,
        args.pending,
        args.executingQueue
      );
      if (userCancelled) {
        // 迟到 429 / assetErrors 不得盖掉「已取消」
        errorMessage =
          (m.errorMessage && m.errorMessage.trim()) || QUICK_COMPOSE_CANCELLED_MESSAGE;
      } else {
        for (const taskId of m.taskIds) {
          const task = findTaskById(taskId, args.pending, args.executingQueue);
          if (task) {
            const err = args.assetErrors.get(task.assetId);
            if (err) {
              errorMessage = err;
              break;
            }
          }
          const hintedAssetId = taskAssetIdForHint(taskId, taskAssetById);
          if (hintedAssetId) {
            const err = args.assetErrors.get(hintedAssetId);
            if (err) {
              errorMessage = err;
              break;
            }
          }
        }
        errorMessage = errorMessage ?? m.errorMessage ?? QUICK_COMPOSE_ORPHAN_TASK_ERROR;
      }
    }
    const messageWithTaskAssets: QuickComposeThreadMessage = taskAssetById
      ? { ...m, taskAssetById }
      : m;
    const resultText =
      status === 'done'
        ? resolveAssistantResultText(messageWithTaskAssets, args.resolveAssetById)
        : m.resultText;
    const nextError = status === 'error' ? errorMessage : undefined;
    const nextResult = resultText?.trim() || undefined;
    const nextTaskAssetById =
      taskAssetById && Object.keys(taskAssetById).length ? taskAssetById : undefined;
    const prevTaskAssetById =
      m.taskAssetById && Object.keys(m.taskAssetById).length ? m.taskAssetById : undefined;
    const taskAssetUnchanged =
      JSON.stringify(prevTaskAssetById ?? null) === JSON.stringify(nextTaskAssetById ?? null);
    if (
      m.status === status &&
      m.errorMessage === nextError &&
      (m.resultText || undefined) === nextResult &&
      taskAssetUnchanged
    ) {
      return m;
    }
    changed = true;
    const patched: QuickComposeThreadMessage = {
      ...m,
      status,
    };
    if (nextError) patched.errorMessage = nextError;
    else delete patched.errorMessage;
    if (nextResult) patched.resultText = nextResult;
    if (nextTaskAssetById) patched.taskAssetById = nextTaskAssetById;
    else delete patched.taskAssetById;
    return patched;
  });
  return changed ? next : thread.messages;
}
