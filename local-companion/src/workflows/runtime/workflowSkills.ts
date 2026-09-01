import {
  booleanSchema,
  objectSchema,
  stringSchema,
  type JsonSchema,
} from './jsonSchema.js';

export type WorkflowSkillStatus = 'draft' | 'validated' | 'available' | 'deprecated' | 'archived';
export type WorkflowRiskLevel = 'safe' | 'confirm' | 'dangerous';

export type WorkflowCheck = {
  id: string;
  title: string;
  description: string;
  repairActionId: string;
  required: boolean;
};

export type WorkflowStep = {
  id: string;
  title: string;
  toolName: string;
  inputTemplate: Record<string, unknown>;
  successCriteria: string[];
  failureModes: string[];
};

export type WorkflowCriterion = {
  id: string;
  description: string;
};

export type WorkflowFailureMode = {
  code: string;
  description: string;
  repairActionId: string;
};

export type WorkflowRepairAction = {
  actionLayer: 'automatic' | 'user_confirmation' | 'ai_diagnostic';
  id: string;
  suggestedInputPatch?: Record<string, unknown>;
  title: string;
  message: string;
  actionType: 'retry' | 'revise_input' | 'confirm' | 'manual_repair' | 'reconnect';
  recoverable: boolean;
  requiresConfirmation: boolean;
};

export type WorkflowSkill = {
  id: string;
  legacyIds?: string[];
  name: string;
  version: string;
  status: WorkflowSkillStatus;
  userSummary: {
    title: string;
    inputSummary: string;
    outputSummary: string;
  };
  aiContract: {
    whenToUse: string;
    inputSchema: JsonSchema;
    outputSchema: JsonSchema;
    preflightChecks: WorkflowCheck[];
    steps: WorkflowStep[];
    successCriteria: WorkflowCriterion[];
    failureModes: WorkflowFailureMode[];
    repairActions: WorkflowRepairAction[];
  };
  systemContract: {
    requiredCapabilities: string[];
    requiredConnectors: Array<{
      capabilityPackageId: string;
      id: string;
      kind: 'software_connection';
      title: string;
    }>;
    riskLevel: WorkflowRiskLevel;
    auditPolicy: Record<string, unknown>;
    artifactPolicy: Record<string, unknown>;
    replayPolicy: Record<string, unknown>;
    validation: {
      lastValidatedAt: string;
      records: Array<{
        evidence: string;
        id: string;
        mode: 'fixture' | 'real_maya' | 'real_maya_ui_selection';
        passed: boolean;
      }>;
      status: 'unvalidated' | 'validated';
    };
  };
};

