import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendCapabilityPackageEvent,
  createCapabilityPackageDraft,
  deleteCapabilityPackageDraft,
  readCapabilityPackageDraft,
  readCapabilityPackageDrafts,
  updateCapabilityPackageDraft,
} from '../local-companion/src/capabilities/capabilityPackageStore.ts';
import {
  installCapabilityPackage,
  probeCapabilityPackage,
  runCapabilityLifecycle,
  uninstallCapabilityPackage,
} from '../local-companion/src/capabilities/capabilityLifecycle.ts';
import { buildCapabilityPackageContext } from '../local-companion/src/capabilities/capabilityContext.ts';
import { checkCapabilityPublishGate } from '../local-companion/src/capabilities/capabilityPublishGate.ts';
import {
  activeCapabilityCloudPackage,
  listActiveCapabilityCloudPackages,
  listCapabilityCloudVersions,
  publishCapabilityDraftToCloud,
  switchCapabilityCloudVersion,
} from '../local-companion/src/capabilities/capabilityCloudVersions.ts';
import {
  exportCapabilityPackageTransfer,
  importCapabilityPackageTransfer,
} from '../local-companion/src/capabilities/capabilityTransfer.ts';
import {
  normalizeCapabilityId,
  validateCapabilityPackage,
} from '../local-companion/src/capabilities/capabilityPackages.ts';
import { deriveSoftwareConnectionState } from '../local-companion/src/capabilities/softwareConnectionState.ts';
import {
  buildConnectionTemplateDraft,
  softwareConnectionDraftToCapabilityPackage,
} from '../local-companion/src/capabilities/softwareConnectionAdapter.ts';
import { BLENDER_BRIDGE_STARTUP_NAME } from '../local-companion/src/bridges/blenderBridgeInstall.ts';
import { toolManifestToCapabilityPackage } from '../local-companion/src/capabilities/toolPackageAdapter.ts';
import { workflowDraftToCapabilityPackage } from '../local-companion/src/capabilities/workflowPackageAdapter.ts';
import { summarizeWorkflowConnectors } from '../local-companion/src/capabilities/workflowConnectorSummary.ts';
import { mayaExportSelectionFbxWorkflowSkill } from '../local-companion/src/workflows/runtime/workflowSkills.ts';

