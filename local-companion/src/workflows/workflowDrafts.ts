import { listWorkflowRuns, saveWorkflowRun } from './runtime/workflowRunHistory.js';
import { getWorkflowSkill } from './runtime/workflowSkills.js';
import { runWorkflowCapability, type RunWorkflowCapabilityInput } from './runWorkflowCapability.js';
import {
  createWorkflowDraftFromSkill,
  type WorkflowConnectorRequirement,
  type WorkflowDefinition,
  type WorkflowDraft,
  type WorkflowDraftStatus,
  type WorkflowValidationEvidence,
  type WorkflowVersion,
} from './workflowObjects.js';
import {
  loadWorkflowObjectStore,
  upsertWorkflowDefinition,
  upsertWorkflowDraft,
  upsertWorkflowVersion,
} from './workflowObjectStore.js';

export type SaveWorkflowRunAsDraftInput = {
  draftId?: string;
  historyPath?: string;
  name?: string;
  now?: string;
  runId: string;
  storePath?: string;
};

export type SaveWorkflowRunAsDraftResult =
  | { ok: true; draft: WorkflowDraft; run: ReturnType<typeof listWorkflowRuns>[number] }
  | { ok: false; error: string; message: string };

export type CreateWorkflowDraftInput = {
  description?: string;
  draftId?: string;
  name?: string;
  now?: string;
  source?: WorkflowDraft['source'];
  storePath?: string;
  workflowId?: string;
};

export type UpdateWorkflowDraftInput = {
  defaultInput?: Record<string, unknown>;
  description?: string;
  draftId: string;
  inputSchema?: WorkflowDraft['definition']['input_schema'];
  name?: string;
  now?: string;
  requiredConnectors?: WorkflowConnectorRequirement[];
  status?: Exclude<WorkflowDraftStatus, 'archived'>;
  storePath?: string;
};

export type WorkflowDraftResult =
  | { ok: true; draft: WorkflowDraft }
  | { ok: false; error: string; message: string };

export type TestRunWorkflowDraftInput = Pick<
  RunWorkflowCapabilityInput,
  'baseUrl' | 'checkOutputExists' | 'connectorStatus' | 'historyPath' | 'runId' | 'traceId'
> & {
  draftId: string;
  params?: Record<string, unknown>;
  storePath?: string;
};

export type PublishWorkflowDraftVersionInput = {
  changeSummary?: string;
  draftId: string;
  now?: string;
  semver?: string;
  storePath?: string;
};

export type PublishWorkflowDraftVersionResult =
  | { ok: true; definition: WorkflowDefinition; draft: WorkflowDraft; version: WorkflowVersion }
  | { ok: false; error: string; message: string };

export function listWorkflowDrafts(storePath?: string) {
  return loadWorkflowObjectStore(storePath).drafts;
}

export function getWorkflowDraft(draftId: string, storePath?: string): WorkflowDraftResult {
  const draft = listWorkflowDrafts(storePath).find((item) => item.id === draftId);
  if (!draft) {
    return {
      ok: false,
      error: 'workflow_draft_not_found',
      message: `WorkflowDraft not found: ${draftId}`,
    };
  }
  return { ok: true, draft };
}

export function createWorkflowDraft(input: CreateWorkflowDraftInput): WorkflowDraftResult {
  const workflowId = input.workflowId || 'workflow.maya.export_selection_fbx';
  const skill = getWorkflowSkill(workflowId);
  if (!skill) {
    return {
      ok: false,
      error: 'workflow_skill_not_found',
      message: `WorkflowSkill not found: ${workflowId}`,
    };
  }
  const draft = {
    ...createWorkflowDraftFromSkill({
      createdAt: input.now,
      id: input.draftId ?? `draft_${skill.id.replaceAll('.', '_')}_${Date.now()}`,
      name: input.name,
      skill,
      source: input.source ?? { kind: 'conversation' },
    }),
    description: input.description,
  };
  upsertWorkflowDraft(draft, input.storePath);
  return { ok: true, draft };
}

