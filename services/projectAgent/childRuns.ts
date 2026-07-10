/**
 * Phase 5 / U4 · 5A — agents-as-tools 子 run 进度卡（纯函数）。
 * 从计划生成瘦快照；按 task 队列推进 status。禁止媒体字节。
 */

import type {
  AgentChildRun,
  AgentChildRunStatus,
  AgentPlannedTool,
} from '../../types/projectAgent';
import type { QuickComposeMessageStatus } from '../../types/quickComposeThread';
import type { CustomAppModule, WorkflowAsset, WorkflowPendingTask } from '../../types';
import {
  QUICK_COMPOSE_CANCELLED_MESSAGE,
  resolveQuickComposeAssistantMessageStatus,
} from '../quickComposeTurnContext';

export type BuildChildRunsFromPlanOpts = {
  parentMessageId?: string;
  now?: number;
  /** executePlan 返回的扁平 taskIds；按步数对齐后写入各 child */
  taskIds?: string[];
  /** 显式逐步 taskIds（优先于扁平列表） */
  taskIdsByStep?: (string[] | undefined)[];
  idFactory?: (index: number, step: AgentPlannedTool) => string;
};

export type PatchChildRunsContext = {
  pending: WorkflowPendingTask[];
  executingQueue: { tasks: WorkflowPendingTask[] } | null;
  activeTaskIds: ReadonlySet<string>;
  completedTaskIds: ReadonlySet<string>;
  assetErrors: ReadonlyMap<string, string>;
  cancelledTaskIds: ReadonlySet<string>;
  resolveModule: (actionType: string) => CustomAppModule | null;
  taskAssetById?: Readonly<Record<string, string>>;
  resolveAssetById?: (assetId: string) => WorkflowAsset | null | undefined;
  assetCatalogEmpty?: boolean;
  /** 子卡无 taskIds 时（如同步 invoke_expert）用消息级 status 近似 */
  messageStatus?: QuickComposeMessageStatus;
  messageErrorMessage?: string;
  now?: number;
};

function defaultChildId(index: number, step: AgentPlannedTool): string {
  const tool = step.toolId || 'tool';
  const expert = String(step.args?.expertId ?? '').trim();
  return expert ? `child-${index}-${tool}-${expert}` : `child-${index}-${tool}`;
}

