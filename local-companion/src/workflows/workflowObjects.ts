import type { JsonSchema } from './runtime/jsonSchema.js';
import type { WorkflowArtifact, WorkflowRun } from './runtime/workflowRuns.js';
import type { WorkflowRepairAction, WorkflowSkill } from './runtime/workflowSkills.js';

export type WorkflowObjectLifecycle = 'draft' | 'validated' | 'deprecated' | 'archived';
export type WorkflowDraftStatus = 'draft' | 'ready_for_validation' | 'validated' | 'blocked' | 'archived';
export type WorkflowValidationStatus = 'unvalidated' | 'fixture_validated' | 'real_software_validated';
export type WorkflowVersionPolicy =
  | { kind: 'follow_default' }
  | { kind: 'locked'; version_id: string };
export type WorkflowPinScope =
  | { kind: 'home' }
  | { kind: 'project'; project_id: string }
  | { kind: 'connection'; connection_id: string }
  | { kind: 'object'; object_id: string }
  | { kind: 'workspace'; workspace_id: string };

export type WorkflowRepairScope = 'run_only' | 'update_draft' | 'new_version' | 'rollback_default_version';

export type WorkflowConnectorRequirement = {
  capability_package_id: string;
  id: string;
  kind: 'software_connection';
  title: string;
};

export type WorkflowExecutorRef = {
  id: string;
  kind: 'local_companion' | 'tool_bridge' | 'agent_plan';
};

export type WorkflowArtifactContract = {
  output_schema: JsonSchema;
  policy: Record<string, unknown>;
};

export type WorkflowValidationEvidence = {
  at: string;
  evidence: string;
  id: string;
  mode: 'fixture' | 'real_software' | 'real_maya' | 'real_maya_ui_selection';
  passed: boolean;
};

export type WorkflowDefinition = {
  created_at: string;
  current_version_id: string;
  description?: string;
  id: string;
  lifecycle: WorkflowObjectLifecycle;
  name: string;
  required_connectors: WorkflowConnectorRequirement[];
  tags: string[];
  updated_at: string;
};

export type WorkflowDefinitionDraft = {
  artifact_contract: WorkflowArtifactContract;
  default_input?: Record<string, unknown>;
  executor_ref: WorkflowExecutorRef;
  input_schema: JsonSchema;
  preflight_check_ids: string[];
  repair_action_ids: string[];
  replay_snapshot_id?: string;
  required_connectors: WorkflowConnectorRequirement[];
  source_artifact_ids?: string[];
};

export type WorkflowDraft = {
  created_at: string;
  definition: WorkflowDefinitionDraft;
  description?: string;
  id: string;
  latest_test_run_id?: string;
  name: string;
  source:
    | { kind: 'conversation'; message_id?: string }
    | { kind: 'run'; run_id: string }
    | { kind: 'workflow'; workflow_id: string; version_id?: string };
  status: WorkflowDraftStatus;
  updated_at: string;
};

export type WorkflowVersion = {
  artifact_contract: WorkflowArtifactContract;
  change_summary: string;
  created_at: string;
  executor_ref: WorkflowExecutorRef;
  id: string;
  input_schema: JsonSchema;
  semver: string;
  source_version_id?: string;
  validation: {
    evidence: WorkflowValidationEvidence[];
    status: WorkflowValidationStatus;
  };
  workflow_id: string;
};

export type WorkflowPin = {
  created_at: string;
  id: string;
  scope: WorkflowPinScope;
  sort_order: number;
  version_policy: WorkflowVersionPolicy;
  workflow_id: string;
};

export type WorkflowRepairSession = {
  created_at: string;
  failure: {
    code?: string;
    message?: string;
    run_id: string;
    status: WorkflowRun['status'];
    workflow_id: string;
    workflow_version_id?: string;
  };
  id: string;
  repair_action_ids: string[];
  repair_actions: WorkflowRepairAction[];
  requires_preflight: true;
  selected_scope?: WorkflowRepairScope;
  scope_options: WorkflowRepairScope[];
  status: 'open' | 'preflight_required' | 'resolved' | 'abandoned';
  updated_at: string;
};

export type WorkflowRunObject = {
  artifacts: WorkflowArtifact[];
  created_at: string;
  finished_at?: string;
  id: string;
  normalized_input: Record<string, unknown>;
  replay_snapshot_id?: string;
  status: WorkflowRun['status'];
  temporary: boolean;
  workflow_definition_id?: string;
  workflow_id: string;
  workflow_version: string;
  workflow_version_id?: string;
};