export const mayaExportSelectionFbxWorkflowSkill = {
  id: 'workflow.maya.export_selection_fbx',
  legacyIds: ['scriptHub.maya.export_selection_fbx'],
  name: '导出当前 Maya 选择为 FBX',
  version: '0.1.0',
  status: 'available',
  userSummary: {
    title: '导出当前 Maya 选择为 FBX',
    inputSummary: '输入输出目录、文件名和是否允许覆盖。',
    outputSummary: '得到 FBX 文件，并生成运行记录、产物记录和复现快照。',
  },
  aiContract: {
    whenToUse:
      'Use this workflow when the user wants to export the current Maya selection as a single FBX file with repeatable run evidence.',
    inputSchema: objectSchema(
      {
        output_dir: stringSchema(),
        file_name: stringSchema(),
        overwrite: booleanSchema(),
      },
      ['output_dir', 'file_name', 'overwrite'],
    ),
    outputSchema: objectSchema(
      {
        artifact_id: stringSchema(),
        fbx_path: stringSchema(),
        replay_snapshot_id: stringSchema(),
        run_id: stringSchema(),
        trace_id: stringSchema(),
      },
      ['artifact_id', 'fbx_path', 'run_id'],
    ),
    preflightChecks: [
      {
        id: 'maya_connector_online',
        title: 'Maya Connector 已连接',
        description: '本地 Maya Connector 必须可访问。',
        repairActionId: 'reconnect_maya_connector',
        required: true,
      },
      {
        id: 'maya_selection_non_empty',
        title: 'Maya 当前选择不为空',
        description: '当前 Maya 选择里至少需要有一个可导出对象。',
        repairActionId: 'select_maya_objects',
        required: true,
      },
      {
        id: 'output_dir_writable',
        title: '输出目录可用',
        description: '导出前需要确认输出目录存在或可创建。',
        repairActionId: 'revise_output_dir',
        required: true,
      },
      {
        id: 'output_conflict_resolved',
        title: '输出文件冲突已处理',
        description: '如果目标文件已存在，需要明确允许覆盖或更换文件名。',
        repairActionId: 'confirm_overwrite_or_rename',
        required: true,
      },
      {
        id: 'fbx_export_capability_available',
        title: 'FBX 导出能力可用',
        description: '本地连接能力需要支持 Maya FBX 导出。',
        repairActionId: 'repair_maya_export_capability',
        required: true,
      },
    ],
    steps: [
      {
        id: 'export_selection_fbx',
        title: '导出当前 Maya 选择',
        toolName: 'workflow.maya.export_selection_fbx',
        inputTemplate: {
          output_path: '{{normalized.output_path}}',
          overwrite: '{{input.overwrite}}',
        },
        successCriteria: [
          '工具调用成功',
          '返回的 FBX 路径与标准化输出路径一致',
          '导出的文件大小大于 0',
        ],
        failureModes: [
          'connector_offline',
          'empty_selection',
          'output_exists',
          'fbx_plugin_unavailable',
          'maya_command_timeout',
        ],
      },
    ],
    successCriteria: [
      {
        id: 'fbx_file_created',
        description: '输出路径存在 FBX 文件，且文件大小大于 0。',
      },
      {
        id: 'artifact_registered',
        description: '导出的 FBX 已登记为产物记录。',
      },
      {
        id: 'run_succeeded',
        description: 'WorkflowRun 状态为已完成。',
      },
      {
        id: 'replay_snapshot_saved',
        description: '已保存同一输入和依赖摘要对应的复现记录。',
      },
    ],
    failureModes: [
      {
        code: 'connector_offline',
        description: 'Maya Connector 不可访问。',
        repairActionId: 'reconnect_maya_connector',
      },
      {
        code: 'empty_selection',
        description: '当前没有选择 Maya 对象。',
        repairActionId: 'select_maya_objects',
      },
      {
        code: 'invalid_output_path',
        description: '输出路径无法解析或无法写入。',
        repairActionId: 'revise_output_dir',
      },
      {
        code: 'output_exists',
        description: '目标 FBX 已存在，且未允许覆盖。',
        repairActionId: 'confirm_overwrite_or_rename',
      },
      {
        code: 'fbx_plugin_unavailable',
        description: 'Maya 无法加载或使用 FBX 导出能力。',
        repairActionId: 'repair_maya_export_capability',
      },
      {
        code: 'maya_command_timeout',
        description: 'Maya 导出命令超时。',
        repairActionId: 'retry_or_restart_maya_connector',
      },
    ],
    repairActions: [
      {
        id: 'reconnect_maya_connector',
        actionLayer: 'user_confirmation',
        title: '重新连接 Maya Connector',
        message: '启动或重新连接本地 Maya Connector，然后再次运行检查。',
        actionType: 'reconnect',
        recoverable: true,
        requiresConfirmation: false,
      },
      {
        id: 'select_maya_objects',
        actionLayer: 'user_confirmation',
        title: '选择 Maya 对象',
        message: '请先在 Maya 中选择至少一个可导出对象，然后再次运行工作流。',
        actionType: 'manual_repair',
        recoverable: true,
        requiresConfirmation: false,
      },
      {
        id: 'revise_output_dir',
        actionLayer: 'user_confirmation',
        title: '更换输出文件夹',
        message: '请选择一个可写入的输出文件夹，用于保存导出的 FBX。',
        actionType: 'revise_input',
        recoverable: true,
        requiresConfirmation: false,
      },
      {
        id: 'confirm_overwrite_or_rename',
        actionLayer: 'user_confirmation',
        suggestedInputPatch: {
          overwrite: true,
        },
        title: '允许覆盖或改名',
        message: '请允许覆盖同名文件，或换一个文件名后再导出。',
        actionType: 'confirm',
        recoverable: true,
        requiresConfirmation: true,
      },
      {
        id: 'repair_maya_export_capability',
        actionLayer: 'ai_diagnostic',
        title: '修复 Maya FBX 导出能力',
        message: '请启用或修复 Maya 的 FBX 导出能力，然后重试。',
        actionType: 'manual_repair',
        recoverable: true,
        requiresConfirmation: false,
      },
      {
        id: 'retry_or_restart_maya_connector',
        actionLayer: 'automatic',
        title: '重试或重启 Maya Connector',
        message: '可以先重试一次；如果仍然超时，请重启 Connector 后再运行。',
        actionType: 'retry',
        recoverable: true,
        requiresConfirmation: false,
      },
    ],
  },
  systemContract: {
    requiredCapabilities: ['workflow.maya.export_selection_fbx'],
    requiredConnectors: [
      {
        capabilityPackageId: 'maya',
        id: 'maya_connector',
        kind: 'software_connection',
        title: 'Maya Connector',
      },
    ],
    riskLevel: 'confirm',
    auditPolicy: {
      recordToolCalls: true,
      recordPreflightResults: true,
    },
    artifactPolicy: {
      registerOnSuccess: true,
      type: 'fbx',
    },
    replayPolicy: {
      saveInput: true,
      rerunPreflight: true,
    },
    validation: {
      lastValidatedAt: '2026-08-10T06:22:28.000Z',
      records: [
        {
          evidence: 'Fixture workflow generated project://exports/selected_asset_1786343047632.fbx with 298 bytes.',
          id: 'validation_fixture_2026_08_10',
          mode: 'fixture',
          passed: true,
        },
        {
          evidence: 'npm run workflow:maya-real-smoke wrote a real FBX with 21792 bytes via Maya2022 mayapy.',
          id: 'validation_real_maya_2026_08_10',
          mode: 'real_maya',
          passed: true,
        },
        {
          evidence: 'npm run workflow:maya-ui-selection-smoke exported the current Maya 2022 UI selection (3 objects: |pCube1, |pCube3, |pCube2) to a 30256-byte FBX.',
          id: 'validation_real_maya_ui_selection_2026_08_11',
          mode: 'real_maya_ui_selection',
          passed: true,
        },
      ],
      status: 'validated',
    },
  },
} satisfies WorkflowSkill;

