/**
 * ProjectAgentRuntime.submitTurn — Phase 2 (P0c).
 * Plans via planTools, formats template, executes via HostPort.executePlan.
 */

import type {
  ProjectAgentHostPort,
  ProjectAgentSubmitTurnInput,
  ProjectAgentSubmitTurnResult,
} from '../../types/projectAgent';
import { planTools } from './planTools';
import { formatPlanTemplate } from './planTemplate';
import {
  applyPlanToTrace,
  createEmptyTurnTrace,
  finalizeTurnTrace,
  serializeTurnTrace,
  traceStatusFromTurn,
} from './runtime/trace';
import {
  canSubmitNewTurn,
  createInitialTurnState,
  transitionTurn,
  type TurnStateMachine,
} from './runtime/turnState';

export type ProjectAgentRuntime = {
  getTurnState: () => TurnStateMachine;
  /** Reject if a turn is in-flight (A11). */
  submitTurn: (input: ProjectAgentSubmitTurnInput) => Promise<ProjectAgentSubmitTurnResult>;
  cancelInFlight: () => void;
};

export function createProjectAgentRuntime(host: ProjectAgentHostPort): ProjectAgentRuntime {
  let turnState = createInitialTurnState();
  const seenTurnIds = new Set<string>();

  return {
    getTurnState: () => turnState,
    cancelInFlight: () => {
      turnState = transitionTurn(turnState, { type: 'cancel' });
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
          errorMessage: 'Turn already in flight',
          trace: finalizeTurnTrace(trace, 'error', 'Turn already in flight'),
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
          errorMessage: 'Duplicate turnId',
          trace: finalizeTurnTrace(trace, 'error', 'Duplicate turnId'),
        };
      }
      seenTurnIds.add(input.turnId);
      if (seenTurnIds.size > 200) {
        const first = seenTurnIds.values().next().value;
        if (first) seenTurnIds.delete(first);
      }

      turnState = transitionTurn(turnState, { type: 'submit', turnId: input.turnId });
      let trace = createEmptyTurnTrace({
        turnId: input.turnId,
        threadId: input.threadId,
        workspaceProjectId: input.workspaceProjectId,
        intent: input.intent,
      });

      const planned = planTools(input.intent);
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

      const planText = formatPlanTemplate(planned.plan);
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

      try {
        const exec = await host.executePlan(input.intent, planned.plan);
        const failed = Boolean(exec.errorMessage) || exec.taskIds.length === 0;
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
          trace,
        };
      } catch (e) {
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
export { canSubmitNewTurn, createInitialTurnState, transitionTurn };
export { traceStatusFromTurn };
