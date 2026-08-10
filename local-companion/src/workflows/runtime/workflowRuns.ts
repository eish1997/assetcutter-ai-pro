import type {
  WorkflowRepairAction,
  WorkflowSkill,
} from './workflowSkills.js';

export type WorkflowRunStatus =
  | 'created'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'preflight_failed'
  | 'failed'
  | 'canceled';

export type WorkflowStepRunStatus = 'created' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type WorkflowPreflightStatus = 'passed' | 'warning' | 'failed';

export type WorkflowRunInput = {
  file_name: string;
  output_dir: string;
  overwrite: boolean;
};

export type WorkflowNormalizedInput = WorkflowRunInput & {
  output_path: string;
};

export type WorkflowPreflightResult = {
  check_id: string;
  message: string;
  repair_action_id?: string;
  status: WorkflowPreflightStatus;
};

export type WorkflowRunError = {
  code: string;
  message: string;
  recoverable: boolean;
};

export type WorkflowStepRun = {
  error?: WorkflowRunError;
  id: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: WorkflowStepRunStatus;
  step_id: string;
  tool_call_id?: string;
};

export type WorkflowArtifact = {
  id: string;
  local_path?: string;
  metadata: Record<string, unknown>;
  provenance: {
    run_id: string;
    step_run_id?: string;
    tool_call_id?: string;
    trace_id: string;
    workflow_id: string;
  };
  run_id: string;
  status: 'created' | 'missing' | 'rejected';
  type: 'fbx' | 'report' | 'preview' | 'other';
  uri: string;
  workflow_id: string;
};

export type WorkflowReplaySnapshot = {
  created_at: string;
  dependency_summary: Record<string, unknown>;
  id: string;
  normalized_input: WorkflowNormalizedInput;
  run_id: string;
  workflow_id: string;
  workflow_version: string;
};

export type WorkflowRunRepairAction = WorkflowRepairAction & {
  code: string;
  created_at: string;
};

export type WorkflowRun = {
  artifact_ids: string[];
  artifacts: WorkflowArtifact[];
  created_at: string;
  error?: WorkflowRunError;
  finished_at?: string;
  id: string;
  input: WorkflowRunInput;
  normalized_input: WorkflowNormalizedInput;
  output?: Record<string, unknown>;
  preflight_results: WorkflowPreflightResult[];
  repair_action_ids: string[];
  repair_actions: WorkflowRunRepairAction[];
  replay_snapshot?: WorkflowReplaySnapshot;
  replay_snapshot_id?: string;
  reused_from_run_id?: string;
  started_at?: string;
  status: WorkflowRunStatus;
  step_runs: WorkflowStepRun[];
  trace_id: string;
  workflow_id: string;
  workflow_version: string;
};

export function createWorkflowRun(input: {
  id?: string;
  input: WorkflowRunInput;
  now?: string;
  traceId?: string;
  workflow: WorkflowSkill;
}): WorkflowRun {
  const now = input.now ?? new Date().toISOString();
  const runId = input.id ?? `run_${input.workflow.id.replaceAll('.', '_')}_${Date.now()}`;
  const traceId = input.traceId ?? `trace_${runId}`;
  const normalizedInput = normalizeWorkflowInput(input.input);

  return {
    artifact_ids: [],
    artifacts: [],
    created_at: now,
    id: runId,
    input: input.input,
    normalized_input: normalizedInput,
    preflight_results: [],
    repair_action_ids: [],
    repair_actions: [],
    status: 'created',
    step_runs: input.workflow.aiContract.steps.map((step) => ({
      id: `${runId}:${step.id}`,
      input: {},
      status: 'created',
      step_id: step.id,
    })),
    trace_id: traceId,
    workflow_id: input.workflow.id,
    workflow_version: input.workflow.version,
  };
}

export function applyWorkflowPreflightResults(input: {
  now?: string;
  results: WorkflowPreflightResult[];
  run: WorkflowRun;
  workflow: WorkflowSkill;
}): WorkflowRun {
  const failedResults = input.results.filter((result) => result.status === 'failed');
  if (failedResults.length === 0) {
    return {
      ...input.run,
      preflight_results: input.results,
      status: 'ready',
    };
  }

  const repairActions = collectRepairActions({
    codes: failedResults.map((result) => result.repair_action_id ?? result.check_id),
    now: input.now,
    workflow: input.workflow,
  });

  return {
    ...input.run,
    finished_at: input.now ?? new Date().toISOString(),
    preflight_results: input.results,
    repair_action_ids: repairActions.map((action) => action.id),
    repair_actions: repairActions,
    status: 'preflight_failed',
  };
}