export const workflowSkills = [
  mayaExportSelectionFbxWorkflowSkill,
] satisfies WorkflowSkill[];

export function listWorkflowSkills() {
  return workflowSkills;
}

export const MANUAL_TRACE_WORKFLOW_ID = 'workflow.manual.from_trace';

export const manualTraceReplayWorkflowSkill = {
  id: MANUAL_TRACE_WORKFLOW_ID,
  name: '手册复现',
  version: '0.1.0',
  status: 'available',
  userSummary: {
    title: '手册复现',
    inputSummary: '按整理好的步骤由管家代办。',
    outputSummary: '没有本机自动执行器，不假装已跑通。',
  },
  aiContract: {
    whenToUse:
      'Use when the user compiled a host procedure (for example Unreal connection + fog holdout) that has no registered local executor yet. The butler follows the written steps. Do not call replay_run.',
    inputSchema: objectSchema({}, []),
    outputSchema: objectSchema({}, []),
    preflightChecks: [],
    steps: [
      {
        id: 'follow_documented_steps',
        title: '按手册步骤办事',
        toolName: 'butler',
        inputTemplate: {},
        successCriteria: ['管家按步骤做完并回报'],
        failureModes: ['没有对应本机执行器'],
      },
    ],
    successCriteria: [{ id: 'steps_followed', description: '管家按手册步骤办完。' }],
    failureModes: [
      {
        code: 'no_local_executor',
        description: '本机没有自动执行器。',
        repairActionId: 'follow_manually',
      },
    ],
    repairActions: [
      {
        id: 'follow_manually',
        actionLayer: 'user_confirmation',
        title: '按手册代办',
        message: '没有自动执行器时，管家按卡片描述逐步办理。',
        actionType: 'manual_repair',
        recoverable: true,
        requiresConfirmation: false,
      },
    ],
  },
  systemContract: {
    requiredCapabilities: [],
    requiredConnectors: [],
    riskLevel: 'confirm',
    auditPolicy: { recordToolCalls: true },
    artifactPolicy: { registerOnSuccess: false },
    replayPolicy: { saveInput: true, rerunPreflight: false },
    validation: {
      lastValidatedAt: '',
      records: [],
      status: 'unvalidated',
    },
  },
} satisfies WorkflowSkill;

export function getWorkflowSkill(id: string) {
  const all: WorkflowSkill[] = [...workflowSkills, manualTraceReplayWorkflowSkill];
  return all.find((workflow) => workflow.id === id || (workflow.legacyIds ?? []).includes(id));
}
