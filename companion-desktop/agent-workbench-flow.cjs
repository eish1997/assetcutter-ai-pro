'use strict';

const WORKBENCH_FLOW_RESOURCE_URI = 'assetcutter://mcp/workbench-flow';

const WORKBENCH_REQUIRED_TOOLS = [
  'ac.workbench.ensure_ready',
  'ac.workbench.get_context',
  'ac.workbench.create_project',
  'ac.workbench.open_project',
  'ac.workbench.run_capability',
  'ac.workbench.create_text_asset',
  'ac.workbench.create_image_asset',
  'ac.workbench.list_assets',
  'ac.workbench.get_asset',
];

const WORKBENCH_E2E_REQUIRED_TOOLS = [
  'ac.workbench.ensure_ready',
  'ac.workbench.get_context',
  'ac.workbench.create_project',
  'ac.workbench.run_capability',
  'ac.workbench.list_assets',
  'ac.workbench.get_asset',
];

const WORKBENCH_CANONICAL_FLOW = [
  {
    id: 'ready',
    tool: 'ac.workbench.ensure_ready',
    required: true,
    arguments: { requireProject: false },
    successSignals: ['structuredContent.ready is true or context is returned'],
    onFailure: {
      AGENT_AUTH_REQUIRED:
        'Call ac.shell.navigate with { view: "workbench" }, let the user log in, then retry ensure_ready.',
      AGENT_WORKBENCH_BRIDGE: 'Keep Copilot open and reload the workbench view before retrying.',
    },
  },
  {
    id: 'context',
    tool: 'ac.workbench.get_context',
    required: true,
    successSignals: ['projects and capabilityPresets are available in structuredContent'],
  },
  {
    id: 'project',
    tool: 'ac.workbench.create_project or ac.workbench.open_project',
    required: 'when no active project is available',
    successSignals: ['projectId is returned or activeProjectId is set'],
  },
  {
    id: 'capability',
    tool: 'ac.workbench.run_capability or ac.workbench.create_text_asset or ac.workbench.create_image_asset',
    required: true,
    constraints: [
      'For a plain text note in the open project, prefer ac.workbench.create_text_asset with { text }.',
      'To import a local image into the open project, prefer ac.workbench.create_image_asset with { localPath } (absolute path). Do not convert the file to base64 for the tool call.',
      'For capability presets, choose a preset with directRunSupported=true.',
      'Use inputText for text-capable presets.',
      'Use imageDataUrl for direct image input to run_capability (generation), not as a substitute for create_image_asset import.',
      'Use inputAssetId or inputAssetDisplayKey when chaining from an existing workbench asset.',
    ],
    successSignals: ['assetId (and resultKey when applicable) are returned'],
  },
  {
    id: 'verify-list',
    tool: 'ac.workbench.list_assets',
    required: true,
    successSignals: ['created assetId appears in assets'],
  },
  {
    id: 'verify-detail',
    tool: 'ac.workbench.get_asset',
    required: true,
    successSignals: ['asset detail includes text, media, or resultMeta'],
  },
];

const WORKBENCH_RECOVERY_CONTRACT = {
  authRequired:
    'Workbench browser session is not logged in; call ac.shell.navigate({ view: "workbench" }), let the user log in, then retry the failed workbench tool.',
  requiresFrontendAuthorization: 'Keep Copilot visible so the user can approve or reject the requested action.',
  projectRequired: 'Create or open a project before running capabilities.',
  requiresInput: 'Read requiredInput/details and provide imageDataUrl, inputAssetId, inputAssetDisplayKey, or inputText.',
  presetNotRunnable: 'Choose a preset with directRunSupported=true from ensure_ready/get_context.',
  assetNotFound: 'Call list_assets again and use a current assetId.',
  retryable: 'Retry after following nextStep; preserve traceId/idempotencyKey when present.',
};

const WORKBENCH_E2E_GATES = {
  inProduct: 'Companion Settings -> External Agent (MCP) -> 工作台验收',
  cli: 'npm run smoke:agent-mcp:e2e -- --config <codex-mcp-import.json>',
  accountPrerequisite: {
    source: 'assetcutter://mcp/server-status',
    field: 'readiness.account.loggedIn',
    expected: true,
    partition: 'persist:assetcutter-team',
    recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
    recovery:
      'If readiness.account.loggedIn is false, open the embedded Workbench view, let the user log in, then retry the E2E chain.',
  },
  passingChain: ['ensure_ready', 'create/open project', 'run_capability', 'list_assets', 'get_asset'],
};

function workbenchStandardFlowText() {
  return 'ac.workbench.ensure_ready -> ac.workbench.get_context/create_project/open_project -> (ac.workbench.create_text_asset | ac.workbench.create_image_asset | ac.workbench.run_capability) -> ac.workbench.list_assets -> ac.workbench.get_asset';
}

function buildWorkbenchFlowDocument() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose:
      'Canonical contract for external agents and Copilot brains that operate the AssetCutter workbench through MCP.',
    requiredTools: [...WORKBENCH_REQUIRED_TOOLS],
    canonicalFlow: WORKBENCH_CANONICAL_FLOW.map((step) => ({ ...step })),
    recoveryContract: { ...WORKBENCH_RECOVERY_CONTRACT },
    e2eGates: { ...WORKBENCH_E2E_GATES },
    accountReadiness: {
      partition: 'persist:assetcutter-team',
      statusResources: ['assetcutter://mcp/server-status'],
      statusTools: ['ac.shell.get_state'],
      requiredBeforeE2e: true,
      fields: ['loggedIn', 'partition', 'cookieCount', 'hasAuthCookie', 'migration', 'nextStep'],
    },
    extensionGuidance: {
      addWorkbenchTool:
        'Add the schema to agent-tool-schemas.cjs, dispatch in agent-body-host.cjs/client bridge, add successSignals to tool-catalog, and extend agent-workbench-flow.cjs if it changes the canonical chain.',
      addWorkflow:
        'Save reusable workflows as skills/prompts that start with ensure_ready and declare toolHints for required ac.workbench.* tools.',
    },
  };
}

module.exports = {
  WORKBENCH_FLOW_RESOURCE_URI,
  WORKBENCH_REQUIRED_TOOLS,
  WORKBENCH_E2E_REQUIRED_TOOLS,
  WORKBENCH_RECOVERY_CONTRACT,
  WORKBENCH_E2E_GATES,
  WORKBENCH_CANONICAL_FLOW,
  buildWorkbenchFlowDocument,
  workbenchStandardFlowText,
};
