import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ToolBridgeCallRequest,
  ToolBridgeCallResult,
} from './toolBridgeInvocation.js';
import { validateToolBridgeCallRequest } from './toolBridgeInvocation.js';
import type { WorkflowToolBridgeClient } from './workflowExecution.js';
import { exportExternalMayaFbx } from './mayaConnectorHttpActivity.js';

type ToolBridgeRouteResponse<T> = {
  data?: T;
  error?: {
    message?: string;
  };
  ok: boolean;
};

const defaultBridgeBaseUrl = 'http://localhost:8787';
const defaultOutputRoot = path.resolve('.assetcutter/workflow-runtime');

type WorkflowOutputStatus = {
  exists: boolean;
  local_path: string;
  output_path: string;
};

export function createWorkflowToolBridgeHttpClient(baseUrl = defaultBridgeBaseUrl): WorkflowToolBridgeClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    async callTool(request: ToolBridgeCallRequest) {
      const response = await fetch(`${normalizedBaseUrl}/tool-bridge/calls`, {
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP Tool Bridge returned ${response.status}`);
      }

      const payload = await response.json() as ToolBridgeRouteResponse<ToolBridgeCallResult>;
      if (!payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? 'HTTP Tool Bridge call failed');
      }

      return payload.data;
    },
  };
}

export function createMayaConnectorToolBridgeClient(baseUrl?: string): WorkflowToolBridgeClient {
  return {
    async callTool(request: ToolBridgeCallRequest) {
      const now = new Date().toISOString();
      const traceId = request.trace_id ?? `trace_maya_export_${Date.now()}`;
      const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const validation = validateToolBridgeCallRequest(request);
      if (!validation.ok) {
        return buildToolResult({
          now,
          request,
          status: 'failed',
          toolCallId,
          traceId,
          error: {
            code: 'invalid_input',
            detail: validation.issues,
            message: validation.issues.map((issue) => issue.message).join('; '),
            recoverable: true,
          },
        });
      }

      if (!['workflow.maya.export_selection_fbx', 'scriptHub.maya.export_selection_fbx'].includes(request.tool_name)) {
        return buildToolResult({
          now,
          request,
          status: 'failed',
          toolCallId,
          traceId,
          error: {
            code: 'not_found',
            message: `Unsupported workflow tool ${request.tool_name}`,
            recoverable: false,
          },
        });
      }

      const outputPath = String(request.input.output_path || '').trim();
      const exportResult = await exportExternalMayaFbx({
        output_path: outputPath,
        overwrite: Boolean(request.input.overwrite),
        trace_id: traceId,
      }, baseUrl);

      if (!exportResult.ok) {
        return buildToolResult({
          now,
          request,
          status: 'failed',
          toolCallId,
          traceId,
          error: {
            code: 'maya_export_failed',
            message: exportResult.error.message,
            recoverable: true,
          },
        });
      }

      return buildToolResult({
        now,
        request,
        status: 'succeeded',
        toolCallId,
        traceId,
        output: {
          asset_id: `asset_${toolCallId}`,
          bytes: exportResult.data.bytes,
          local_path: exportResult.data.localPath,
          selection_count: exportResult.data.selectionCount,
          storage_uri: exportResult.data.storageUri,
          trace_id: traceId,
        },
      });
    },
  };
}

export function createWorkflowOutputExistsChecker(outputRoot = defaultOutputRoot) {
  return async function checkOutputExists(outputPath: string) {
    const status = await getWorkflowOutputStatus(outputPath, outputRoot);
    return status.exists;
  };
}

export async function getWorkflowOutputStatus(
  outputPath: string,
  outputRoot = defaultOutputRoot,
): Promise<WorkflowOutputStatus> {
  const localPath = resolveWorkflowOutputPath(outputPath, outputRoot);
  return {
    exists: await exists(localPath),
    local_path: localPath,
    output_path: outputPath,
  };
}

export const workflowToolBridgeHttpClient = createWorkflowToolBridgeHttpClient();
export const workflowOutputExistsChecker = createWorkflowOutputExistsChecker();

function buildToolResult(input: {
  error?: ToolBridgeCallResult['error'];
  now: string;
  output?: Record<string, unknown>;
  request: ToolBridgeCallRequest;
  status: ToolBridgeCallResult['status'];
  toolCallId: string;
  traceId: string;
}): ToolBridgeCallResult {
  return {
    audit: {
      actor_id: input.request.caller_agent.id,
      actor_type: 'assetcutter',
      audit_id: `audit_${input.toolCallId}`,
      caller_agent_id: input.request.caller_agent.id,
      created_at: input.now,
      permissions_checked: ['workflow:run', 'asset:register', 'connector:maya'],
      policy_decision: input.status === 'failed' ? 'deny' : 'allow',
      risk_level: 'high',
      scopes: input.request.caller_agent.scopes ?? [],
      transport: input.request.caller_agent.transport,
    },
    conversation_id: input.request.conversation_id,
    error: input.error,
    finished_at: new Date().toISOString(),
    output: input.output,
    started_at: input.now,
    status: input.status,
    tool_call_id: input.toolCallId,
    tool_name: input.request.tool_name,
    trace_id: input.traceId,
  };
}

function resolveWorkflowOutputPath(outputPath: string, outputRoot: string) {
  if (outputPath.startsWith('project://')) {
    const relativePath = outputPath.slice('project://'.length).replace(/^[/\\]+/, '');
    return path.resolve(outputRoot, relativePath);
  }

  if (outputPath.startsWith('file://')) {
    return path.resolve(fileURLToPath(outputPath));
  }

  return path.resolve(outputRoot, outputPath.replace(/^[/\\]+/, ''));
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