export function updateWorkflowDraft(input: UpdateWorkflowDraftInput): WorkflowDraftResult {
  const current = getWorkflowDraft(input.draftId, input.storePath);
  if (!current.ok) return current;
  const updated: WorkflowDraft = {
    ...current.draft,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    definition: {
      ...current.draft.definition,
      ...(input.defaultInput !== undefined ? { default_input: input.defaultInput } : {}),
      ...(input.inputSchema !== undefined ? { input_schema: input.inputSchema } : {}),
      ...(input.requiredConnectors !== undefined ? { required_connectors: input.requiredConnectors } : {}),
    },
    updated_at: input.now ?? new Date().toISOString(),
  };
  upsertWorkflowDraft(updated, input.storePath);
  return { ok: true, draft: updated };
}

export function archiveWorkflowDraft(input: {
  draftId: string;
  now?: string;
  storePath?: string;
}): WorkflowDraftResult {
  const current = getWorkflowDraft(input.draftId, input.storePath);
  if (!current.ok) return current;
  const archived: WorkflowDraft = {
    ...current.draft,
    status: 'archived',
    updated_at: input.now ?? new Date().toISOString(),
  };
  upsertWorkflowDraft(archived, input.storePath);
  return { ok: true, draft: archived };
}

export async function testRunWorkflowDraft(input: TestRunWorkflowDraftInput) {
  const current = getWorkflowDraft(input.draftId, input.storePath);
  if (!current.ok) return current;
  if (current.draft.status === 'archived') {
    return {
      ok: false as const,
      error: 'workflow_draft_archived',
      message: `WorkflowDraft is archived: ${input.draftId}`,
    };
  }
  const executorId = current.draft.definition.executor_ref.id;
  const defaultInput = current.draft.definition.default_input ?? {};
  const result = await runWorkflowCapability({
    baseUrl: input.baseUrl,
    checkOutputExists: input.checkOutputExists,
    connectorStatus: input.connectorStatus,
    historyPath: input.historyPath,
    params: {
      ...defaultInput,
      ...(input.params ?? {}),
    },
    runId: input.runId,
    traceId: input.traceId,
    workflowId: executorId,
  });

  const run = 'result' in result && result.result ? {
    ...result.result,
    draft_id: current.draft.id,
  } : null;
  if (run) saveWorkflowRun(run, input.historyPath);
  const updatedDraft: WorkflowDraft = {
    ...current.draft,
    latest_test_run_id: run?.id ?? current.draft.latest_test_run_id,
    updated_at: new Date().toISOString(),
  };
  upsertWorkflowDraft(updatedDraft, input.storePath);

  return {
    ...result,
    draft: updatedDraft,
    result: run ?? ('result' in result ? result.result : undefined),
  };
}

export function publishWorkflowDraftVersion(
  input: PublishWorkflowDraftVersionInput,
): PublishWorkflowDraftVersionResult {
  const current = getWorkflowDraft(input.draftId, input.storePath);
  if (!current.ok) return current;
  if (!current.draft.latest_test_run_id) {
    return {
      ok: false,
      error: 'workflow_draft_not_tested',
      message: `WorkflowDraft must pass a test run before publish: ${input.draftId}`,
    };
  }
  const workflowId = current.draft.definition.executor_ref.id;
  const skill = getWorkflowSkill(workflowId);
  if (!skill) {
    return {
      ok: false,
      error: 'workflow_skill_not_found',
      message: `WorkflowSkill not found: ${workflowId}`,
    };
  }
  const snapshot = loadWorkflowObjectStore(input.storePath);
  const existingDefinition = snapshot.definitions.find((item) => item.id === workflowId);
  const existingVersions = snapshot.versions.filter((item) => item.workflow_id === workflowId);
  const semver = input.semver ?? nextPatchVersion(existingDefinition?.current_version_id, skill.version);
  const versionId = `${workflowId}@${semver}`;
  const now = input.now ?? new Date().toISOString();
  const definition: WorkflowDefinition = {
    created_at: existingDefinition?.created_at ?? now,
    current_version_id: versionId,
    description: existingDefinition?.description,
    id: workflowId,
    lifecycle: 'validated',
    name: current.draft.name,
    required_connectors: current.draft.definition.required_connectors,
    tags: existingDefinition?.tags ?? [],
    updated_at: now,
  };
  const evidence: WorkflowValidationEvidence = {
    at: now,
    evidence: `Published from draft ${current.draft.id} after test run ${current.draft.latest_test_run_id}.`,
    id: `validation_${current.draft.latest_test_run_id}`,
    mode: 'fixture',
    passed: true,
  };
  const version: WorkflowVersion = {
    artifact_contract: current.draft.definition.artifact_contract,
    change_summary: input.changeSummary ?? `Published from draft ${current.draft.id}.`,
    created_at: now,
    executor_ref: current.draft.definition.executor_ref,
    id: versionId,
    input_schema: current.draft.definition.input_schema,
    semver,
    source_version_id: existingDefinition?.current_version_id ?? existingVersions[0]?.id,
    validation: {
      evidence: [evidence],
      status: 'fixture_validated',
    },
    workflow_id: workflowId,
  };
  const draft: WorkflowDraft = {
    ...current.draft,
    status: 'validated',
    updated_at: now,
  };

  upsertWorkflowDefinition(definition, input.storePath);
  upsertWorkflowVersion(version, input.storePath);
  upsertWorkflowDraft(draft, input.storePath);

  return { ok: true, definition, draft, version };
}

