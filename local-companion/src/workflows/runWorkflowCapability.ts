import { createMayaConnectorToolBridgeClient, createWorkflowOutputExistsChecker } from './runtime/workflowToolBridgeHttpClient.js';
import { runMayaExportWorkflow } from './runtime/workflowExecution.js';
import { saveWorkflowRun } from './runtime/workflowRunHistory.js';
import { getWorkflowSkill, mayaExportSelectionFbxWorkflowSkill } from './runtime/workflowSkills.js';
import { applyWorkflowPreflightResults, createWorkflowRun, type WorkflowRunInput } from './runtime/workflowRuns.js';
import { runMayaExportPreflight } from './runtime/workflowPreflight.js';

export type RunWorkflowCapabilityInput = {
  baseUrl?: string;
  checkOutputExists?: (outputPath: string) => boolean | Promise<boolean>;
  connectorStatus?: Parameters<typeof runMayaExportWorkflow>[1]['connectorStatus'];
  historyPath?: string;
  params?: unknown;
  reusedFromRunId?: string;
  runId?: string;
  traceId?: string;
  workflowId?: string;
};

export async function runWorkflowCapability(input: RunWorkflowCapabilityInput) {
  const workflowId = input.workflowId || mayaExportSelectionFbxWorkflowSkill.id;
  const workflow = getWorkflowSkill(workflowId);
  if (!workflow) {
    return {
      ok: false as const,
      error: 'workflow_skill_not_found',
      message: `WorkflowSkill not found: ${workflowId}`,
    };
  }
  if (workflow.id !== mayaExportSelectionFbxWorkflowSkill.id) {
    return {
      ok: false as const,
      error: 'workflow_not_runnable',
      message: `WorkflowSkill is not runnable yet: ${workflow.id}`,
    };
  }

  const runInput = parseMayaRunInput(input.params);
  if (!runInput.ok) return runInput;

  const mayaConnectorUrl =
    input.baseUrl ||
    process.env.ASSETCUTTER_WORKFLOW_MAYA_CONNECTOR_URL ||
    process.env.ASSETCUTTER_MAYA_CONNECTOR_URL ||
    process.env.SCRIPTHUB_MAYA_CONNECTOR_URL;
  const run = await runMayaExportWorkflow(runInput.input, {
    baseUrl: mayaConnectorUrl,
    checkOutputExists: input.checkOutputExists || createWorkflowOutputExistsChecker(),
    client: createMayaConnectorToolBridgeClient(mayaConnectorUrl),
    connectorStatus: input.connectorStatus,
    runId: input.runId,
    traceId: input.traceId,
  });
  const runWithReuseSource = input.reusedFromRunId
    ? {
        ...run,
        reused_from_run_id: input.reusedFromRunId,
      }
    : run;
  saveWorkflowRun(runWithReuseSource, input.historyPath);

  return {
    ok: runWithReuseSource.status === 'succeeded',
    result: runWithReuseSource,
    message: runWithReuseSource.status === 'succeeded'
      ? 'Workflow run succeeded.'
      : runWithReuseSource.status === 'preflight_failed'
        ? 'Workflow preflight failed.'
        : 'Workflow run failed.',
  } as const;
}

export async function preflightWorkflowCapability(input: RunWorkflowCapabilityInput) {
  const workflowId = input.workflowId || mayaExportSelectionFbxWorkflowSkill.id;
  const workflow = getWorkflowSkill(workflowId);
  if (!workflow) {
    return {
      ok: false as const,
      error: 'workflow_skill_not_found',
      message: `WorkflowSkill not found: ${workflowId}`,
    };
  }
  if (workflow.id !== mayaExportSelectionFbxWorkflowSkill.id) {
    return {
      ok: false as const,
      error: 'workflow_not_runnable',
      message: `WorkflowSkill is not runnable yet: ${workflow.id}`,
    };
  }

  const runInput = parseMayaRunInput(input.params);
  if (!runInput.ok) return runInput;

  const mayaConnectorUrl =
    input.baseUrl ||
    process.env.ASSETCUTTER_WORKFLOW_MAYA_CONNECTOR_URL ||
    process.env.ASSETCUTTER_MAYA_CONNECTOR_URL ||
    process.env.SCRIPTHUB_MAYA_CONNECTOR_URL;
  const run = createWorkflowRun({
    id: input.runId,
    input: runInput.input,
    traceId: input.traceId,
    workflow,
  });
  const results = await runMayaExportPreflight(runInput.input, {
    baseUrl: mayaConnectorUrl,
    checkOutputExists: input.checkOutputExists || createWorkflowOutputExistsChecker(),
    connectorStatus: input.connectorStatus,
  });
  const preflightRun = applyWorkflowPreflightResults({
    results,
    run,
    workflow,
  });

  return {
    ok: true as const,
    preflight: {
      normalized_input: preflightRun.normalized_input,
      repair_actions: preflightRun.repair_actions,
      results: preflightRun.preflight_results,
      run_id: preflightRun.id,
      status: preflightRun.status === 'preflight_failed' ? 'failed' : 'passed',
      trace_id: preflightRun.trace_id,
      workflow_id: preflightRun.workflow_id,
    },
  };
}

function parseMayaRunInput(params: unknown):
  | { ok: true; input: WorkflowRunInput }
  | { ok: false; error: string; message: string } {
  const record = isRecord(params) ? params : {};
  const fileName = String(record.file_name || record.fileName || '').trim();
  const outputDir = String(record.output_dir || record.outputDir || '').trim();
  if (!fileName || !outputDir) {
    return {
      ok: false,
      error: 'workflow_input_invalid',
      message: 'Maya FBX workflow requires file_name and output_dir.',
    };
  }
  return {
    ok: true,
    input: {
      file_name: fileName,
      output_dir: outputDir,
      overwrite: Boolean(record.overwrite),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
