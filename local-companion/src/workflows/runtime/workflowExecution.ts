import type { ToolBridgeCallRequest, ToolBridgeCallResult } from './toolBridgeInvocation.js';
import { runMayaExportPreflight, type MayaWorkflowPreflightOptions } from './workflowPreflight.js';
import {
  applyWorkflowPreflightResults,
  completeWorkflowRun,
  createWorkflowRun,
  failWorkflowRun,
  startWorkflowRun,
  type WorkflowRun,
  type WorkflowRunInput,
} from './workflowRuns.js';
import { mayaExportSelectionFbxWorkflowSkill } from './workflowSkills.js';

export type WorkflowToolBridgeClient = {
  callTool: (request: ToolBridgeCallRequest) => Promise<ToolBridgeCallResult> | ToolBridgeCallResult;
};

export type RunMayaExportWorkflowOptions = MayaWorkflowPreflightOptions & {
  callRequestedAt?: string;
  client: WorkflowToolBridgeClient;
  conversationId?: string;
  now?: string;
  runId?: string;
  traceId?: string;
};

export async function runMayaExportWorkflow(
  input: WorkflowRunInput,
  options: RunMayaExportWorkflowOptions,
): Promise<WorkflowRun> {
  const workflow = mayaExportSelectionFbxWorkflowSkill;
  const createdRun = createWorkflowRun({
    id: options.runId,
    input,
    now: options.now,
    traceId: options.traceId,
    workflow,
  });
  const preflightResults = await runMayaExportPreflight(input, options);
  const preflightRun = applyWorkflowPreflightResults({
    now: options.now,
    results: preflightResults,
    run: createdRun,
    workflow,
  });

  if (preflightRun.status === 'preflight_failed') {
    return preflightRun;
  }

  const runningRun = startWorkflowRun({
    now: options.now,
    run: preflightRun,
  });
  const toolResult = await options.client.callTool(createMayaExportToolBridgeRequest({
    conversationId: options.conversationId,
    requestedAt: options.callRequestedAt ?? options.now,
    run: runningRun,
  }));

  if (toolResult.status === 'failed') {
    return failWorkflowRun({
      code: toolResult.error?.code ?? 'maya_export_failed',
      message: toolResult.error?.message ?? 'Maya FBX export failed.',
      now: toolResult.finished_at ?? options.now,
      recoverable: toolResult.error?.recoverable,
      run: runningRun,
      toolCallId: toolResult.tool_call_id,
      workflow,
    });
  }

  const storageUri = getStringField(toolResult.output, 'storage_uri') ?? runningRun.normalized_input.output_path;
  const localPath = getStringField(toolResult.output, 'local_path');
  const bytes = getNumberField(toolResult.output, 'bytes') ?? 0;
  const assetId = getStringField(toolResult.output, 'asset_id') ?? `artifact_${runningRun.id}`;

  return completeWorkflowRun({
    artifact: {
      id: assetId,
      local_path: localPath,
      metadata: {
        bytes,
        tool_call_id: toolResult.tool_call_id,
      },
      status: 'created',
      type: 'fbx',
      uri: storageUri,
    },
    now: toolResult.finished_at ?? options.now,
    output: {
      artifact_id: assetId,
      fbx_path: storageUri,
      replay_snapshot_id: `replay_${runningRun.id}`,
      run_id: runningRun.id,
      trace_id: runningRun.trace_id,
    },
    run: runningRun,
    stepOutput: toolResult.output,
    toolCallId: toolResult.tool_call_id,
  });
}

export function createMayaExportToolBridgeRequest(input: {
  conversationId?: string;
  requestedAt?: string;
  run: WorkflowRun;
}): ToolBridgeCallRequest {
  return {
    caller_agent: {
      id: 'assetcutter-workflow-runtime',
      name: 'AssetCutter Workflow Runtime',
      scopes: ['workflow:run', 'tool_bridge:call'],
      transport: 'local_bridge',
      version: '0.1.0',
    },
    conversation_id: input.conversationId ?? `workflow_run:${input.run.id}`,
    idempotency_key: `workflow.maya.export_selection_fbx:${input.run.id}`,
    input: {
      output_path: input.run.normalized_input.output_path,
      overwrite: input.run.normalized_input.overwrite,
    },
    requested_at: input.requestedAt ?? new Date().toISOString(),
    tool_name: 'workflow.maya.export_selection_fbx',
    tool_version: '1.0.0',
    trace_id: input.run.trace_id,
  };
}

function getStringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
}
