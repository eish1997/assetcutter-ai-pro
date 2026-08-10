import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  VALID_SHELL_VIEWS,
  validateArgs,
  buildToolCatalog,
} = require('../companion-desktop/agent-body-host.cjs');

describe('agent P0 tool schemas', () => {
  it('registers exactly four P0 ac.* tools', () => {
    expect(P0_TOOL_SCHEMAS).toHaveLength(4);
    for (const t of P0_TOOL_SCHEMAS) {
      expect(t.name.startsWith('ac.')).toBe(true);
      expect(t.risk).toBe('safe');
    }
    const names = P0_TOOL_SCHEMAS.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'ac.shell.navigate',
      'ac.shell.get_state',
      'ac.shell.login',
      'ac.companion.runtime_status',
    ]);
  });

  it('navigate view enum matches shell views', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    expect(nav).toBeTruthy();
    const enumValues: string[] = nav.inputSchema.properties.view.enum;
    for (const v of enumValues) {
      expect(VALID_SHELL_VIEWS.has(v)).toBe(true);
    }
    expect(enumValues).toContain('scripts');
    expect(enumValues).toContain('connections');
  });

  it('validateArgs rejects unknown navigate view', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'not-a-view' });
    expect(r.ok).toBe(false);
  });

  it('validateArgs accepts scripts navigate', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'scripts' });
    expect(r.ok).toBe(true);
    expect(r.value.view).toBe('scripts');
  });
});

