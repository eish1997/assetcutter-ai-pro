import { listWorkflowRuns } from './runtime/workflowRunHistory.js';
import type { WorkflowRepairScope, WorkflowRepairSession } from './workflowObjects.js';
import { loadWorkflowObjectStore, upsertWorkflowRepairSession } from './workflowObjectStore.js';

export type WorkflowRepairSessionResult =
  | { ok: true; repairSession: WorkflowRepairSession }
  | { ok: false; error: string; message: string };

export function listWorkflowRepairSessions(storePath?: string) {
  return loadWorkflowObjectStore(storePath).repair_sessions;
}

export function getWorkflowRepairSession(sessionId: string, storePath?: string): WorkflowRepairSessionResult {
  const repairSession = listWorkflowRepairSessions(storePath).find((item) => item.id === sessionId);
  if (!repairSession) {
    return {
      ok: false,
      error: 'workflow_repair_session_not_found',
      message: `WorkflowRepairSession not found: ${sessionId}`,
    };
  }
  return { ok: true, repairSession };
}

export function createWorkflowRepairSession(input: {
  historyPath?: string;
  now?: string;
  runId: string;
  sessionId?: string;
  storePath?: string;
}): WorkflowRepairSessionResult {
  const run = listWorkflowRuns(input.historyPath).find((item) => item.id === input.runId);
  if (!run) {
    return {
      ok: false,
      error: 'workflow_run_not_found',
      message: `WorkflowRun not found: ${input.runId}`,
    };
  }
  if (run.status !== 'failed' && run.status !== 'preflight_failed') {
    return {
      ok: false,
      error: 'workflow_run_not_failed',
      message: `Only failed WorkflowRun can create repair session: ${input.runId}`,
    };
  }
  const now = input.now ?? new Date().toISOString();
  const repairSession: WorkflowRepairSession = {
    created_at: now,
    failure: {
      code: run.error?.code,
      message: run.error?.message,
      run_id: run.id,
      status: run.status,
      workflow_id: run.workflow_id,
      workflow_version_id: run.workflow_version_id,
    },
    id: input.sessionId ?? `repair_${run.id}`,
    repair_action_ids: run.repair_action_ids,
    repair_actions: run.repair_actions,
    requires_preflight: true,
    scope_options: ['run_only', 'update_draft', 'new_version', 'rollback_default_version'],
    status: 'preflight_required',
    updated_at: now,
  };
  upsertWorkflowRepairSession(repairSession, input.storePath);
  return { ok: true, repairSession };
}

export function selectWorkflowRepairScope(input: {
  now?: string;
  scope: WorkflowRepairScope;
  sessionId: string;
  storePath?: string;
}): WorkflowRepairSessionResult {
  const current = getWorkflowRepairSession(input.sessionId, input.storePath);
  if (!current.ok) return current;
  const repairSession: WorkflowRepairSession = {
    ...current.repairSession,
    selected_scope: input.scope,
    status: 'preflight_required',
    updated_at: input.now ?? new Date().toISOString(),
  };
  upsertWorkflowRepairSession(repairSession, input.storePath);
  return { ok: true, repairSession };
}