export function createWorkflowDefinitionFromSkill(input: {
  createdAt?: string;
  description?: string;
  lifecycle?: WorkflowObjectLifecycle;
  skill: WorkflowSkill;
  tags?: string[];
}): {
  definition: WorkflowDefinition;
  version: WorkflowVersion;
} {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const versionId = `${input.skill.id}@${input.skill.version}`;
  const evidence = input.skill.systemContract.validation.records.map((record) => ({
    at: input.skill.systemContract.validation.lastValidatedAt,
    evidence: record.evidence,
    id: record.id,
    mode: record.mode,
    passed: record.passed,
  }));
  const validationStatus = input.skill.systemContract.validation.status === 'validated'
    ? bestValidationStatus(evidence)
    : 'unvalidated';
  const artifactContract = {
    output_schema: input.skill.aiContract.outputSchema,
    policy: input.skill.systemContract.artifactPolicy,
  };
  const executorRef: WorkflowExecutorRef = {
    id: input.skill.id,
    kind: 'local_companion',
  };

  return {
    definition: {
      created_at: createdAt,
      current_version_id: versionId,
      description: input.description,
      id: input.skill.id,
      lifecycle: input.lifecycle ?? (input.skill.status === 'archived' ? 'archived' : 'validated'),
      name: input.skill.name,
      required_connectors: input.skill.systemContract.requiredConnectors.map(normalizeConnectorRequirement),
      tags: input.tags ?? [],
      updated_at: createdAt,
    },
    version: {
      artifact_contract: artifactContract,
      change_summary: `Imported from workflow skill ${input.skill.id} ${input.skill.version}.`,
      created_at: createdAt,
      executor_ref: executorRef,
      id: versionId,
      input_schema: input.skill.aiContract.inputSchema,
      semver: input.skill.version,
      validation: {
        evidence,
        status: validationStatus,
      },
      workflow_id: input.skill.id,
    },
  };
}

export function createWorkflowDraftFromSkill(input: {
  createdAt?: string;
  defaultInput?: Record<string, unknown>;
  id: string;
  latestTestRunId?: string;
  name?: string;
  replaySnapshotId?: string;
  skill: WorkflowSkill;
  source: WorkflowDraft['source'];
  sourceArtifactIds?: string[];
  status?: WorkflowDraftStatus;
}): WorkflowDraft {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    created_at: createdAt,
    definition: {
      artifact_contract: {
        output_schema: input.skill.aiContract.outputSchema,
        policy: input.skill.systemContract.artifactPolicy,
      },
      default_input: input.defaultInput,
      executor_ref: {
        id: input.skill.id,
        kind: 'local_companion',
      },
      input_schema: input.skill.aiContract.inputSchema,
      preflight_check_ids: input.skill.aiContract.preflightChecks.map((check) => check.id),
      repair_action_ids: input.skill.aiContract.repairActions.map((action: WorkflowRepairAction) => action.id),
      replay_snapshot_id: input.replaySnapshotId,
      required_connectors: input.skill.systemContract.requiredConnectors.map(normalizeConnectorRequirement),
      source_artifact_ids: input.sourceArtifactIds,
    },
    id: input.id,
    latest_test_run_id: input.latestTestRunId,
    name: input.name ?? input.skill.name,
    source: input.source,
    status: input.status ?? 'draft',
    updated_at: createdAt,
  };
}

export function createWorkflowRunObject(input: {
  run: WorkflowRun;
  temporary?: boolean;
  workflowDefinitionId?: string;
  workflowVersionId?: string;
}): WorkflowRunObject {
  return {
    artifacts: input.run.artifacts,
    created_at: input.run.created_at,
    finished_at: input.run.finished_at,
    id: input.run.id,
    normalized_input: input.run.normalized_input,
    replay_snapshot_id: input.run.replay_snapshot_id,
    status: input.run.status,
    temporary: input.temporary ?? input.workflowDefinitionId === undefined,
    workflow_definition_id: input.workflowDefinitionId,
    workflow_id: input.run.workflow_id,
    workflow_version: input.run.workflow_version,
    workflow_version_id: input.workflowVersionId ?? input.run.workflow_version_id,
  };
}

function bestValidationStatus(evidence: WorkflowValidationEvidence[]): WorkflowValidationStatus {
  if (evidence.some((record) => record.passed && (record.mode === 'real_maya' || record.mode === 'real_maya_ui_selection' || record.mode === 'real_software'))) {
    return 'real_software_validated';
  }
  if (evidence.some((record) => record.passed && record.mode === 'fixture')) {
    return 'fixture_validated';
  }
  return 'unvalidated';
}

function normalizeConnectorRequirement(input: WorkflowSkill['systemContract']['requiredConnectors'][number]): WorkflowConnectorRequirement {
  return {
    capability_package_id: input.capabilityPackageId,
    id: input.id,
    kind: input.kind,
    title: input.title,
  };
}