describe('capability packages', () => {
  it('validates the minimal package shape', () => {
    const pkg = softwareConnectionDraftToCapabilityPackage({
      name: 'Photoshop',
      templateHint: 'extendscript_heartbeat',
    });
    expect(validateCapabilityPackage(pkg)).toEqual({ ok: true, errors: [] });
    expect(pkg.type).toBe('software_connection');
    expect(pkg.source).toBe('draft');
    expect(pkg.conversation.sessionId).toBe('capability:software_connection:photoshop');
    expect(pkg.governance.requiresRealProbeToPublish).toBe(true);
  });

  it('rejects incomplete or unknown package shapes', () => {
    expect(validateCapabilityPackage(null).errors).toContain('capability_package_required');
    expect(
      validateCapabilityPackage({
        id: 'bad package',
        type: 'host',
        source: 'draft',
        name: '',
        manifest: {},
        lifecycle: {},
        conversation: {},
        governance: {},
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        'invalid_id',
        'invalid_type',
        'name_required',
        'conversation_session_required',
        'governance_requiresAdminToPublish_required',
      ]),
    );
  });

  it('maps shell tools to tool capability packages', () => {
    const pkg = toolManifestToCapabilityPackage({
      id: 'random-selector',
      name: '随机选择',
      description: '从列表里随机选择一个条目',
      tags: ['效率'],
      semver: '0.2.0',
    });
    expect(pkg.type).toBe('tool');
    expect(pkg.id).toBe('random-selector');
    expect(pkg.manifest.kind).toBe('shell_tool');
    expect(pkg.lifecycle.run).toBe('tool.run');
    expect(pkg.governance.requiresRealProbeToPublish).toBe(false);
  });

  it('maps software connection drafts without depending on the legacy host catalog', () => {
    const pkg = softwareConnectionDraftToCapabilityPackage({
      name: 'Photoshop',
      templateHint: 'extendscript_heartbeat',
      tags: ['图像'],
    });
    expect(pkg.type).toBe('software_connection');
    expect(pkg.manifest.kind).toBe('software_connection');
    expect(pkg.manifest.appName).toBe('Photoshop');
    expect(pkg.manifest.templateHint).toBe('extendscript_heartbeat');
    expect(JSON.stringify(pkg)).not.toContain('HOST_CENTER_FALLBACK_CATALOG');
  });

  it('builds non-production connection template drafts for unsupported hosts', () => {
    const draft = buildConnectionTemplateDraft({
      hostId: 'spine',
      appName: 'Spine',
      kind: 'script_dcc',
      files: ['bridges/spineBridgeInstall.ts', 'bridges/templates/spine-heartbeat.js'],
      requiredUserDirs: ['Spine scripts directory'],
      probeSignal: 'Spine 脚本写入的新鲜 heartbeat 文件',
      safetyBoundaries: ['必须真实运行 Spine 脚本后才能 probe 成功'],
    });

    expect(draft).toMatchObject({
      schemaVersion: 1,
      status: 'draft',
      hostId: 'spine',
      appName: 'Spine',
      kind: 'script_dcc',
      probeSignal: 'Spine 脚本写入的新鲜 heartbeat 文件',
      productionDefinition: false,
    });
    expect(draft.files).toContain('bridges/spineBridgeInstall.ts');
    expect(draft.requiredUserDirs).toContain('Spine scripts directory');
    expect(draft.safetyBoundaries.join('\n')).toContain('真实运行 Spine');

    const autoDraft = buildConnectionTemplateDraft({
      hostId: 'blender',
      appName: 'Blender',
      kind: 'script_dcc',
    });
    expect(autoDraft.files).toEqual([
      'local-companion/src/bridges/blenderBridgeInstall.ts',
      'local-companion/src/bridges/templates/blender-heartbeat.js',
    ]);
    expect(autoDraft.requiredUserDirs).toContain('宿主脚本目录或用户插件目录');
    expect(autoDraft.probeSignal).toContain('Blender 内运行脚本');
    expect(autoDraft.safetyBoundaries.join('\n')).toContain('未真实验收前不能写入生产 bridge definition');

    const projectDraft = buildConnectionTemplateDraft({
      hostId: 'unreal',
      appName: 'Unreal',
      kind: 'project_plugin',
    });
    expect(projectDraft.requiredUserDirs).toContain('真实项目根目录');
    expect(projectDraft.probeSignal).toContain('项目插件加载后');
  });

  it('maps workflow drafts to first-class capability packages without enabling a fake runner', () => {
    const pkg = workflowDraftToCapabilityPackage({
      id: 'daily-export-flow',
      name: 'Daily Export Flow',
      description: 'Export assets, validate output, then notify the user.',
      tags: ['automation'],
      manifest: { steps: ['export', 'validate', 'notify'] },
    });
    expect(validateCapabilityPackage(pkg)).toEqual({ ok: true, errors: [] });
    expect(pkg.type).toBe('workflow');
    expect(pkg.manifest.kind).toBe('workflow');
    expect(pkg.conversation.sessionId).toBe('capability:workflow:daily-export-flow');
    expect(pkg.lifecycle.run).toBe('workflow.run');
    expect(pkg.governance.requiresRealProbeToPublish).toBe(false);
  });

  it('summarizes workflow connector dependencies from software connection packages', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-workflow-connector-summary-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      expect(summarizeWorkflowConnectors(mayaExportSelectionFbxWorkflowSkill)).toEqual([
        expect.objectContaining({
          capabilityPackageId: 'maya',
          label: '连接未配置',
          status: 'unknown',
        }),
      ]);

      const created = createCapabilityPackageDraft({
        id: 'maya',
        type: 'software_connection',
        name: 'Maya',
        manifest: { executablePath: 'C:/Program Files/Autodesk/Maya/maya.exe' },
      });
      expect(created.ok).toBe(true);
      expect(summarizeWorkflowConnectors(mayaExportSelectionFbxWorkflowSkill)).toEqual([
        expect.objectContaining({
          capabilityPackageId: 'maya',
          status: 'warning',
          title: 'Maya Connector',
        }),
      ]);
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes user-facing names into stable package ids', () => {
    expect(normalizeCapabilityId('Adobe Photoshop 2025 连接')).toBe('adobe-photoshop-2025');
  });

  it('derives product maturity for software connection packages', () => {
    const draft = softwareConnectionDraftToCapabilityPackage({ name: 'Unknown App' });
    expect(deriveSoftwareConnectionState(draft)).toMatchObject({
      maturity: 'draft',
      publishEligible: false,
    });

    const pathReady = softwareConnectionDraftToCapabilityPackage({
      name: 'Unknown App',
      manifest: { executablePath: 'C:\\Tools\\Unknown.exe' },
    });
    expect(deriveSoftwareConnectionState(pathReady)).toMatchObject({
      maturity: 'path_ready',
      label: '已找到位置',
    });

    const missingTemplate = softwareConnectionDraftToCapabilityPackage({
      name: 'Spine',
      manifest: { hostId: 'spine', executablePath: 'C:\\Spine\\Spine.exe' },
    });
    expect(deriveSoftwareConnectionState(missingTemplate)).toMatchObject({
      maturity: 'template_missing',
      blockedReason: '当前软件还没有接入真实安装/探测模板。',
    });
    expect(deriveSoftwareConnectionState(missingTemplate).availableActions).toEqual(
      expect.arrayContaining(['agent_loop', 'discover_running', 'launch']),
    );
    expect(deriveSoftwareConnectionState(missingTemplate).availableActions).not.toContain('probe');

    const bridgeSupported = softwareConnectionDraftToCapabilityPackage({
      name: 'Photoshop',
      templateHint: 'extendscript_heartbeat',
    });
    expect(deriveSoftwareConnectionState(bridgeSupported)).toMatchObject({
      maturity: 'bridge_supported',
      label: '可安装连接',
    });
    expect(deriveSoftwareConnectionState(bridgeSupported).availableActions).toEqual(
      expect.arrayContaining(['install', 'probe', 'uninstall']),
    );

    const installed = { ...bridgeSupported, lastInstall: { ok: true } };
    expect(deriveSoftwareConnectionState(installed)).toMatchObject({
      maturity: 'bridge_installed',
      publishEligible: false,
    });

    const probeFailed = { ...installed, lastProbe: { ok: false } };
    expect(deriveSoftwareConnectionState(probeFailed)).toMatchObject({
      maturity: 'probe_failed',
      blockedReason: '未收到真实软件连接信号。',
    });

    const connected = { ...installed, lastProbe: { ok: true } };
    expect(deriveSoftwareConnectionState(connected)).toMatchObject({
      maturity: 'connected',
      label: '已连接',
      publishEligible: true,
    });
  });

  it('returns connectionState only for software connection object contexts', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-connection-state-context-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const connection = createCapabilityPackageDraft({
        id: 'spine',
        type: 'software_connection',
        name: 'Spine',
        manifest: { hostId: 'spine', executablePath: 'C:\\Spine\\Spine.exe' },
      });
      const tool = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: 'Random Selector',
        manifest: { authoredToolId: 'random-selector' },
      });
      const workflow = createCapabilityPackageDraft({
        id: 'daily-export-flow',
        type: 'workflow',
        name: 'Daily Export Flow',
        manifest: { steps: [] },
      });
      expect(connection.ok).toBe(true);
      expect(tool.ok).toBe(true);
      expect(workflow.ok).toBe(true);

      const connectionContext = buildCapabilityPackageContext('spine');
      const toolContext = buildCapabilityPackageContext('random-selector');
      const workflowContext = buildCapabilityPackageContext('daily-export-flow');
      expect(connectionContext.ok).toBe(true);
      expect(toolContext.ok).toBe(true);
      expect(workflowContext.ok).toBe(true);
      if (!connectionContext.ok) throw new Error(connectionContext.error);
      if (!toolContext.ok) throw new Error(toolContext.error);
      if (!workflowContext.ok) throw new Error(workflowContext.error);

      expect(connectionContext.connectionState).toMatchObject({
        maturity: 'template_missing',
        label: '模板待接入',
      });
      expect(connectionContext.contextPrompt).toContain('connectionState');
      expect(connectionContext.contextPrompt).toContain('Connection maturity: template_missing');
      expect('connectionState' in toolContext).toBe(false);
      expect('connectionState' in workflowContext).toBe(false);
      expect(toolContext.contextPrompt).not.toContain('Connection maturity:');
      expect(workflowContext.contextPrompt).not.toContain('Connection maturity:');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns template_missing for unsupported bridge lifecycle actions', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-template-missing-lifecycle-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'spine',
        type: 'software_connection',
        name: 'Spine',
        manifest: { hostId: 'spine', executablePath: 'C:/Spine/Spine.exe' },
      });
      expect(created.ok).toBe(true);

      const installed = await installCapabilityPackage('spine');
      expect(installed).toMatchObject({
        ok: false,
        error: 'template_missing',
        message: '当前软件还没有接入真实安装/探测模板。',
        nextAction: '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。',
      });
      if (!installed.ok) expect(installed.supportedActions).toEqual(expect.arrayContaining(['agent_loop', 'discover_running', 'launch']));

      const probed = await runCapabilityLifecycle('spine', 'probe');
      expect(probed).toMatchObject({
        ok: false,
        action: 'probe',
        error: 'template_missing',
      });
      if (!probed.ok) expect(probed.supportedActions).not.toContain('probe');

      const uninstalled = await uninstallCapabilityPackage('spine');
      expect(uninstalled).toMatchObject({
        ok: false,
        error: 'template_missing',
      });

      const draft = readCapabilityPackageDraft('spine');
      expect(draft?.events?.filter((event) => event.kind === 'template_missing')).toHaveLength(3);

      const context = buildCapabilityPackageContext('spine');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.connectionState).toMatchObject({ maturity: 'template_missing', label: '模板待接入' });
      expect(context.contextPrompt).toContain('Template missing:');
      expect(context.contextPrompt).toContain('ac.capability.template_draft_create');
      expect(context.contextPrompt).toContain('executable, script_dcc, project_plugin, command_port, heartbeat, or unknown');
      expect(context.contextPrompt).toContain('real bridge install/probe/uninstall is not connected yet');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps connection loop failure events in the object context for repair', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-connection-loop-context-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'spine',
        type: 'software_connection',
        name: 'Spine',
        manifest: { hostId: 'spine', executablePath: 'C:/Spine/Spine.exe' },
      });
      expect(created.ok).toBe(true);
      appendCapabilityPackageEvent('spine', {
        kind: 'connection_loop_failed',
        ok: false,
        message: '连接 loop 未收到真实探测信号',
        detail: { maturity: 'probe_failed', plannedSteps: ['connection.probe', 'event.write.loop_summary'] },
      });

      const context = buildCapabilityPackageContext('spine');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.recentEvents).toContainEqual(
        expect.objectContaining({ kind: 'connection_loop_failed', ok: false, message: '连接 loop 未收到真实探测信号' }),
      );
      expect(context.contextPrompt).toContain('latestFailure:');
      expect(context.contextPrompt).toContain('connection_loop_failed');
      expect(context.contextPrompt).toContain('连接 loop 未收到真实探测信号');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists Copilot-created software connection drafts as capability packages', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-drafts-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        name: 'Photoshop',
        type: 'software_connection',
        tags: ['图像'],
        templateHint: 'extendscript_heartbeat',
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      expect(created.draft.type).toBe('software_connection');
      expect(created.draft.source).toBe('draft');
      expect(created.draft.conversation.sessionId).toBe('capability:software_connection:photoshop');

      const drafts = readCapabilityPackageDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe('photoshop');
      expect(readCapabilityPackageDraft('photoshop')?.manifest.kind).toBe('software_connection');
      expect(deleteCapabilityPackageDraft('photoshop')).toBe(true);
      expect(readCapabilityPackageDrafts()).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists Copilot-created tools as tool capability packages', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-tool-capability-drafts-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: '随机选择',
        description: '从列表里随机选择一个条目',
        tags: ['效率'],
        semver: '0.1.0',
        manifest: { authoredToolId: 'random-selector' },
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      expect(created.draft.type).toBe('tool');
      expect(created.draft.manifest.kind).toBe('shell_tool');
      expect(created.draft.manifest.authoredToolId).toBe('random-selector');
      expect(created.draft.conversation.sessionId).toBe('capability:tool:random-selector');
      expect(JSON.stringify(created.draft)).not.toContain('Workbench');

      const eventDraft = appendCapabilityPackageEvent('random-selector', {
        kind: 'run_failed',
        ok: false,
        message: '空列表输入时报错：items is empty',
        detail: { input: [] },
      });
      expect(eventDraft?.events?.some((event) => event.kind === 'run_failed')).toBe(true);
      appendCapabilityPackageEvent('random-selector', {
        kind: 'retest_passed',
        ok: true,
        message: '空列表时显示中文提示，不再抛错',
      });
      const runFailed = await runCapabilityLifecycle('random-selector', 'run', { params: {} });
      expect(runFailed.ok).toBe(false);
      expect(runFailed.message).toContain('工具运行失败');
      const context = buildCapabilityPackageContext('random-selector');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.session.sessionId).toBe('capability:tool:random-selector');
      expect(context.recentEvents.some((event) => event.kind === 'run_failed' && event.ok === false)).toBe(true);
      expect(context.recentEvents.some((event) => event.kind === 'retest_passed' && event.ok === true)).toBe(true);
      expect(context.contextPrompt).toContain('空列表输入时报错');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists Copilot-created workflow drafts as capability packages with local Workflow context', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-workflow-capability-drafts-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'daily-export-flow',
        type: 'workflow',
        name: 'Daily Export Flow',
        description: 'Export assets, validate output, then notify the user.',
        tags: ['automation'],
        manifest: { steps: ['export', 'validate', 'notify'] },
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      expect(created.draft.type).toBe('workflow');
      expect(created.draft.manifest.kind).toBe('workflow');
      expect(created.draft.conversation.sessionId).toBe('capability:workflow:daily-export-flow');

      const context = buildCapabilityPackageContext('daily-export-flow');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.session.sessionId).toBe('capability:workflow:daily-export-flow');
      expect(context.contextPrompt).toContain('AssetCutter local Workflow Runtime');
      expect(context.contextPrompt).not.toContain('heartbeat/host signal');

      const validate = await runCapabilityLifecycle('daily-export-flow', 'validate');
      expect(validate.ok).toBe(true);
      const run = await runCapabilityLifecycle('daily-export-flow', 'run');
      expect(run.ok).toBe(false);
      if (!run.ok) expect(run.error).toBe('workflow_skill_not_found');
      const failedContext = buildCapabilityPackageContext('daily-export-flow');
      expect(failedContext.ok).toBe(true);
      if (!failedContext.ok) throw new Error(failedContext.error);
      expect(failedContext.recentEvents.some((event) => event.kind === 'workflow_run_failed')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not fake manifest-step execution for unknown workflows', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-workflow-runner-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const target = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: 'Random Selector',
        manifest: { authoredToolId: 'random-selector' },
      });
      const workflow = createCapabilityPackageDraft({
        id: 'daily-export-flow',
        type: 'workflow',
        name: 'Daily Export Flow',
        manifest: {
          steps: [
            { id: 'prepare', type: 'checkpoint', label: 'Prepare inputs' },
            { id: 'validate-tool', type: 'capability', packageId: 'random-selector', action: 'validate' },
          ],
        },
      });
      expect(target.ok).toBe(true);
      expect(workflow.ok).toBe(true);

      const run = await runCapabilityLifecycle('daily-export-flow', 'run');
      expect(run.ok).toBe(false);
      if (run.ok) throw new Error('workflow run unexpectedly succeeded');
      expect(run.error).toBe('workflow_skill_not_found');

      const draft = readCapabilityPackageDraft('daily-export-flow');
      expect(draft?.manifest.lastRunAt).toBeUndefined();

      const context = buildCapabilityPackageContext('daily-export-flow');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.recentEvents.some((event) => event.kind === 'workflow_run_failed')).toBe(true);
      expect(context.contextPrompt).toContain('AssetCutter local Workflow Runtime');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps tool and software connection object contexts isolated after creation', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-context-isolation-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const tool = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: '随机选择工具',
        description: '维护候选项并随机抽取',
        semver: '0.1.0',
        manifest: { authoredToolId: 'random-selector' },
        createdBy: 'copilot',
      });
      const connection = createCapabilityPackageDraft({
        id: 'spine',
        type: 'software_connection',
        name: 'Spine',
        appName: 'Spine',
        description: 'Spine 本机软件连接',
        createdBy: 'copilot',
      });
      expect(tool.ok).toBe(true);
      expect(connection.ok).toBe(true);

      appendCapabilityPackageEvent('random-selector', {
        kind: 'run_failed',
        ok: false,
        message: '候选项为空时不能抽取',
      });
      appendCapabilityPackageEvent('spine', {
        kind: 'probe_failed',
        ok: false,
        message: '尚未收到 Spine 连接脚本心跳',
      });

      const toolContext = buildCapabilityPackageContext('random-selector');
      const connectionContext = buildCapabilityPackageContext('spine');
      expect(toolContext.ok).toBe(true);
      expect(connectionContext.ok).toBe(true);
      if (!toolContext.ok) throw new Error(toolContext.error);
      if (!connectionContext.ok) throw new Error(connectionContext.error);

      expect(toolContext.session.sessionId).toBe('capability:tool:random-selector');
      expect(connectionContext.session.sessionId).toBe('capability:software_connection:spine');
      expect(toolContext.contextPrompt).toContain('能力包 ID: random-selector');
      expect(connectionContext.contextPrompt).toContain('能力包 ID: spine');
      expect(toolContext.recentEvents).toEqual([
        expect.objectContaining({ kind: 'run_failed', message: '候选项为空时不能抽取' }),
      ]);
      expect(connectionContext.recentEvents).toEqual([
        expect.objectContaining({ kind: 'probe_failed', message: '尚未收到 Spine 连接脚本心跳' }),
      ]);
      expect(toolContext.contextPrompt).not.toContain('Spine 连接脚本心跳');
      expect(connectionContext.contextPrompt).not.toContain('候选项为空时不能抽取');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks governed publish gates without mixing local draft history into cloud versions', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-publish-gate-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const photoshop = createCapabilityPackageDraft({
        name: 'Photoshop',
        type: 'software_connection',
        templateHint: 'extendscript_heartbeat',
        createdBy: 'copilot',
      });
      expect(photoshop.ok).toBe(true);
      appendCapabilityPackageEvent('photoshop', {
        kind: 'probe_failed',
        ok: false,
        message: 'local only event',
      });

      const noProbe = checkCapabilityPublishGate('photoshop', {
        isAdmin: true,
        versionNote: 'Initial verified connection.',
      });
      expect(noProbe.publishable).toBe(false);
      expect(noProbe.missingGates).toContain('real_probe_passed');
      expect(noProbe.cloudHistoryIncluded).toBe(false);

      updateCapabilityPackageDraft('photoshop', (current) => ({
        ...current,
        lastProbe: {
          ok: true,
          at: new Date().toISOString(),
          softwareId: 'photoshop',
          result: { ok: true, source: 'heartbeat' },
        },
      }));
      const ordinaryUser = checkCapabilityPublishGate('photoshop', {
        actorRole: 'user',
        versionNote: 'Initial verified connection.',
      });
      expect(ordinaryUser.publishable).toBe(false);
      expect(ordinaryUser.missingGates).toContain('admin_actor');

      const adminMissingNote = checkCapabilityPublishGate('photoshop', { isAdmin: true });
      expect(adminMissingNote.publishable).toBe(false);
      expect(adminMissingNote.missingGates).toContain('version_note');

      const adminPassed = checkCapabilityPublishGate('photoshop', {
        isAdmin: true,
        versionNote: 'Initial verified connection.',
      });
      expect(adminPassed.publishable).toBe(true);
      expect(adminPassed.publishCandidate?.manifest.kind).toBe('software_connection');
      expect(JSON.stringify(adminPassed.publishCandidate)).not.toContain('local only event');

      const tool = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: 'Random Selector',
        semver: '0.1.0',
        manifest: { authoredToolId: 'random-selector' },
      });
      expect(tool.ok).toBe(true);
      const toolGate = checkCapabilityPublishGate('random-selector', {
        isAdmin: true,
        versionNote: 'First usable tool version.',
      });
      expect(toolGate.publishable).toBe(true);
      expect(toolGate.requiredGates).not.toContain('real_probe_passed');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('publishes and switches capability cloud versions without promoting local draft history', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-cloud-versions-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: 'Random Selector',
        semver: '0.1.0',
        manifest: { authoredToolId: 'random-selector' },
      });
      expect(created.ok).toBe(true);
      appendCapabilityPackageEvent('random-selector', {
        kind: 'run_failed',
        ok: false,
        message: 'local draft failure that must not become cloud history',
      });

      const ordinaryPublish = publishCapabilityDraftToCloud('random-selector', {
        actorRole: 'user',
        versionNote: 'First team version',
      });
      expect(ordinaryPublish.ok).toBe(false);
      if (!ordinaryPublish.ok) expect(ordinaryPublish.error).toBe('capability_publish_gate_blocked');

      const v1 = publishCapabilityDraftToCloud('random-selector', {
        isAdmin: true,
        semver: '1.0.0',
        versionNote: 'First team version',
        publishedBy: 'admin@example.test',
      });
      expect(v1.ok).toBe(true);
      if (!v1.ok) throw new Error(v1.error);
      expect(v1.version.package.source).toBe('cloud');
      expect(JSON.stringify(v1.version.package)).not.toContain('local draft failure');

      updateCapabilityPackageDraft('random-selector', (current) => ({
        ...current,
        description: 'Second version description',
      }));
      const v2Lifecycle = await runCapabilityLifecycle('random-selector', 'publish', {
        isAdmin: true,
        semver: '1.1.0',
        versionNote: 'Second team version',
      });
      expect(v2Lifecycle.ok).toBe(true);

      expect(listCapabilityCloudVersions('random-selector').map((item) => item.semver)).toEqual(['1.1.0', '1.0.0']);
      expect(activeCapabilityCloudPackage('random-selector')?.version).toBe('1.1.0');
      expect(listActiveCapabilityCloudPackages().map((item) => item.id)).toContain('random-selector');

      const ordinarySwitch = switchCapabilityCloudVersion('random-selector', v1.version.id, { actorRole: 'user' });
      expect(ordinarySwitch.ok).toBe(false);
      if (!ordinarySwitch.ok) expect(ordinarySwitch.error).toBe('admin_required');

      const missingSwitch = switchCapabilityCloudVersion('random-selector', 'local-draft-version', { isAdmin: true });
      expect(missingSwitch.ok).toBe(false);
      if (!missingSwitch.ok) expect(missingSwitch.error).toBe('cloud_version_not_found');

      const switched = switchCapabilityCloudVersion('random-selector', v1.version.id, { isAdmin: true });
      expect(switched.ok).toBe(true);
      expect(activeCapabilityCloudPackage('random-selector')?.version).toBe('1.0.0');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses one cloud version store for software connections, tools, and workflows', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-cloud-all-types-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const connection = createCapabilityPackageDraft({
        id: 'photoshop',
        type: 'software_connection',
        name: 'Photoshop',
        templateHint: 'extendscript_heartbeat',
      });
      const tool = createCapabilityPackageDraft({
        id: 'random-selector',
        type: 'tool',
        name: 'Random Selector',
        manifest: { authoredToolId: 'random-selector' },
      });
      const workflow = createCapabilityPackageDraft({
        id: 'daily-export-flow',
        type: 'workflow',
        name: 'Daily Export Flow',
        manifest: { steps: [{ kind: 'tool', id: 'random-selector' }] },
      });
      expect(connection.ok).toBe(true);
      expect(tool.ok).toBe(true);
      expect(workflow.ok).toBe(true);

      updateCapabilityPackageDraft('photoshop', (current) => ({
        ...current,
        lastProbe: {
          ok: true,
          at: new Date().toISOString(),
          softwareId: 'photoshop',
          result: { ok: true, source: 'heartbeat', message: 'real heartbeat' },
        },
      }));
      appendCapabilityPackageEvent('daily-export-flow', {
        kind: 'run_failed',
        ok: false,
        message: 'workflow runner is not connected and must stay local',
      });

      const ordinaryWorkflowPublish = publishCapabilityDraftToCloud('daily-export-flow', {
        actorRole: 'user',
        versionNote: 'Team workflow draft.',
      });
      expect(ordinaryWorkflowPublish.ok).toBe(false);
      if (!ordinaryWorkflowPublish.ok) expect(ordinaryWorkflowPublish.error).toBe('capability_publish_gate_blocked');

      const connectionV1 = publishCapabilityDraftToCloud('photoshop', {
        isAdmin: true,
        semver: '1.0.0',
        versionNote: 'Verified Photoshop heartbeat.',
      });
      const toolV1 = publishCapabilityDraftToCloud('random-selector', {
        isAdmin: true,
        semver: '1.0.0',
        versionNote: 'First team tool.',
      });
      const workflowV1 = publishCapabilityDraftToCloud('daily-export-flow', {
        isAdmin: true,
        semver: '1.0.0',
        versionNote: 'First team workflow.',
      });
      expect(connectionV1.ok).toBe(true);
      expect(toolV1.ok).toBe(true);
      expect(workflowV1.ok).toBe(true);
      if (!connectionV1.ok || !toolV1.ok || !workflowV1.ok) throw new Error('publish failed');

      expect(listCapabilityCloudVersions().map((item) => item.type).sort()).toEqual([
        'software_connection',
        'tool',
        'workflow',
      ]);
      expect(listActiveCapabilityCloudPackages().map((item) => item.type).sort()).toEqual([
        'software_connection',
        'tool',
        'workflow',
      ]);
      expect(JSON.stringify(workflowV1.version.package)).not.toContain('workflow runner is not connected');

      updateCapabilityPackageDraft('daily-export-flow', (current) => ({
        ...current,
        description: 'Second workflow version',
      }));
      const workflowV2 = publishCapabilityDraftToCloud('daily-export-flow', {
        isAdmin: true,
        semver: '1.1.0',
        versionNote: 'Second team workflow.',
      });
      expect(workflowV2.ok).toBe(true);
      expect(activeCapabilityCloudPackage('daily-export-flow')?.version).toBe('1.1.0');

      const ordinarySwitch = switchCapabilityCloudVersion('daily-export-flow', workflowV1.version.id, {
        actorRole: 'user',
      });
      expect(ordinarySwitch.ok).toBe(false);
      if (!ordinarySwitch.ok) expect(ordinarySwitch.error).toBe('admin_required');

      const switched = switchCapabilityCloudVersion('daily-export-flow', workflowV1.version.id, { isAdmin: true });
      expect(switched.ok).toBe(true);
      expect(activeCapabilityCloudPackage('daily-export-flow')?.version).toBe('1.0.0');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exports portable capability transfer bundles without local machine history', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-transfer-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'dragged-unknown-app',
        type: 'software_connection',
        name: 'Dragged Unknown App',
        manifest: {
          droppedFrom: 'connection_page',
          shortcutPath: 'C:/Users/me/Desktop/App.lnk',
          executablePath: 'C:/Apps/App/App.exe',
          exeName: 'App.exe',
          templateHint: 'shortcut_unknown_host',
        },
      });
      expect(created.ok).toBe(true);
      appendCapabilityPackageEvent('dragged-unknown-app', {
        kind: 'probe_failed',
        ok: false,
        message: 'local failure should not transfer',
      });
      updateCapabilityPackageDraft('dragged-unknown-app', (current) => ({
        ...current,
        lastProbe: {
          ok: false,
          at: new Date().toISOString(),
          result: { message: 'local probe failed' },
        },
      }));

      const exported = exportCapabilityPackageTransfer('dragged-unknown-app');
      expect(exported.ok).toBe(true);
      if (!exported.ok) throw new Error(exported.error);
      expect(exported.bundle.schema).toBe('assetcutter.capability.transfer');
      expect(exported.bundle.package.type).toBe('software_connection');
      expect(exported.bundle.warnings.join('\n')).toContain('重新安装、启动和真实探测');
      const raw = JSON.stringify(exported.bundle);
      expect(raw).not.toContain('C:/Users/me/Desktop/App.lnk');
      expect(raw).not.toContain('C:/Apps/App/App.exe');
      expect(raw).not.toContain('local failure should not transfer');
      expect(raw).not.toContain('lastProbe');

      deleteCapabilityPackageDraft('dragged-unknown-app');
      const imported = importCapabilityPackageTransfer(exported.bundle);
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error(imported.error);
      const draft = readCapabilityPackageDraft('dragged-unknown-app');
      expect(draft?.source).toBe('draft');
      expect(draft?.conversation.sessionId).toBe('capability:software_connection:dragged-unknown-app');
      expect(draft?.manifest.importedFromTransfer).toBe(true);
      expect(JSON.stringify(draft?.manifest)).not.toContain('C:/Apps/App/App.exe');
      expect(draft?.lastProbe).toBeUndefined();
      expect(draft?.events).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes host process actions through software connection lifecycle without faking success', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-process-lifecycle-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'test-host-connection',
        type: 'software_connection',
        name: 'Test Host Connection',
        manifest: { hostId: 'assetcutter-test-host' },
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);

      const launched = await runCapabilityLifecycle('test-host-connection', 'launch', {
        executablePath: 'C:/Nowhere/TestHost.exe',
      });
      expect(launched.ok).toBe(false);
      if (!launched.ok) {
        expect(launched.error).toBe('host_launch_not_supported');
        expect(launched.message).toBeTruthy();
      }

      const context = buildCapabilityPackageContext('test-host-connection');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.recentEvents).toEqual([
        expect.objectContaining({ kind: 'launch_failed', ok: false }),
      ]);
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the executable path saved on a dragged software connection when launching', async () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-drag-launch-path-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const exePath = join(root, 'Epic Games', 'UE_4.27', 'Engine', 'Binaries', 'Win64', 'UE4Editor.exe');
      mkdirSync(dirname(exePath), { recursive: true });
      writeFileSync(exePath, 'not a real executable', 'utf8');
      const created = createCapabilityPackageDraft({
        id: 'unreal',
        type: 'software_connection',
        name: 'Unreal Editor',
        manifest: {
          hostId: 'unreal',
          executablePath: exePath,
          droppedFrom: 'connection_page',
        },
        createdBy: 'drag-drop',
      });
      expect(created.ok).toBe(true);

      const launched = await runCapabilityLifecycle('unreal', 'launch');
      expect(launched.ok).toBe(false);
      if (!launched.ok) {
        expect((launched.result as { executablePath?: string } | undefined)?.executablePath).toBe(exePath);
      }

      const context = buildCapabilityPackageContext('unreal');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(JSON.stringify(context.recentEvents)).toContain('launch_failed');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds next-step hints for drag-created unknown software connections', () => {
    const prev = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-drag-context-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const created = createCapabilityPackageDraft({
        id: 'unknown-shortcut-app',
        type: 'software_connection',
        name: 'Unknown Shortcut App',
        manifest: {
          droppedFrom: 'connection_page',
          shortcutPath: 'C:/Users/me/Desktop/Unknown App.lnk',
          executablePath: 'C:/Tools/UnknownApp/UnknownApp.exe',
          exeName: 'UnknownApp.exe',
          targetKind: 'shortcut',
        },
        createdBy: 'drag-drop',
      });
      expect(created.ok).toBe(true);

      const probe = appendCapabilityPackageEvent('unknown-shortcut-app', {
        kind: 'probe_failed',
        ok: false,
        message: 'unsupported connector',
      });
      expect(probe?.events?.some((event) => event.kind === 'probe_failed')).toBe(true);

      const context = buildCapabilityPackageContext('unknown-shortcut-app');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.contextPrompt).toContain('拖拽创建来源');
      expect(context.contextPrompt).toContain('C:/Tools/UnknownApp/UnknownApp.exe');
      expect(context.contextPrompt).toContain('不能把 exe 存在当作连接成功');
      expect(context.contextPrompt).toContain('最近失败');
    } finally {
      if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the Photoshop capability package lifecycle through the real Adobe bridge', async () => {
    const prevSandbox = process.env.COMPANION_SANDBOX_ROOT;
    const prevAppData = process.env.APPDATA;
    const root = mkdtempSync(join(tmpdir(), 'ac-capability-lifecycle-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    process.env.APPDATA = root;
    try {
      const scriptsDir = join(root, 'Adobe', 'Adobe Photoshop 2026', 'Presets', 'Scripts');
      const created = createCapabilityPackageDraft({
        name: 'Photoshop',
        type: 'software_connection',
        templateHint: 'extendscript_heartbeat',
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);

      const installed = await installCapabilityPackage('photoshop', { targetDir: scriptsDir, port: 7089 });
      expect(installed.ok).toBe(true);
      expect(JSON.stringify(installed)).toContain('AssetCutter Photoshop Bridge.jsx');

      const probed = await probeCapabilityPackage('photoshop');
      expect(probed.ok).toBe(false);
      expect(probed.message).toContain('尚未产生桥接心跳');
      const failedProbeResult = probed.result as { heartbeatPath?: string };
      expect(failedProbeResult.heartbeatPath).toBeTruthy();

      const draftAfterProbe = readCapabilityPackageDraft('photoshop');
      expect(draftAfterProbe?.lastProbe).toEqual(
        expect.objectContaining({
          ok: false,
          softwareId: 'photoshop',
        }),
      );

      const context = buildCapabilityPackageContext('photoshop');
      expect(context.ok).toBe(true);
      if (!context.ok) throw new Error(context.error);
      expect(context.session.sessionId).toBe('capability:software_connection:photoshop');
      expect(context.contextPrompt).toContain('manifest:');
      expect(context.contextPrompt).toContain('lastInstall:');
      expect(context.contextPrompt).toContain('lastProbe:');
      expect(context.contextPrompt).toContain('真实连接门禁');
      expect(context.contextPrompt).toContain('nextStepHints:');
      expect(context.contextPrompt).toContain('Photoshop 菜单中运行 AssetCutter 连接脚本');
      expect(context.recentEvents.some((event) => event.kind === 'probe' && event.ok === false)).toBe(true);
      expect(context.recentEvents.some((event) => event.kind === 'probe_failed' && event.ok === false)).toBe(true);

      mkdirSync(dirname(failedProbeResult.heartbeatPath!), { recursive: true });
      writeFileSync(
        failedProbeResult.heartbeatPath!,
        JSON.stringify({ host: 'photoshop', at: new Date().toISOString() }),
        'utf8',
      );
      const reprobed = await runCapabilityLifecycle('photoshop', 'probe');
      expect(reprobed.ok).toBe(true);
      const fixedContext = buildCapabilityPackageContext('photoshop');
      expect(fixedContext.ok).toBe(true);
      if (!fixedContext.ok) throw new Error(fixedContext.error);
      expect(fixedContext.contextPrompt).toContain('Photoshop 桥接心跳已连接');
      expect(fixedContext.recentEvents.some((event) => event.kind === 'probe' && event.ok === true)).toBe(true);
      expect(fixedContext.recentEvents.some((event) => event.kind === 'probe_passed' && event.ok === true)).toBe(true);

      const uninstalled = await uninstallCapabilityPackage('photoshop');
      expect(uninstalled.ok).toBe(true);
      expect(JSON.stringify(uninstalled)).toContain('AssetCutter Photoshop Bridge.jsx');
    } finally {
      if (prevSandbox === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prevSandbox;
      if (prevAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prevAppData;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the Blender capability package lifecycle through the real startup bridge and HTTP probe', async () => {
    const prevSandbox = process.env.COMPANION_SANDBOX_ROOT;
    const root = mkdtempSync(join(tmpdir(), 'ac-blender-capability-lifecycle-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
    try {
      const startupDir = join(root, 'Blender Foundation', 'Blender', '4.2', 'scripts', 'startup');
      const created = createCapabilityPackageDraft({
        id: 'blender',
        name: 'Blender',
        type: 'software_connection',
        manifest: { hostId: 'blender', appName: 'Blender', templateHint: 'blender_http' },
        createdBy: 'copilot',
      });
      expect(created.ok).toBe(true);

      const probeServer = createServer((req, res) => {
        if (req.url !== '/health') {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, version: '4.2-test' }));
      });
      await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
      const address = probeServer.address();
      if (!address || typeof address === 'string') throw new Error('missing probe server port');
      const port = address.port;
      await new Promise<void>((resolve, reject) => probeServer.close((err) => (err ? reject(err) : resolve())));

      const installed = await installCapabilityPackage('blender', { targetDir: startupDir, port });
      expect(installed.ok).toBe(true);
      expect(existsSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME))).toBe(true);
      expect(readCapabilityPackageDraft('blender')?.lastInstall).toEqual(
        expect.objectContaining({
          ok: true,
          softwareId: 'blender',
        }),
      );

      const failedProbe = await probeCapabilityPackage('blender');
      expect(failedProbe.ok).toBe(false);
      expect(failedProbe.message).toContain('Blender bridge is not reachable');
      expect(readCapabilityPackageDraft('blender')?.lastProbe).toEqual(
        expect.objectContaining({
          ok: false,
          softwareId: 'blender',
        }),
      );

      await new Promise<void>((resolve) => probeServer.listen(port, '127.0.0.1', resolve));
      try {
        const reprobed = await runCapabilityLifecycle('blender', 'probe');
        expect(reprobed.ok).toBe(true);
        const context = buildCapabilityPackageContext('blender');
        expect(context.ok).toBe(true);
        if (!context.ok) throw new Error(context.error);
        expect(context.connectionState).toMatchObject({ maturity: 'connected', publishEligible: true });
        expect(context.contextPrompt).toContain('Blender bridge connected');
        expect(context.recentEvents.some((event) => event.kind === 'probe_passed' && event.ok === true)).toBe(true);
      } finally {
        await new Promise<void>((resolve, reject) => probeServer.close((err) => (err ? reject(err) : resolve())));
      }

      const uninstalled = await uninstallCapabilityPackage('blender', { targetDir: startupDir });
      expect(uninstalled.ok).toBe(true);
      expect(existsSync(join(startupDir, BLENDER_BRIDGE_STARTUP_NAME))).toBe(false);
    } finally {
      if (prevSandbox === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = prevSandbox;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
