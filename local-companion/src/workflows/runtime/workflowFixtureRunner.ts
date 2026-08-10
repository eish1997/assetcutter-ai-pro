import type { WorkflowToolBridgeClient } from './workflowExecution.js';
import { runMayaExportWorkflow } from './workflowExecution.js';
import type { ToolBridgeCallResult } from './toolBridgeInvocation.js';
import type { WorkflowRun, WorkflowRunInput } from './workflowRuns.js';

export type WorkflowFixtureCaseId =
  | 'maya_fbx_success'
  | 'maya_fbx_preflight_failed'
  | 'maya_fbx_execution_failed'
  | 'maya_fbx_artifact_missing';

export type WorkflowFixtureCase = {
  description: string;
  id: WorkflowFixtureCaseId;
  run: WorkflowRun;
};

const fixtureInput: WorkflowRunInput = {
  file_name: 'fixture_asset',
  output_dir: 'project://exports',
  overwrite: false,
};

export async function runWorkflowFixtureSuite(): Promise<WorkflowFixtureCase[]> {
  const success = await runMayaExportWorkflow(fixtureInput, {
    checkOutputExists: async () => false,
    client: createFixtureClient('succeeded'),
    connectorStatus: {
      mode: 'fixture',
      selectionCount: 1,
      state: 'connected',
    },
    now: '2026-08-10T14:10:00.000Z',
    runId: 'fixture_maya_fbx_success',
    traceId: 'trace_fixture_success',
  });

  const preflightFailed = await runMayaExportWorkflow(fixtureInput, {
    checkOutputExists: async () => false,
    client: createFixtureClient('succeeded'),
    connectorStatus: {
      mode: 'fixture',
      selectionCount: 0,
      state: 'connected',
    },
    now: '2026-08-10T14:11:00.000Z',
    runId: 'fixture_maya_fbx_preflight_failed',
    traceId: 'trace_fixture_preflight_failed',
  });

  const executionFailed = await runMayaExportWorkflow(fixtureInput, {
    checkOutputExists: async () => false,
    client: createFixtureClient('failed'),
    connectorStatus: {
      mode: 'fixture',
      selectionCount: 1,
      state: 'connected',
    },
    now: '2026-08-10T14:12:00.000Z',
    runId: 'fixture_maya_fbx_execution_failed',
    traceId: 'trace_fixture_execution_failed',
  });

  const artifactMissing: WorkflowRun = {
    ...success,
    id: 'fixture_maya_fbx_artifact_missing',
    artifacts: success.artifacts.map((artifact) => ({
      ...artifact,
      id: 'artifact_fixture_missing',
      provenance: {
        ...artifact.provenance,
        run_id: 'fixture_maya_fbx_artifact_missing',
      },
      run_id: 'fixture_maya_fbx_artifact_missing',
      status: 'missing',
    })),
    artifact_ids: ['artifact_fixture_missing'],
    status: 'succeeded',
  };

  return [
    {
      description: 'Maya FBX fixture succeeds and records an Artifact plus ReplaySnapshot.',
      id: 'maya_fbx_success',
      run: success,
    },
    {
      description: 'Maya FBX fixture stops at preflight and exposes RepairAction.',
      id: 'maya_fbx_preflight_failed',
      run: preflightFailed,
    },
    {
      description: 'Maya FBX fixture fails during connector execution and exposes RepairAction when available.',
      id: 'maya_fbx_execution_failed',
      run: executionFailed,
    },
    {
      description: 'Maya FBX fixture represents an Artifact whose file is no longer available.',
      id: 'maya_fbx_artifact_missing',
      run: artifactMissing,
    },
  ];
}

function createFixtureClient(status: ToolBridgeCallResult['status']): WorkflowToolBridgeClient {
  return {
    async callTool(request) {
      const now = new Date().toISOString();
      const scopes = [...(request.caller_agent.scopes ?? [])];
      const toolCallId = `tc_fixture_${status}`;
      const traceId = request.trace_id ?? `trace_fixture_${status}`;
      if (status === 'failed') {
        return {
          audit: {
            actor_id: request.caller_agent.id,
            actor_type: 'assetcutter',
            audit_id: `audit_${toolCallId}`,
            caller_agent_id: request.caller_agent.id,
            created_at: now,
            permissions_checked: ['workflow:run'],
            policy_decision: 'deny',
            risk_level: 'high',
            scopes,
            transport: request.caller_agent.transport,
          },
          conversation_id: request.conversation_id,
          error: {
            code: 'maya_command_timeout',
            message: 'Fixture Maya command timed out.',
            recoverable: true,
          },
          finished_at: now,
          started_at: now,
          status: 'failed',
          tool_call_id: toolCallId,
          tool_name: request.tool_name,
          trace_id: traceId,
        };
      }

      return {
        audit: {
          actor_id: request.caller_agent.id,
          actor_type: 'assetcutter',
          audit_id: `audit_${toolCallId}`,
          caller_agent_id: request.caller_agent.id,
          created_at: now,
          permissions_checked: ['workflow:run'],
          policy_decision: 'allow',
          risk_level: 'high',
          scopes,
          transport: request.caller_agent.transport,
        },
        conversation_id: request.conversation_id,
        finished_at: now,
        output: {
          asset_id: 'artifact_fixture_success',
          bytes: 512,
          selection_count: 1,
          storage_uri: 'project://exports/fixture_asset.fbx',
          trace_id: traceId,
        },
        started_at: now,
        status: 'succeeded',
        tool_call_id: toolCallId,
        tool_name: request.tool_name,
          trace_id: traceId,
      };
    },
  };
}
