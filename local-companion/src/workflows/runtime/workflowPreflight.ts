import {
  checkExternalMayaConnector,
  type ExternalMayaConnectorSyncStatus,
} from './mayaConnectorHttpActivity.js';
import {
  normalizeWorkflowInput,
  type WorkflowPreflightResult,
  type WorkflowRunInput,
} from './workflowRuns.js';

export type MayaWorkflowPreflightOptions = {
  baseUrl?: string;
  checkOutputExists?: (outputPath: string) => boolean | Promise<boolean>;
  connectorStatus?: ExternalMayaConnectorSyncStatus;
};

export async function runMayaExportPreflight(
  input: WorkflowRunInput,
  options: MayaWorkflowPreflightOptions = {},
): Promise<WorkflowPreflightResult[]> {
  const normalizedInput = normalizeWorkflowInput(input);
  const connectorStatus = options.connectorStatus ?? await checkExternalMayaConnector(options.baseUrl);
  const outputExists = options.checkOutputExists
    ? await options.checkOutputExists(normalizedInput.output_path)
    : false;

  return [
    buildConnectorOnlineResult(connectorStatus),
    buildSelectionResult(connectorStatus),
    buildOutputDirResult(normalizedInput.output_dir),
    buildOutputConflictResult({
      outputExists,
      overwrite: normalizedInput.overwrite,
    }),
    buildFbxCapabilityResult(connectorStatus),
  ];
}

function buildConnectorOnlineResult(status: ExternalMayaConnectorSyncStatus): WorkflowPreflightResult {
  if (status.state === 'connected') {
    return {
      check_id: 'maya_connector_online',
      message: `Maya Connector 已连接${status.mode ? `，当前为 ${status.mode} 模式` : ''}。`,
      status: 'passed',
    };
  }

  return {
    check_id: 'maya_connector_online',
    message: status.lastError ?? 'Maya Connector 未连接。',
    repair_action_id: 'reconnect_maya_connector',
    status: 'failed',
  };
}

function buildSelectionResult(status: ExternalMayaConnectorSyncStatus): WorkflowPreflightResult {
  if (status.state !== 'connected') {
    return {
      check_id: 'maya_selection_non_empty',
      message: '需要先连接 Maya Connector，才能检查当前选择。',
      repair_action_id: 'reconnect_maya_connector',
      status: 'failed',
    };
  }

  if ((status.selectionCount ?? 0) > 0) {
    return {
      check_id: 'maya_selection_non_empty',
      message: `已选择 ${status.selectionCount} 个 Maya 对象。`,
      status: 'passed',
    };
  }

  return {
    check_id: 'maya_selection_non_empty',
    message: '当前没有选择 Maya 对象。',
    repair_action_id: 'select_maya_objects',
    status: 'failed',
  };
}

function buildOutputDirResult(outputDir: string): WorkflowPreflightResult {
  if (outputDir.trim()) {
    return {
      check_id: 'output_dir_writable',
      message: `输出目录已设置为 ${outputDir}。`,
      status: 'passed',
    };
  }

  return {
    check_id: 'output_dir_writable',
    message: '输出目录为空。',
    repair_action_id: 'revise_output_dir',
    status: 'failed',
  };
}

function buildOutputConflictResult(input: {
  outputExists: boolean;
  overwrite: boolean;
}): WorkflowPreflightResult {
  if (!input.outputExists || input.overwrite) {
    return {
      check_id: 'output_conflict_resolved',
      message: input.outputExists
        ? '目标文件已存在，已允许覆盖。'
        : '未发现输出文件冲突。',
      status: 'passed',
    };
  }

  return {
    check_id: 'output_conflict_resolved',
    message: '目标 FBX 已存在，且未允许覆盖。',
    repair_action_id: 'confirm_overwrite_or_rename',
    status: 'failed',
  };
}

function buildFbxCapabilityResult(status: ExternalMayaConnectorSyncStatus): WorkflowPreflightResult {
  if (status.state === 'connected') {
    return {
      check_id: 'fbx_export_capability_available',
      message: 'FBX 导出能力将在 Connector 执行导出时确认。',
      status: 'passed',
    };
  }

  return {
    check_id: 'fbx_export_capability_available',
    message: '需要先连接 Maya Connector，才能检查 FBX 导出能力。',
    repair_action_id: 'repair_maya_export_capability',
    status: 'failed',
  };
}
