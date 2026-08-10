/**
 * ProjectAgentRuntime.submitTurn — Phase 2 (P0c) + Phase 3A cancel/idempotency.
 * Plans via planTools, formats template, executes via HostPort.executePlan.
 * After planTools: optional B-layer assemble (getThread) for text/expert paths (§16.8).
 */

import type {
  ProjectAgentHostPort,
  ProjectAgentIntent,
  ProjectAgentSubmitTurnInput,
  ProjectAgentSubmitTurnResult,
} from '../../types/projectAgent';
import { planTools } from './planTools';
import { formatPlanTemplate } from './planTemplate';
import {
  assembleProjectAgentContext,
  injectAssembledContextIntoUserText,
  planNeedsConversationContext,
} from './contextAssembly';
import type { ProjectAgentThread } from './threadStore';
import {
  applyPlanToTrace,
  applyPlannerTrace,
  createEmptyTurnTrace,
  finalizeTurnTrace,
  serializeTurnTrace,
  traceStatusFromTurn,
} from './runtime/trace';
import {
  canSubmitNewTurn,
  createInitialTurnState,
  isCancelledTurn,
  transitionTurn,
  type TurnStateMachine,
} from './runtime/turnState';

/** Best-effort: prefix intent.text with assembled recent/compaction for text+expert plans. */
function maybeInjectAssembledContext(
  host: ProjectAgentHostPort,
  intent: ProjectAgentIntent,
  plan: ReadonlyArray<{ toolId: string }>,
  workspaceProjectId: string
): ProjectAgentIntent {
  if (!planNeedsConversationContext(plan) || !host.getThread) return intent;
  try {
    const thread = host.getThread();
    if (!thread) return intent;
    const key =
      host.getThreadStoreKey?.() ??
      ({
        userId: null,
        workspaceProjectId: String(workspaceProjectId || thread.workspaceProjectId || '').trim(),
      } as const);
    if (!String(key.workspaceProjectId || '').trim()) return intent;
    const assembled = assembleProjectAgentContext({
      key,
      thread: thread as ProjectAgentThread,
      intent,
    });
    const nextText = injectAssembledContextIntoUserText(intent.text, assembled);
    if (nextText === String(intent.text ?? '').trim()) return intent;
    return { ...intent, text: nextText };
  } catch {
    return intent;
  }
}

export const PROJECT_AGENT_CANCELLED_MESSAGE = '已取消';
export const PROJECT_AGENT_TURN_IN_FLIGHT_MESSAGE = 'Turn already in flight';
export const PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE = 'Duplicate turnId';

export type ProjectAgentRuntime = {
  getTurnState: () => TurnStateMachine;
  /** Reject if a turn is in-flight (A11). */
  submitTurn: (input: ProjectAgentSubmitTurnInput) => Promise<ProjectAgentSubmitTurnResult>;
  /**
   * §16.1：planning|executing → error(cancelled)；并对已入队 taskIds 调 Host.cancelTasks。
   * 若 turn 已终态，仍可对 lastTaskIds 调 cancelTasks（媒体仍在跑时的 UI 取消）。
   */
  cancelInFlight: (opts?: { taskIds?: string[] }) => { cancelledTaskIds: string[] };
  /** Last enqueued task ids for the active/last turn (for UI cancel). */
  getLastTaskIds: () => string[];
};