describe('agent P1 tool schemas', () => {
  it('registers forty-five P1 tools', () => {
    expect(P1_TOOL_SCHEMAS).toHaveLength(45);
    expect(P1_TOOL_SCHEMAS.some((tool: { name: string }) => tool.name === 'ac.capability.template_draft_create')).toBe(true);
  });

  it('ALL_TOOL_SCHEMAS combines P0 P1 P2', () => {
    expect(ALL_TOOL_SCHEMAS).toHaveLength(61);
  });

  it('buildToolCatalog groups tools by surface and summarizes risk', () => {
    const catalog = buildToolCatalog(ALL_TOOL_SCHEMAS);
    expect(catalog.total).toBe(61);
    expect(catalog.riskCounts.safe).toBeGreaterThan(0);
    expect(catalog.riskCounts.confirm).toBeGreaterThan(0);
    const workbench = catalog.surfaces.find((s: { id: string }) => s.id === 'workbench');
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.ensure_ready')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.create_project')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.list_assets')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.get_asset')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.run_capability')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.create_text_asset')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.create_image_asset')).toBe(true);
    const ensureReady = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.ensure_ready');
    expect(ensureReady?.risk).toBe('safe');
    expect(ensureReady?.title).toBe('准备工作台');
    expect(ensureReady?.inputSchema.properties.createIfMissing).toBeTruthy();
    const createProject = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.create_project');
    expect(createProject?.risk).toBe('safe');
    expect(createProject?.title).toBe('创建项目');
    const listAssets = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.list_assets');
    expect(listAssets?.risk).toBe('safe');
    expect(listAssets?.title).toBe('列出资产');
    const getAsset = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.get_asset');
    expect(getAsset?.risk).toBe('safe');
    expect(getAsset?.input.required).toContain('assetId');
    const runCapability = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.run_capability');
    expect(runCapability?.risk).toBe('confirm');
    expect(runCapability?.input.required).toContain('presetId');
    expect(runCapability?.inputSchema.properties.imageDataUrl).toBeTruthy();
    expect(runCapability?.inputSchema).toBeTruthy();
    expect(runCapability?.title).toBe('执行工作台能力');
    expect(runCapability?.whenToUse).toContain('能力预设');
    expect(runCapability?.exampleArguments.presetId).toBe('preset-id');
    expect(runCapability?.successSignals[0]).toContain('run_capability');
    const createTextAsset = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.create_text_asset');
    expect(createTextAsset?.risk).toBe('confirm');
    expect(createTextAsset?.input.required).toContain('text');
    expect(createTextAsset?.title).toContain('文本');
    expect(createTextAsset?.whenToUse).toContain('Do not use for creating tools');
    const createImageAsset = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.create_image_asset');
    expect(createImageAsset?.risk).toBe('confirm');
    expect(createImageAsset?.input.required || []).not.toContain('imageDataUrl');
    expect(createImageAsset?.inputSchema.properties.localPath).toBeTruthy();
    expect(createImageAsset?.title).toContain('图片');
    const shell = catalog.surfaces.find((s: { id: string }) => s.id === 'shell');
    const scaffold = shell?.tools.find((t: { name: string }) => t.name === 'ac.shell_tool.scaffold');
    expect(scaffold?.whenToUse).toContain('Maya plugin');
    const companion = catalog.surfaces.find((s: { id: string }) => s.id === 'companion');
    const createCapabilityDraft = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.draft_create');
    expect(createCapabilityDraft?.risk).toBe('confirm');
    expect(createCapabilityDraft?.input.required).toEqual(['name']);
    expect(createCapabilityDraft?.whenToUse).toContain('CapabilityPackage(type=software_connection)');
    expect(createCapabilityDraft?.whenToUse).toContain('do not restore the old 62-host default catalog');
    expect(createCapabilityDraft?.inputSchema.properties.type.enum).toEqual(['software_connection', 'tool', 'workflow']);
    expect(validateArgs(createCapabilityDraft?.inputSchema, { name: 'Photoshop', type: 'host' }).ok).toBe(false);
    expect(validateArgs(createCapabilityDraft?.inputSchema, { name: '随机选择', type: 'tool' }).ok).toBe(true);
    const createUnifiedCapability = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.create_draft');
    expect(createUnifiedCapability?.risk).toBe('confirm');
    expect(createUnifiedCapability?.input.required).toEqual(['name', 'intent']);
    expect(createUnifiedCapability?.whenToUse).toContain('do not create Workbench text assets');
    expect(createUnifiedCapability?.inputSchema.properties.type.enum).toEqual(['software_connection', 'tool', 'workflow']);
    expect(validateArgs(createUnifiedCapability?.inputSchema, { name: '随机选择工具', intent: '做一个随机选择工具', type: 'tool' }).ok).toBe(true);
    expect(validateArgs(createUnifiedCapability?.inputSchema, { name: '随机选择工具', type: 'tool' }).ok).toBe(false);
    const listCapabilityDrafts = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.draft_list');
    expect(listCapabilityDrafts?.risk).toBe('safe');
    expect(listCapabilityDrafts?.successSignals[0]).toContain('不是旧 62 宿主 catalog');
    const validateCapabilityDraft = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.validate_draft');
    expect(validateCapabilityDraft?.risk).toBe('safe');
    expect(validateCapabilityDraft?.input.required).toEqual(['id']);
    const getCapabilityContext = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.context_get');
    expect(getCapabilityContext?.risk).toBe('safe');
    expect(getCapabilityContext?.input.required).toEqual(['id']);
    expect(getCapabilityContext?.whenToUse).toContain('must not mix different connections or tools');
    const appendCapabilityEvent = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.event_append');
    expect(appendCapabilityEvent?.risk).toBe('confirm');
    expect(appendCapabilityEvent?.input.required).toEqual(['id', 'kind']);
    expect(appendCapabilityEvent?.whenToUse).toContain('Do not use it to mark real probe success');
    const runCapabilityLifecycle = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.lifecycle_run');
    expect(runCapabilityLifecycle?.risk).toBe('confirm');
    expect(runCapabilityLifecycle?.input.required).toEqual(['id', 'action']);
    expect(runCapabilityLifecycle?.inputSchema.properties.action.enum).toContain('open_conversation');
    expect(runCapabilityLifecycle?.inputSchema.properties.action.enum).toEqual(
      expect.arrayContaining(['launch', 'close', 'discover_running']),
    );
    expect(runCapabilityLifecycle?.inputSchema.properties.executablePath).toBeTruthy();
    expect(runCapabilityLifecycle?.inputSchema.properties.targetId).toBeTruthy();
    expect(runCapabilityLifecycle?.inputSchema.properties.versionNote).toBeTruthy();
    const connectionLoop = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.connection_loop_run');
    expect(connectionLoop?.risk).toBe('confirm');
    expect(connectionLoop?.input.required).toEqual(['id', 'goal', 'permissions']);
    expect(connectionLoop?.whenToUse).toContain('PI-style');
    expect(connectionLoop?.inputSchema.properties.permissions.items.enum).toEqual(
      expect.arrayContaining(['context.read', 'process.discover', 'process.launch', 'bridge.install', 'connection.probe', 'event.write']),
    );
    expect(validateArgs(connectionLoop?.inputSchema, { id: 'photoshop', goal: 'connect it', permissions: ['context.read', 'connection.probe'] }).ok).toBe(true);
    expect(validateArgs(connectionLoop?.inputSchema, { id: 'photoshop', goal: 'connect it' }).ok).toBe(false);
    const publishGate = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.publish_gate_check');
    expect(publishGate?.risk).toBe('safe');
    expect(publishGate?.input.required).toEqual(['id', 'versionNote']);
    expect(publishGate?.whenToUse).toContain('real probe');
    const publishCloud = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.publish_cloud');
    expect(publishCloud?.risk).toBe('confirm');
    expect(publishCloud?.input.required).toEqual(['id', 'versionNote']);
    expect(publishCloud?.whenToUse).toContain('require real probe');
    expect(runCapabilityLifecycle?.successSignals[0]).toContain('工具 run');
    const installCapability = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.install');
    expect(installCapability?.risk).toBe('confirm');
    expect(installCapability?.input.required).toEqual(['id']);
    expect(installCapability?.successSignals[0]).toContain('这不等于连接成功');
    const probeCapability = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.probe');
    expect(probeCapability?.risk).toBe('safe');
    expect(probeCapability?.whenToUse).toContain('real heartbeat/host signal');
    const uninstallCapability = companion?.tools.find((t: { name: string }) => t.name === 'ac.capability.uninstall');
    expect(uninstallCapability?.risk).toBe('confirm');
    const createHostDraft = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.create_draft');
    expect(createHostDraft?.risk).toBe('confirm');
    expect(createHostDraft?.deprecated).toBe(true);
    expect(createHostDraft?.input.required).toContain('name');
    expect(createHostDraft?.description).toContain('Legacy recovery/debug');
    expect(createHostDraft?.description).toContain('ac.capability.create_draft');
    expect(createHostDraft?.whenToUse).toContain('new host application integration');
    expect(createHostDraft?.whenToUse).toContain('prefer ac.capability.create_draft');
    expect(createHostDraft?.whenToUse).toContain('do not ask the user to choose a technical template');
    expect(createHostDraft?.inputSchema.properties.templateId).toBeUndefined();
    expect(validateArgs(createHostDraft?.inputSchema, { name: 'Spine', templateId: 'lua_heartbeat' }).ok).toBe(false);
    const legacyHostBridgeTools = companion?.tools.filter((t: { name: string }) =>
      t.name.startsWith('ac.companion.host_bridge.'),
    );
    expect(legacyHostBridgeTools?.length).toBeGreaterThan(0);
    for (const tool of legacyHostBridgeTools || []) {
      expect(tool.deprecated).toBe(true);
      expect(`${tool.description}\n${tool.whenToUse}`).toContain('Legacy');
    }
    const bodyHost = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'companion-desktop/agent-body-host.cjs'), 'utf8');
    expect(bodyHost).toContain("type: 'tool'");
    expect(bodyHost).toContain("authoredToolId: String(toolId)");
    expect(bodyHost).toContain("'/v1/capability-packages/drafts'");
    expect(bodyHost).toContain("name === 'ac.capability.publish_gate_check'");
    expect(bodyHost).toContain("name === 'ac.capability.create_draft'");
    expect(bodyHost).toContain("inferCapabilityDraftType");
    expect(bodyHost).toContain("name === 'ac.capability.validate_draft'");
    expect(bodyHost).toContain("name === 'ac.capability.publish_cloud'");
    expect(bodyHost).toContain("action: 'publish'");
    expect(bodyHost).toContain('/publish-gate');
    const installHostBridge = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.install');
    expect(installHostBridge?.risk).toBe('confirm');
    expect(installHostBridge?.input.required).toEqual(['id', 'targetDir']);
    expect(bodyHost).toContain('buildHostBridgeInstallBody');
    expect(bodyHost).toContain('HOST_BRIDGE_INSTALL_TARGET_FIELDS');
    expect(bodyHost).toContain("unity: ['projectDirs']");
    expect(bodyHost).toContain("const fields = HOST_BRIDGE_INSTALL_TARGET_FIELDS[id] || ['scriptsDirs']");
    const probeHostBridge = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.probe');
    expect(probeHostBridge?.risk).toBe('safe');
    expect(probeHostBridge?.input.required).toEqual(['id']);
    const acceptanceStatus = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.acceptance_status');
    expect(acceptanceStatus?.risk).toBe('safe');
    expect(acceptanceStatus?.input.required).toEqual([]);
    expect(acceptanceStatus?.whenToUse).toContain('real-software bridge acceptance');
    expect(bodyHost).toContain("name === 'ac.companion.host_bridge.acceptance_status'");
    expect(bodyHost).toContain("deps.companionApiRequest('GET', '/v1/bridges'");
    expect(bodyHost).toContain('missingGroups');
    expect(bodyHost).toContain('nextActions');
    expect(bodyHost).toContain('hostBridgeAcceptanceInstruction');
    expect(bodyHost).toContain('steps: group.steps');
    expect(bodyHost).toContain('evidence: group.evidence');
    expect(bodyHost).toContain('只在真实软件启动并产生 HTTP health');
    const launchHost = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.launch_host');
    expect(launchHost?.risk).toBe('confirm');
    expect(launchHost?.input.required).toEqual(['id']);
    expect(launchHost?.inputSchema.properties.executablePath).toBeTruthy();
    expect(launchHost?.inputSchema.properties.versionId).toBeTruthy();
    expect(launchHost?.inputSchema.properties.targetId).toBeTruthy();
    const closeHost = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.close_host');
    expect(closeHost?.risk).toBe('confirm');
    expect(closeHost?.input.required).toEqual(['id']);
    const discoverRunningHost = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.discover_running_host');
    expect(discoverRunningHost?.risk).toBe('confirm');
    expect(discoverRunningHost?.input.required).toEqual(['id']);
    expect(discoverRunningHost?.whenToUse).toContain('already open/running');
    const uninstallHostBridge = companion?.tools.find((t: { name: string }) => t.name === 'ac.companion.host_bridge.uninstall');
    expect(uninstallHostBridge?.risk).toBe('confirm');
    expect(uninstallHostBridge?.input.required).toEqual(['id']);
    expect(catalog.recommendedFlow[0]).toContain('ac.shell.get_state');
  });
});