export function startWorkflowRun(input: {
  now?: string;
  run: WorkflowRun;
  stepInput?: Record<string, unknown>;
}): WorkflowRun {
  const firstStepRun = input.run.step_runs[0];
  return {
    ...input.run,
    started_at: input.now ?? new Date().toISOString(),
    status: 'running',
    step_runs: firstStepRun
      ? input.run.step_runs.map((stepRun, index) => index === 0
        ? {
            ...stepRun,
            input: input.stepInput ?? {
              output_path: input.run.normalized_input.output_path,
              overwrite: input.run.normalized_input.overwrite,
            },
            status: 'running',
          }
        : stepRun)
      : input.run.step_runs,
  };
}

export function completeWorkflowRun(input: {
  artifact: Omit<WorkflowArtifact, 'id' | 'provenance' | 'run_id' | 'workflow_id'> & { id?: string };
  now?: string;
  output?: Record<string, unknown>;
  run: WorkflowRun;
  stepOutput?: Record<string, unknown>;
  toolCallId?: string;
}): WorkflowRun {
  const now = input.now ?? new Date().toISOString();
  const firstStepRun = input.run.step_runs[0];
  const artifactId = input.artifact.id ?? `artifact_${input.run.id}`;
  const artifact: WorkflowArtifact = {
    ...input.artifact,
    id: artifactId,
    provenance: {
      run_id: input.run.id,
      step_run_id: firstStepRun?.id,
      tool_call_id: input.toolCallId,
      trace_id: input.run.trace_id,
      workflow_id: input.run.workflow_id,
    },
    run_id: input.run.id,
    workflow_id: input.run.workflow_id,
  };
  const replaySnapshot = createReplaySnapshot({
    now,
    run: input.run,
  });

  return {
    ...input.run,
    artifact_ids: [artifact.id],
    artifacts: [artifact],
    finished_at: now,
    output: input.output ?? {
      artifact_id: artifact.id,
      fbx_path: artifact.uri,
      replay_snapshot_id: replaySnapshot.id,
      run_id: input.run.id,
      trace_id: input.run.trace_id,
    },
    replay_snapshot: replaySnapshot,
    replay_snapshot_id: replaySnapshot.id,
    status: 'succeeded',
    step_runs: firstStepRun
      ? input.run.step_runs.map((stepRun, index) => index === 0
        ? {
            ...stepRun,
            output: input.stepOutput ?? input.output,
            status: 'succeeded',
            tool_call_id: input.toolCallId,
          }
        : stepRun)
      : input.run.step_runs,
  };
}

export function failWorkflowRun(input: {
  code: string;
  message: string;
  now?: string;
  recoverable?: boolean;
  run: WorkflowRun;
  toolCallId?: string;
  workflow: WorkflowSkill;
}): WorkflowRun {
  const now = input.now ?? new Date().toISOString();
  const error = {
    code: input.code,
    message: input.message,
    recoverable: input.recoverable ?? true,
  };
  const repairActions = collectRepairActions({
    codes: [input.code],
    now,
    workflow: input.workflow,
  });

  return {
    ...input.run,
    error,
    finished_at: now,
    repair_action_ids: repairActions.map((action) => action.id),
    repair_actions: repairActions,
    status: 'failed',
    step_runs: input.run.step_runs.map((stepRun, index) => index === 0
      ? {
          ...stepRun,
          error,
          status: 'failed',
          tool_call_id: input.toolCallId,
        }
      : stepRun),
  };
}

export function normalizeWorkflowInput(input: WorkflowRunInput): WorkflowNormalizedInput {
  const outputDir = input.output_dir.trim().replace(/[\\/]+$/, '');
  const trimmedFileName = input.file_name.trim();
  const fileName = trimmedFileName.toLowerCase().endsWith('.fbx') ? trimmedFileName : `${trimmedFileName}.fbx`;
  return {
    ...input,
    file_name: fileName,
    output_dir: outputDir,
    output_path: `${outputDir}/${fileName}`,
  };
}

function createReplaySnapshot(input: {
  now: string;
  run: WorkflowRun;
}): WorkflowReplaySnapshot {
  return {
    created_at: input.now,
    dependency_summary: {
      preflight_check_ids: input.run.preflight_results.map((result) => result.check_id),
      step_ids: input.run.step_runs.map((stepRun) => stepRun.step_id),
    },
    id: `replay_${input.run.id}`,
    normalized_input: input.run.normalized_input,
    run_id: input.run.id,
    workflow_id: input.run.workflow_id,
    workflow_version: input.run.workflow_version,
  };
}

function collectRepairActions(input: {
  codes: string[];
  now?: string;
  workflow: WorkflowSkill;
}): WorkflowRunRepairAction[] {
  const now = input.now ?? new Date().toISOString();
  const actionIds = new Set(
    input.codes
      .map((code) => input.workflow.aiContract.failureModes.find((mode) => mode.code === code)?.repairActionId ?? code)
      .filter(Boolean),
  );

  return input.workflow.aiContract.repairActions
    .filter((action) => actionIds.has(action.id))
    .map((action) => ({
      ...action,
      code: input.workflow.aiContract.failureModes.find((mode) => mode.repairActionId === action.id)?.code ?? action.id,
      created_at: now,
    }));
}