export function createProjectAgentRuntime(host: ProjectAgentHostPort): ProjectAgentRuntime {
  let turnState = createInitialTurnState();
  const seenTurnIds = new Set<string>();
  let lastTaskIds: string[] = [];
  /** Set while submitTurn awaits executePlan; cancelInFlight flips this. */
  let cancelRequested = false;

  const cancelHostTasks = (taskIds: string[]): string[] => {
    const ids = taskIds.map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) return [];
    host.cancelTasks?.(ids);
    return ids;
  };

  return {
    getTurnState: () => turnState,
    getLastTaskIds: () => [...lastTaskIds],
    cancelInFlight: (opts) => {
      cancelRequested = true;
      const fromOpts = opts?.taskIds?.map((id) => id.trim()).filter(Boolean) ?? [];
      const ids = fromOpts.length > 0 ? fromOpts : [...lastTaskIds];
      if (turnState.status === 'planning' || turnState.status === 'executing') {
        turnState = transitionTurn(turnState, { type: 'cancel' });
      }
      const cancelledTaskIds = cancelHostTasks(ids);
      return { cancelledTaskIds };
    },
    async submitTurn(input: ProjectAgentSubmitTurnInput): Promise<ProjectAgentSubmitTurnResult> {
      if (!canSubmitNewTurn(turnState.status)) {
        const trace = createEmptyTurnTrace({
          turnId: input.turnId,
          threadId: input.threadId,
          workspaceProjectId: input.workspaceProjectId,
          intent: input.intent,
        });
        return {
          ok: false,
          turnId: input.turnId,
          plan: [],
          planText: '',
          taskIds: [],
          errorMessage: PROJECT_AGENT_TURN_IN_FLIGHT_MESSAGE,
          trace: finalizeTurnTrace(trace, 'error', PROJECT_AGENT_TURN_IN_FLIGHT_MESSAGE),
        };
      }
      if (seenTurnIds.has(input.turnId)) {
        const trace = createEmptyTurnTrace({
          turnId: input.turnId,
          threadId: input.threadId,
          workspaceProjectId: input.workspaceProjectId,
          intent: input.intent,
        });
        return {
          ok: false,
          turnId: input.turnId,
          plan: [],
          planText: '',
          taskIds: [],
          errorMessage: PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE,
          trace: finalizeTurnTrace(trace, 'error', PROJECT_AGENT_DUPLICATE_TURN_ID_MESSAGE),
        };
      }
      seenTurnIds.add(input.turnId);
      if (seenTurnIds.size > 200) {
        const first = seenTurnIds.values().next().value;
        if (first) seenTurnIds.delete(first);
      }

      cancelRequested = false;
      lastTaskIds = [];
      turnState = transitionTurn(turnState, { type: 'submit', turnId: input.turnId });
      let trace = createEmptyTurnTrace({
        turnId: input.turnId,
        threadId: input.threadId,
        workspaceProjectId: input.workspaceProjectId,
        intent: input.intent,
      });

      const planned = planTools(input.intent, { controlledPlanner: host.controlledPlanner });
      trace = applyPlannerTrace(trace, planned.planner?.decisionTrace);
      if (planned.ok === false) {
        turnState = transitionTurn(turnState, {
          type: 'plan_fail',
          errorMessage: planned.errorMessage,
        });
        trace = finalizeTurnTrace(trace, 'error', planned.errorMessage);
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[projectAgent] turn', serializeTurnTrace(trace));
        }
        return {
          ok: false,
          turnId: input.turnId,
          plan: [],
          planText: '',
          taskIds: [],
          errorMessage: planned.errorMessage,
          trace,
        };
      }

      if (cancelRequested || isCancelledTurn(turnState)) {
        turnState = transitionTurn(turnState, { type: 'cancel' });
        trace = finalizeTurnTrace(trace, 'cancelled', PROJECT_AGENT_CANCELLED_MESSAGE);
        return {
          ok: false,
          turnId: input.turnId,
          plan: planned.plan,
          planText: formatPlanTemplate(planned.plan, input.intent.perception),
          taskIds: [],
          errorMessage: PROJECT_AGENT_CANCELLED_MESSAGE,
          trace,
        };
      }

      const planText = formatPlanTemplate(planned.plan, input.intent.perception);
      trace = applyPlanToTrace(trace, planned.plan);
      turnState = transitionTurn(turnState, { type: 'plan_ok' });
      trace = finalizeTurnTrace(trace, 'executing');

      if (!host.executePlan) {
        const msg = 'HostPort.executePlan is not implemented';
        turnState = transitionTurn(turnState, { type: 'exec_fail', errorMessage: msg });
        trace = finalizeTurnTrace(trace, 'error', msg);
        return {
          ok: false,
          turnId: input.turnId,
          plan: planned.plan,
          planText,
          taskIds: [],
          errorMessage: msg,
          trace,
        };
      }

      const execIntent = maybeInjectAssembledContext(
        host,
        input.intent,
        planned.plan,
        input.workspaceProjectId
      );

      try {
        const exec = await host.executePlan(execIntent, planned.plan);
        lastTaskIds = [...(exec.taskIds ?? [])];

        if (cancelRequested || isCancelledTurn(turnState)) {
          cancelHostTasks(lastTaskIds);
          turnState = transitionTurn(turnState, { type: 'cancel' });
          trace = finalizeTurnTrace(trace, 'cancelled', PROJECT_AGENT_CANCELLED_MESSAGE);
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[projectAgent] turn', serializeTurnTrace(trace));
          }
          return {
            ok: false,
            turnId: input.turnId,
            plan: planned.plan,
            planText,
            taskIds: lastTaskIds,
            taskAssetById: exec.taskAssetById,
            errorMessage: PROJECT_AGENT_CANCELLED_MESSAGE,
            trace,
          };
        }

        const failed =
          Boolean(exec.errorMessage) ||
          (exec.taskIds.length === 0 && !String(exec.resultText || '').trim());
        if (failed) {
          const err = exec.errorMessage?.trim() || '未能创建任务';
          turnState = transitionTurn(turnState, { type: 'exec_fail', errorMessage: err });
          trace = finalizeTurnTrace(trace, 'error', err);
          if (typeof console !== 'undefined' && console.debug) {
            console.debug('[projectAgent] turn', serializeTurnTrace(trace));
          }
          return {
            ok: false,
            turnId: input.turnId,
            plan: planned.plan,
            planText,
            taskIds: exec.taskIds,
            taskAssetById: exec.taskAssetById,
            errorMessage: err,
            ...(exec.resultText?.trim() ? { resultText: exec.resultText.trim() } : {}),
            ...(exec.artifactIds?.length ? { artifactIds: exec.artifactIds } : {}),
            trace,
          };
        }
        turnState = transitionTurn(turnState, { type: 'exec_done' });
        trace = finalizeTurnTrace(trace, 'done');
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[projectAgent] turn', serializeTurnTrace(trace));
        }
        return {
          ok: true,
          turnId: input.turnId,
          plan: planned.plan,
          planText,
          taskIds: exec.taskIds,
          taskAssetById: exec.taskAssetById,
          ...(exec.resultText?.trim() ? { resultText: exec.resultText.trim() } : {}),
          ...(exec.artifactIds?.length ? { artifactIds: exec.artifactIds } : {}),
          trace,
        };
      } catch (e) {
        if (cancelRequested || isCancelledTurn(turnState)) {
          cancelHostTasks(lastTaskIds);
          turnState = transitionTurn(turnState, { type: 'cancel' });
          trace = finalizeTurnTrace(trace, 'cancelled', PROJECT_AGENT_CANCELLED_MESSAGE);
          return {
            ok: false,
            turnId: input.turnId,
            plan: planned.plan,
            planText,
            taskIds: lastTaskIds,
            errorMessage: PROJECT_AGENT_CANCELLED_MESSAGE,
            trace,
          };
        }
        const err = e instanceof Error ? e.message : String(e);
        turnState = transitionTurn(turnState, { type: 'exec_fail', errorMessage: err });
        trace = finalizeTurnTrace(trace, 'error', err);
        return {
          ok: false,
          turnId: input.turnId,
          plan: planned.plan,
          planText,
          taskIds: [],
          errorMessage: err,
          trace,
        };
      }
    },
  };
}

export { formatPlanTemplate } from './planTemplate';
export { canSubmitNewTurn, createInitialTurnState, isCancelledTurn, transitionTurn };
export { traceStatusFromTurn };
