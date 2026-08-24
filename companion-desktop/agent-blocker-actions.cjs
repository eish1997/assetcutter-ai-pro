'use strict';

const STATUS_COMMAND = 'npm run smoke:agent-mcp:status';
const WORKFLOW_DRAFT_SMOKE_COMMAND = 'npm run smoke:agent-mcp';
const WORKBENCH_WAIT_LOGIN_COMMAND = 'npm run smoke:agent-mcp:e2e:wait-login';
const WORKBENCH_OPEN_LOGIN_WAIT_COMMAND = 'npm run smoke:agent-mcp:e2e:open-login-wait';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function statusAction() {
  return {
    id: 'check_status',
    label: 'Check current Copilot readiness',
    command: STATUS_COMMAND,
    tool: '',
    args: null,
    owner: 'anyone',
    risk: 'safe',
  };
}

function workflowSkillIdInput() {
  return [
    {
      name: 'skillId',
      label: 'Workflow draft skill id',
      source: 'settings.workflowPromotionSkillId',
      placeholder: '<workflow-draft-skill-id>',
    },
  ];
}

function workbenchLoginActions() {
  return [
    {
      id: 'open_login_and_wait_e2e',
      label: 'Open Workbench login and validate',
      command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
      tool: '',
      args: null,
      owner: 'user',
      risk: 'safe',
    },
    {
      id: 'wait_login_e2e',
      label: 'Validate after Workbench login',
      command: WORKBENCH_WAIT_LOGIN_COMMAND,
      tool: '',
      args: null,
      owner: 'user',
      risk: 'safe',
    },
  ];
}

function workflowPromotionActions() {
  const requiredInputs = workflowSkillIdInput();
  return [
    statusAction(),
    {
      id: 'run_workflow_draft_smoke',
      label: 'Validate workflow draft lifecycle',
      command: WORKFLOW_DRAFT_SMOKE_COMMAND,
      tool: '',
      args: null,
      owner: 'admin',
      risk: 'safe',
    },
    {
      id: 'promote_workbench_preset_preflight',
      label: 'Preflight a Workbench preset promotion',
      command: '',
      tool: 'ac.workflow.promote_workbench_preset',
      args: { skillId: '<workflow-draft-skill-id>', requireAdminConfirmation: true },
      requiredInputs: clone(requiredInputs),
      owner: 'admin',
      risk: 'confirm-risk',
    },
    {
      id: 'promote_script_hub_tool_preflight',
      label: 'Preflight a Workflow tool promotion',
      command: '',
      tool: 'ac.workflow.promote_script_hub_tool',
      args: { skillId: '<workflow-draft-skill-id>', requireAdminConfirmation: true },
      requiredInputs: clone(requiredInputs),
      owner: 'admin',
      risk: 'confirm-risk',
    },
  ];
}

function usageGovernanceActions() {
  return [
    statusAction(),
    {
      id: 'probe_quota_policy',
      label: 'Probe team quota policy',
      command: '',
      tool: 'ac.usage.probe_quota_policy',
      args: {},
      owner: 'admin',
      risk: 'safe',
    },
    {
      id: 'dry_run_usage_upload',
      label: 'Dry-run usage cloud upload',
      command: '',
      tool: 'ac.usage.upload_cloud_draft',
      args: { dryRun: true, days: 1, limit: 5000 },
      owner: 'admin',
      risk: 'confirm-risk',
    },
    {
      id: 'open_workbench_login',
      label: 'Open embedded Workbench login',
      command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
      tool: '',
      args: null,
      owner: 'user',
      risk: 'safe',
    },
  ];
}

module.exports = {
  STATUS_COMMAND,
  WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
  WORKBENCH_WAIT_LOGIN_COMMAND,
  statusAction,
  workbenchLoginActions,
  workflowPromotionActions,
  usageGovernanceActions,
};
