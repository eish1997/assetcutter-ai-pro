import type {
  AgentTurnTrace,
  AgentPlannerDecisionTraceItem,
  ProjectAgentIntent,
  AgentPlannedTool,
  AgentTurnStatus,
} from '../../../types/projectAgent';

export function createEmptyTurnTrace(input: {
  turnId: string;
  threadId: string;
  workspaceProjectId: string;
  intent: ProjectAgentIntent;
  startedAt?: number;
}): AgentTurnTrace {
  const { turnId, threadId, workspaceProjectId, intent } = input;
  return {
    turnId,
    threadId,
    workspaceProjectId,
    startedAt: input.startedAt ?? Date.now(),
    status: 'planning',
    intentSnapshot: {
      text: intent.text,
      mode: intent.mode,
      mentionIds: intent.mentions.map((m) => m.id),
      presetIds: [...intent.presetIds],
      surface: intent.surface,
    },
    plan: [],
    toolCalls: [],
  };
}

export function applyPlanToTrace(trace: AgentTurnTrace, plan: AgentPlannedTool[]): AgentTurnTrace {
  return {
    ...trace,
    plan: plan.map((p) => ({ toolId: p.toolId, label: p.label })),
    toolCalls: plan.map((p, i) => ({
      id: `${trace.turnId}-tc-${i}`,
      toolId: p.toolId,
      status: 'queued' as const,
    })),
  };
}

export function applyPlannerTrace(
  trace: AgentTurnTrace,
  plannerTrace: readonly AgentPlannerDecisionTraceItem[] | undefined
): AgentTurnTrace {
  if (!plannerTrace?.length) return trace;
  return {
    ...trace,
    plannerTrace: plannerTrace.map((item) => ({ ...item })),
  };
}

export function finalizeTurnTrace(
  trace: AgentTurnTrace,
  status: AgentTurnTrace['status'],
  errorMessage?: string
): AgentTurnTrace {
  const terminal = status === 'done' || status === 'error' || status === 'cancelled';
  return {
    ...trace,
    status,
    endedAt: terminal ? Date.now() : trace.endedAt,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/** Map turn-machine cancel (error+'cancelled') onto trace status cancelled for observability. */
export function traceStatusFromTurn(status: AgentTurnStatus, errorMessage?: string): AgentTurnTrace['status'] {
  if (status === 'error' && errorMessage === 'cancelled') return 'cancelled';
  if (status === 'idle') return 'planning';
  return status;
}

/** Debug / eval helper — must remain JSON-serializable (no media bytes). */
export function serializeTurnTrace(trace: AgentTurnTrace): string {
  return JSON.stringify(trace);
}