function taskIdsForStep(
  index: number,
  planLen: number,
  opts: BuildChildRunsFromPlanOpts
): string[] | undefined {
  const byStep = opts.taskIdsByStep?.[index];
  if (byStep?.length) return byStep.map((id) => String(id).trim()).filter(Boolean);

  const flat = (opts.taskIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (!flat.length) return undefined;
  if (planLen === 1) return flat;
  if (flat.length === planLen) return [flat[index]!];
  if (flat.length > planLen) {
    // 按步均分：前 rem 步多拿 1 个，避免孤儿 task 导致卡显示 done 但任务仍在跑
    const base = Math.floor(flat.length / planLen);
    const rem = flat.length % planLen;
    let start = 0;
    for (let i = 0; i < index; i++) {
      start += base + (i < rem ? 1 : 0);
    }
    const count = base + (index < rem ? 1 : 0);
    return flat.slice(start, start + count);
  }
  // flat.length < planLen：有则一步一 id，其余步无
  if (index < flat.length) return [flat[index]!];
  return undefined;
}

/**
 * 从计划步骤生成初始子 run 列表（一律 queued；无媒体字段）。
 * invoke_expert → kind expert；其余 → tool。
 */
export function buildChildRunsFromPlan(
  plan: AgentPlannedTool[],
  opts: BuildChildRunsFromPlanOpts = {}
): AgentChildRun[] {
  if (!plan.length) return [];
  const now = opts.now ?? Date.now();
  const idFactory = opts.idFactory ?? defaultChildId;
  const parentMessageId = opts.parentMessageId?.trim() || undefined;

  return plan.map((step, index) => {
    const isExpert = step.toolId === 'invoke_expert';
    const expertId = isExpert ? String(step.args?.expertId ?? '').trim() || undefined : undefined;
    const label = String(step.label || '').trim() || step.toolId;
    const taskIds = taskIdsForStep(index, plan.length, opts);
    const run: AgentChildRun = {
      id: idFactory(index, step),
      kind: isExpert ? 'expert' : 'tool',
      label,
      toolId: step.toolId,
      status: 'queued',
      startedAt: now,
    };
    if (parentMessageId) run.parentMessageId = parentMessageId;
    if (expertId) run.expertId = expertId;
    if (taskIds?.length) run.taskIds = taskIds;
    return run;
  });
}

function qcStatusToChildStatus(
  status: QuickComposeMessageStatus,
  errorMessage?: string
): AgentChildRunStatus {
  if (status === 'done') return 'done';
  if (status === 'error') {
    if ((errorMessage || '').trim() === QUICK_COMPOSE_CANCELLED_MESSAGE) return 'cancelled';
    return 'error';
  }
  if (status === 'understanding' || status === 'running') return 'running';
  return 'queued';
}

/** 无逐步 taskIds 时：用整 turn 消息 status 近似（对齐时间线多工具观感）。 */
function approximateFromMessageStatus(
  status: QuickComposeMessageStatus | undefined,
  errorMessage: string | undefined,
  index: number
): AgentChildRunStatus {
  if (!status || status === 'submitted') return 'queued';
  if (status === 'done') return 'done';
  if (status === 'error') {
    // error / 已取消：全部同态，避免前卡乐观标 done
    if ((errorMessage || '').trim() === QUICK_COMPOSE_CANCELLED_MESSAGE) return 'cancelled';
    return 'error';
  }
  if (status === 'queued') return 'queued';
  // understanding | running：首个 running，其余 queued
  return index === 0 ? 'running' : 'queued';
}

function pickChildErrorMessage(
  taskIds: string[],
  ctx: PatchChildRunsContext
): string | undefined {
  for (const taskId of taskIds) {
    const task =
      ctx.pending.find((t) => t.id === taskId) ??
      ctx.executingQueue?.tasks.find((t) => t.id === taskId) ??
      null;
    if (task) {
      const err = ctx.assetErrors.get(task.assetId);
      if (err) return err;
    }
    const hinted = ctx.taskAssetById?.[taskId]?.trim();
    if (hinted) {
      const err = ctx.assetErrors.get(hinted);
      if (err) return err;
    }
  }
  return undefined;
}

function isTerminalChildStatus(status: AgentChildRunStatus): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

/**
 * 按 task 队列推进子 run status（复用 resolveQuickComposeAssistantMessageStatus）。
 * 无 taskIds 的子卡回退到 messageStatus。返回原引用表示无变化。
 */
export function patchChildRunsFromTasks(
  childRuns: AgentChildRun[],
  ctx: PatchChildRunsContext
): AgentChildRun[] {
  if (!childRuns.length) return childRuns;
  const now = ctx.now ?? Date.now();
  let changed = false;

  const next = childRuns.map((run, index) => {
    // 取消粘性：已标 cancelled 不回退
    if (run.status === 'cancelled') return run;

    let nextStatus: AgentChildRunStatus;
    let errorMessage: string | undefined;

    if (run.taskIds?.length) {
      const allCancelled = run.taskIds.every((id) => ctx.cancelledTaskIds.has(id));
      if (allCancelled) {
        nextStatus = 'cancelled';
        errorMessage = QUICK_COMPOSE_CANCELLED_MESSAGE;
      } else {
        const qcStatus = resolveQuickComposeAssistantMessageStatus({
          taskIds: run.taskIds,
          taskAssetById: ctx.taskAssetById,
          pending: ctx.pending,
          executingQueue: ctx.executingQueue,
          activeTaskIds: ctx.activeTaskIds,
          completedTaskIds: ctx.completedTaskIds,
          assetErrors: ctx.assetErrors,
          cancelledTaskIds: ctx.cancelledTaskIds,
          resolveModule: ctx.resolveModule,
          resolveAssetById: ctx.resolveAssetById,
          assetCatalogEmpty: ctx.assetCatalogEmpty,
        });
        nextStatus = qcStatusToChildStatus(qcStatus, undefined);
        if (nextStatus === 'error') {
          const anyCancelled = run.taskIds.some((id) => ctx.cancelledTaskIds.has(id));
          if (anyCancelled) {
            nextStatus = 'cancelled';
            errorMessage = QUICK_COMPOSE_CANCELLED_MESSAGE;
          } else {
            errorMessage =
              pickChildErrorMessage(run.taskIds, ctx) ||
              run.errorMessage ||
              ctx.messageErrorMessage;
          }
        }
      }
    } else {
      nextStatus = approximateFromMessageStatus(
        ctx.messageStatus,
        ctx.messageErrorMessage,
        index
      );
      if (nextStatus === 'cancelled' || nextStatus === 'error') {
        errorMessage = ctx.messageErrorMessage || run.errorMessage;
      }
    }

    const endedAt = isTerminalChildStatus(nextStatus)
      ? run.endedAt ?? now
      : undefined;

    const sameError =
      (run.errorMessage || undefined) === (errorMessage || undefined);
    if (run.status === nextStatus && sameError && run.endedAt === endedAt) {
      return run;
    }

    changed = true;
    const patched: AgentChildRun = {
      ...run,
      status: nextStatus,
    };
    if (errorMessage) patched.errorMessage = errorMessage;
    else delete patched.errorMessage;
    if (endedAt != null) patched.endedAt = endedAt;
    else delete patched.endedAt;
    return patched;
  });

  return changed ? next : childRuns;
}