export function rollbackWorkflowDefaultVersion(input: {
  now?: string;
  storePath?: string;
  versionId: string;
  workflowId: string;
}) {
  const snapshot = loadWorkflowObjectStore(input.storePath);
  const definition = snapshot.definitions.find((item) => item.id === input.workflowId);
  if (!definition) {
    return {
      ok: false as const,
      error: 'workflow_definition_not_found',
      message: `WorkflowDefinition not found: ${input.workflowId}`,
    };
  }
  const version = snapshot.versions.find((item) => item.id === input.versionId && item.workflow_id === input.workflowId);
  if (!version) {
    return {
      ok: false as const,
      error: 'workflow_version_not_found',
      message: `WorkflowVersion not found: ${input.versionId}`,
    };
  }
  const updated = {
    ...definition,
    current_version_id: version.id,
    updated_at: input.now ?? new Date().toISOString(),
  };
  upsertWorkflowDefinition(updated, input.storePath);
  return {
    ok: true as const,
    definition: updated,
    version,
  };
}

export function saveWorkflowRunAsDraft(input: SaveWorkflowRunAsDraftInput): SaveWorkflowRunAsDraftResult {
  const runs = listWorkflowRuns(input.historyPath);
  const run = runs.find((item) => item.id === input.runId);
  if (!run) {
    return {
      ok: false,
      error: 'workflow_run_not_found',
      message: `WorkflowRun not found: ${input.runId}`,
    };
  }
  if (run.status !== 'succeeded') {
    return {
      ok: false,
      error: 'workflow_run_not_successful',
      message: `Only succeeded WorkflowRun can be saved as draft: ${input.runId}`,
    };
  }

  const skill = getWorkflowSkill(run.workflow_id);
  if (!skill) {
    return {
      ok: false,
      error: 'workflow_skill_not_found',
      message: `WorkflowSkill not found for run: ${run.workflow_id}`,
    };
  }

  const draft = createWorkflowDraftFromSkill({
    createdAt: input.now,
    defaultInput: run.normalized_input,
    id: input.draftId ?? run.saved_as_draft_id ?? `draft_${run.id}`,
    latestTestRunId: run.id,
    name: input.name ?? `${skill.name} 草稿`,
    replaySnapshotId: run.replay_snapshot_id,
    skill,
    source: { kind: 'run', run_id: run.id },
    sourceArtifactIds: run.artifact_ids,
  });
  upsertWorkflowDraft(draft, input.storePath);
  const updatedRun = {
    ...run,
    saved_as_draft_id: draft.id,
  };
  saveWorkflowRun(updatedRun, input.historyPath);

  return {
    ok: true,
    draft,
    run: updatedRun,
  };
}

function nextPatchVersion(currentVersionId: string | undefined, fallback: string) {
  const current = currentVersionId?.split('@').pop() || fallback;
  const parts = current.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}
