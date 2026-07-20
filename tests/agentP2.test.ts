import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  listSkillEntries,
  readSkillById,
  listSkillRevisions,
  readSkillRevision,
  saveSkill,
  deleteSkill,
  buildSkillsContextBlock,
} = require('../companion-desktop/agent-skills.cjs');
const { appendMemoryNote, listMemoryNotes, buildMemoryContextBlock } = require('../companion-desktop/agent-memory.cjs');
const { createAgentBodyMcpServer } = require('../companion-desktop/agent-body-mcp.cjs');
const {
  WORKBENCH_E2E_REQUIRED_TOOLS,
  WORKBENCH_REQUIRED_TOOLS,
  buildWorkbenchFlowDocument,
  workbenchStandardFlowText,
} = require('../companion-desktop/agent-workbench-flow.cjs');
const { createAgentPolicy } = require('../companion-desktop/agent-policy.cjs');
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const { P2_TOOL_SCHEMAS, ALL_TOOL_SCHEMAS } = require('../companion-desktop/agent-tool-schemas.cjs');

describe('agent P2 skills', () => {
  it('loads skill.json from directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-skills-'));
    const dir = path.join(tmp, 'demo-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skill.json'),
      JSON.stringify({ id: 'demo-skill', name: 'Demo', description: 'test skill' }),
    );
    const skills = listSkillEntries(tmp);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('demo-skill');
    const block = buildSkillsContextBlock(tmp);
    expect(block).toContain('demo-skill');
  });

  it('saves reusable workflow skills with normalized ids', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-skills-save-'));
    const r = saveSkill(tmp, {
      skillId: 'Cinematic Scene + Character',
      name: '影视级场景和角色',
      description: '团队工作流',
      prompt: '生成影视级场景和角色。',
      toolHints: ['ac.workbench.run_capability', 'ac.workbench.get_context', 'ac.workbench.run_capability'],
    });
    expect(r.ok).toBe(true);
    expect(r.skill.id).toBe('cinematic-scene-character');
    expect(r.resourceUri).toBe('skill://cinematic-scene-character');
    expect(r.promptName).toBe('skill:cinematic-scene-character');
    expect(r.revision).toBe(1);
    expect(r.previousArchived).toBe(false);
    const skills = listSkillEntries(tmp);
    expect(skills).toHaveLength(1);
    expect(skills[0].revision).toBe(1);
    expect(skills[0].revisionCount).toBe(0);
    expect(skills[0].toolHints).toEqual(['ac.workbench.get_context', 'ac.workbench.run_capability']);
    expect(skills[0].path.startsWith(tmp)).toBe(true);

    const updated = saveSkill(tmp, {
      skillId: 'cinematic-scene-character',
      name: '影视级场景和角色 v2',
      prompt: '生成影视级场景和角色第二版。',
    });
    expect(updated.ok).toBe(true);
    expect(updated.revision).toBe(2);
    expect(updated.previousArchived).toBe(true);
    const updatedSkills = listSkillEntries(tmp);
    expect(updatedSkills[0].revision).toBe(2);
    expect(updatedSkills[0].revisionCount).toBe(1);
    expect(updatedSkills[0].createdAt).toBe(skills[0].createdAt);
    expect(readSkillById(tmp, 'cinematic-scene-character').revision).toBe(2);
    const revisions = listSkillRevisions(tmp, 'cinematic-scene-character');
    expect(revisions.ok).toBe(true);
    expect(revisions.total).toBe(2);
    expect(revisions.currentRevision).toBe(2);
    expect(revisions.revisions.map((rev: { revision: number }) => rev.revision)).toEqual([1, 2]);
    const firstRevision = readSkillRevision(tmp, 'cinematic-scene-character', 1);
    expect(firstRevision.ok).toBe(true);
    expect(firstRevision.kind).toBe('archived');
    expect(firstRevision.resourceUri).toBe('skill://cinematic-scene-character/revisions/1');
    expect(firstRevision.skill.prompt).toContain('生成影视级场景和角色。');
    const currentRevision = readSkillRevision(tmp, 'cinematic-scene-character', 2);
    expect(currentRevision.ok).toBe(true);
    expect(currentRevision.kind).toBe('current');
    expect(currentRevision.skill.prompt).toContain('第二版');

    const rejected = saveSkill(tmp, {
      skillId: '../outside',
      name: 'Bad',
      prompt: 'bad',
    });
    expect(rejected.ok).toBe(false);
  });

  it('deletes workflow skills within the skills root only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-skills-delete-'));
    const saved = saveSkill(tmp, {
      skillId: 'demo-delete',
      name: 'Demo Delete',
      prompt: 'temporary workflow',
    });
    expect(saved.ok).toBe(true);
    const deleted = deleteSkill(tmp, 'demo-delete');
    expect(deleted.ok).toBe(true);
    expect(deleted.deleted).toBe(true);
    expect(listSkillEntries(tmp)).toHaveLength(0);

    const rejected = deleteSkill(tmp, '../outside');
    expect(rejected.ok).toBe(false);
  });
});

describe('agent P2 memory', () => {
  it('appends and lists memory notes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mem-'));
    const r = appendMemoryNote(tmp, { text: 'prefer dark theme' });
    expect(r.ok).toBe(true);
    const notes = listMemoryNotes(tmp);
    expect(notes).toHaveLength(1);
    expect(buildMemoryContextBlock(tmp)).toContain('prefer dark theme');
  });
});

describe('agent policy', () => {
  it('writes normalized tool policy and applies deny before auto allow', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-policy-'));
    const policyPath = path.join(tmp, 'policy.json');
    const policy = createAgentPolicy({ getPolicyPath: () => policyPath });

    const written = policy.writePolicy({
      confirmTools: true,
      autoConfirmTools: ['ac.workbench.run_capability', 'ac.workbench.run_capability', 'ac.memory.append'],
      forbiddenTools: ['ac.memory.append'],
    });

    expect(written.autoConfirmTools).toEqual(['ac.workbench.run_capability']);
    expect(written.forbiddenTools).toEqual(['ac.memory.append']);
    expect(policy.gateTool({ name: 'ac.workbench.run_capability', risk: 'confirm' })).toBe('allow');
    expect(policy.gateTool({ name: 'ac.memory.append', risk: 'confirm' })).toBe('deny');
    expect(policy.gateTool({ name: 'ac.shell.get_state', risk: 'safe' })).toBe('allow');
  });
});

describe('agent tool execution audit', () => {
  it('lists recent tool executions from audit logs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-store-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.appendAudit({
      ts: '2026-07-20T01:00:00.000Z',
      clientId: 'copilot',
      sessionId: 'default',
      brainId: 'codex',
      tool: 'ac.shell.get_state',
      ok: true,
      durationMs: 12,
      policyDecision: 'allow',
    });
    store.appendAudit({
      ts: '2026-07-20T01:00:01.000Z',
      clientId: 'mcp',
      sessionId: 'mcp',
      brainId: 'external',
      toolCallId: 'mcp_tool_test',
      traceId: 'trace_123',
      jsonRpcId: 'call-1',
      tool: 'ac.workbench.run_capability',
      ok: false,
      errorCode: 'AGENT_CONFIRM_REQUIRED',
      durationMs: 3,
      policyDecision: 'confirm_required',
    });

    const items = store.listToolExecutions({ days: 7, limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0].tool).toBe('ac.workbench.run_capability');
    expect(items[0].durationMs).toBe(3);
    expect(items[0].policyDecision).toBe('confirm_required');
    expect(items[0].toolCallId).toBe('mcp_tool_test');
    expect(items[0].traceId).toBe('trace_123');
    expect(items[0].jsonRpcId).toBe('call-1');
    expect(items[1].clientId).toBe('copilot');
  });
});

describe('agent P2 tool schemas', () => {
  it('registers eight P2 tools totaling 25 ac.*', () => {
    expect(P2_TOOL_SCHEMAS).toHaveLength(8);
    expect(ALL_TOOL_SCHEMAS).toHaveLength(25);
  });
});

describe('agent workbench flow contract', () => {
  it('centralizes the canonical workbench tool chain for MCP resources and brains', () => {
    const doc = buildWorkbenchFlowDocument();
    expect(doc.requiredTools).toEqual(WORKBENCH_REQUIRED_TOOLS);
    expect(WORKBENCH_E2E_REQUIRED_TOOLS).toEqual([
      'ac.workbench.ensure_ready',
      'ac.workbench.get_context',
      'ac.workbench.create_project',
      'ac.workbench.run_capability',
      'ac.workbench.list_assets',
      'ac.workbench.get_asset',
    ]);
    expect(workbenchStandardFlowText()).toContain('ac.workbench.ensure_ready');
    expect(workbenchStandardFlowText()).toContain('ac.workbench.get_asset');
    expect(doc.canonicalFlow.map((step: { id: string }) => step.id)).toEqual([
      'ready',
      'context',
      'project',
      'capability',
      'verify-list',
      'verify-detail',
    ]);
    expect(doc.recoveryContract.authRequired).toContain('logged in');
    expect(doc.extensionGuidance.addWorkbenchTool).toContain('agent-workbench-flow.cjs');
  });
});

describe('agent P2 MCP server', () => {
  it('rejects when disabled', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: false, mcpPort: 19120, mcpToken: 'abc' }),
      writeSettings: (p) => p,
      bodyHost: { listTools: async () => [], executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: () => 'allow',
      readPolicy: () => ({
        confirmTools: true,
        autoConfirmTools: ['ac.workbench.run_capability'],
        forbiddenTools: ['ac.memory.append'],
      }),
      appendAudit: () => {},
      getShellView: () => 'home',
    });
    const r = await server.start();
    expect(r.running).toBe(false);
  });

  it('builds client config snippet', () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19120, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => p,
      bodyHost: { listTools: async () => [], executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: () => 'allow',
      readPolicy: () => ({
        confirmTools: true,
        autoConfirmTools: ['ac.workbench.run_capability'],
        forbiddenTools: ['ac.memory.append'],
      }),
      appendAudit: () => {},
      getShellView: () => 'home',
      getSkillsRoot: () => '',
    });
    const cfg = server.buildMcpClientConfig();
    expect(cfg.mcpServers['assetcutter-body'].url).toContain('/mcp');
  });

  it('starts HTTP server when enabled', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-'));
    const skillDir = path.join(tmp, 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        id: 'demo-skill',
        name: 'Demo',
        description: 'mcp resource test',
        prompt: 'Run the demo workflow.',
        toolHints: ['ac.shell.get_state'],
      }),
    );

    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.shell.get_state',
            description: 'state',
            inputSchema: { type: 'object' },
            risk: 'safe',
            surfaces: ['shell'],
          },
        ],
        executeTool: async () => ({ ok: true, content: '{}' }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({
        confirmTools: true,
        autoConfirmTools: ['ac.workbench.run_capability'],
        forbiddenTools: ['ac.memory.append'],
      }),
      appendAudit: () => {},
      getShellView: () => 'home',
      getSkillsRoot: () => tmp,
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };
    const rpc = async (method: string, params: object = {}) => {
      const r = await fetch(`http://127.0.0.1:19121/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return r.json();
    };

    const toolsList = await rpc('tools/list');
    expect(toolsList.result.tools).toHaveLength(1);
    expect(toolsList.result.tools[0].title).toBe('读取当前状态');
    expect(toolsList.result.tools[0]._meta.assetcutter.risk).toBe('safe');
    expect(toolsList.result.tools[0]._meta.assetcutter.surfaces).toContain('shell');
    expect(toolsList.result.tools[0]._meta.assetcutter.whenToUse).toContain('开始任务');

    const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.capabilities.prompts).toBeTruthy();
    expect(init.result.capabilities.tools.listChanged).toBe(true);
    expect(init.result.capabilities.resources.listChanged).toBe(true);
    expect(init.result.capabilities.resources.subscribe).toBe(true);
    expect(init.result.capabilities.prompts.listChanged).toBe(true);
    expect(init.result.capabilities.completions).toBeTruthy();
    expect(init.result.capabilities.logging).toBeTruthy();
    expect(init.result.serverInfo.title).toBe('AssetCutter Agent Body');
    expect(init.result.instructions).toContain('ac.shell.get_state');

    const promptsList = await rpc('prompts/list');
    expect(promptsList.result.prompts[0].name).toBe('skill:demo-skill');
    expect(promptsList.result.prompts[0]._meta.assetcutter.toolHints).toContain('ac.shell.get_state');

    const promptGet = await rpc('prompts/get', { name: 'skill:demo-skill' });
    expect(promptGet.result.messages[0].content.text).toContain('Run the demo workflow');
    expect(promptGet.result._meta.assetcutter.skillId).toBe('demo-skill');

    const resList = await rpc('resources/list');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/manifest');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/tool-catalog');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/quickstart');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/workbench-flow');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/policy');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/server-status');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/tool-executions');
    expect(resList.result.resources.map((r: { uri: string }) => r.uri)).toContain('skill://demo-skill');

    const templateList = await rpc('resources/templates/list');
    expect(templateList.result.resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toContain(
      'assetcutter://mcp/{document}',
    );
    expect(templateList.result.resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toContain('skill://{skillId}');
    expect(templateList.result.resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toContain(
      'skill://{skillId}/revisions',
    );
    expect(templateList.result.resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate)).toContain(
      'skill://{skillId}/revisions/{revision}',
    );

    const manifestRead = await rpc('resources/read', { uri: 'assetcutter://mcp/manifest' });
    const manifest = JSON.parse(manifestRead.result.contents[0].text);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.capabilities.tools).toBe(true);
    expect(manifest.capabilities.prompts).toBe(true);
    expect(manifest.capabilities.resourceSubscriptions).toBe(true);
    expect(manifest.capabilities.completions).toBe(true);
    expect(manifest.capabilities.logging).toBe(true);
    expect(manifest.capabilities.cancellation).toBe(true);
    expect(manifest.logging.level).toBe('info');
    expect(manifest.logging.levels).toContain('warning');
    expect(manifest.supportedProtocolVersions).toContain('2025-11-25');
    expect(manifest.instructions).toContain('notifications/cancelled');
    expect(manifest.recovery.structuredFields).toContain('recoveryTool');
    expect(manifest.recovery.loginRecoveryTool).toMatchObject({
      name: 'ac.shell.navigate',
      arguments: { view: 'workbench' },
    });
    expect(manifest.recovery.workbenchFlowResource).toBe('assetcutter://mcp/workbench-flow');
    expect(manifest.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/quickstart');
    expect(manifest.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/workbench-flow');
    expect(manifest.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/policy');
    expect(manifest.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/tool-catalog');
    expect(manifest.resources.map((r: { uri: string }) => r.uri)).toContain('assetcutter://mcp/tool-executions');

    const catalogRead = await rpc('resources/read', { uri: 'assetcutter://mcp/tool-catalog' });
    const catalog = JSON.parse(catalogRead.result.contents[0].text);
    expect(catalog.total).toBe(1);
    expect(catalog.surfaces[0].tools[0].name).toBe('ac.shell.get_state');
    expect(catalog.surfaces[0].tools[0].whenToUse).toContain('开始任务');

    const quickstartRead = await rpc('resources/read', { uri: 'assetcutter://mcp/quickstart' });
    expect(quickstartRead.result.contents[0].mimeType).toBe('text/markdown');
    expect(quickstartRead.result.contents[0].text).toContain('ac.workbench.ensure_ready');
    expect(quickstartRead.result.contents[0].text).toContain('ac.workbench.get_context');
    expect(quickstartRead.result.contents[0].text).toContain('ac.workbench.create_project');
    expect(quickstartRead.result.contents[0].text).toContain('ac.workbench.list_assets');
    expect(quickstartRead.result.contents[0].text).toContain('ac.workbench.get_asset');
    expect(quickstartRead.result.contents[0].text).toContain('imageDataUrl');
    expect(quickstartRead.result.contents[0].text).toContain('directRunSupported');
    expect(quickstartRead.result.contents[0].text).toContain('recoveryTool');
    expect(quickstartRead.result.contents[0].text).toContain('ac.shell.navigate');
    expect(quickstartRead.result.contents[0].text).toContain('assetcutter://mcp/policy');
    expect(quickstartRead.result.contents[0].text).toContain('assetcutter://mcp/workbench-flow');
    expect(quickstartRead.result.contents[0].text).toContain('assetcutter://mcp/tool-executions');
    expect(quickstartRead.result.contents[0].text).toContain('smoke:agent-mcp:e2e');

    const workbenchFlowRead = await rpc('resources/read', { uri: 'assetcutter://mcp/workbench-flow' });
    const workbenchFlow = JSON.parse(workbenchFlowRead.result.contents[0].text);
    expect(workbenchFlow.schemaVersion).toBe(1);
    expect(workbenchFlow.requiredTools).toContain('ac.workbench.ensure_ready');
    expect(workbenchFlow.requiredTools).toContain('ac.workbench.run_capability');
    expect(workbenchFlow.canonicalFlow.map((step: { id: string }) => step.id)).toContain('verify-detail');
    expect(workbenchFlow.recoveryContract.authRequired).toContain('logged in');
    expect(workbenchFlow.recoveryContract.authRequired).toContain('ac.shell.navigate');
    expect(workbenchFlow.e2eGates.cli).toContain('smoke:agent-mcp:e2e');
    expect(JSON.stringify(workbenchFlow)).not.toContain('test-token-12345678');

    const policyRead = await rpc('resources/read', { uri: 'assetcutter://mcp/policy' });
    const policy = JSON.parse(policyRead.result.contents[0].text);
    expect(policy.confirmTools).toBe(true);
    expect(policy.autoConfirmTools).toContain('ac.workbench.run_capability');
    expect(policy.forbiddenTools).toContain('ac.memory.append');
    expect(policy.toolDecisions[0].name).toBe('ac.shell.get_state');
    expect(policy.toolDecisions[0].decision).toBe('allow');
    expect(JSON.stringify(policy)).not.toContain('test-token-12345678');

    const statusRead = await rpc('resources/read', { uri: 'assetcutter://mcp/server-status' });
    const status = JSON.parse(statusRead.result.contents[0].text);
    expect(status.running).toBe(true);
    expect(status.schemaVersion).toBe(1);
    expect(status.tokenHint).toBe('configured');
    expect(status.shellView).toBe('home');
    expect(status.toolCount).toBe(1);
    expect(status.riskCounts.safe).toBe(1);
    expect(status.policy.confirmTools).toBe(true);
    expect(status.policy.autoConfirmToolCount).toBe(1);
    expect(status.policy.forbiddenToolCount).toBe(1);
    expect(status.readiness.mcp).toBe(true);
    expect(status.readiness.workbenchLikelyVisible).toBe(false);
    expect(status.readiness.workbenchOperation).toBe('navigate_first');
    expect(status.readiness.workbenchNextStep).toContain('ac.shell.navigate');
    expect(status.readiness.recoveryTools.authRequired).toMatchObject({
      name: 'ac.shell.navigate',
      arguments: { view: 'workbench' },
    });
    expect(status.readiness.e2eCommand).toContain('smoke:agent-mcp:e2e');
    expect(status.readiness.recoveryContract.join('\n')).toContain('authRequired');
    expect(status.subscribedResourceCount).toBe(0);
    expect(status.text).toBeUndefined();

    const subscribed = await rpc('resources/subscribe', { uri: 'assetcutter://mcp/tool-catalog' });
    expect(subscribed.result).toEqual({});
    const statusAfterSubscribeRead = await rpc('resources/read', { uri: 'assetcutter://mcp/server-status' });
    const statusAfterSubscribe = JSON.parse(statusAfterSubscribeRead.result.contents[0].text);
    expect(statusAfterSubscribe.subscribedResourceCount).toBe(1);
    expect(statusAfterSubscribe.subscribedResources).toContain('assetcutter://mcp/tool-catalog');

    const unsubscribed = await rpc('resources/unsubscribe', { uri: 'assetcutter://mcp/tool-catalog' });
    expect(unsubscribed.result).toEqual({});
    const statusAfterUnsubscribeRead = await rpc('resources/read', { uri: 'assetcutter://mcp/server-status' });
    const statusAfterUnsubscribe = JSON.parse(statusAfterUnsubscribeRead.result.contents[0].text);
    expect(statusAfterUnsubscribe.subscribedResourceCount).toBe(0);

    const missingSubscribe = await rpc('resources/subscribe', { uri: 'skill://missing' });
    expect(missingSubscribe.error.code).toBe(-32002);

    const executionsRead = await rpc('resources/read', { uri: 'assetcutter://mcp/tool-executions' });
    const executions = JSON.parse(executionsRead.result.contents[0].text);
    expect(executions.schemaVersion).toBe(1);
    expect(executions.executions).toEqual([]);

    const resRead = await rpc('resources/read', { uri: 'skill://demo-skill' });
    expect(resRead.result.contents[0].text).toContain('demo-skill');

    const documentCompletion = await rpc('completion/complete', {
      ref: { type: 'ref/resource', uri: 'assetcutter://mcp/{document}' },
      argument: { name: 'document', value: 'tool' },
    });
    expect(documentCompletion.result.completion.values).toContain('tool-catalog');
    expect(documentCompletion.result.completion.values).toContain('tool-executions');

    const workbenchDocumentCompletion = await rpc('completion/complete', {
      ref: { type: 'ref/resource', uri: 'assetcutter://mcp/{document}' },
      argument: { name: 'document', value: 'work' },
    });
    expect(workbenchDocumentCompletion.result.completion.values).toContain('workbench-flow');

    const skillCompletion = await rpc('completion/complete', {
      ref: { type: 'ref/resource', uri: 'skill://{skillId}' },
      argument: { name: 'skillId', value: 'demo' },
    });
    expect(skillCompletion.result.completion.values).toContain('demo-skill');

    await server.stop();
  });

  it('runs the built-in workbench E2E verifier through MCP JSON-RPC', async () => {
    const tools = [
      'ac.shell.navigate',
      'ac.workbench.ensure_ready',
      'ac.workbench.get_context',
      'ac.workbench.create_project',
      'ac.workbench.run_capability',
      'ac.workbench.list_assets',
      'ac.workbench.get_asset',
      'ac.shell.navigate',
    ].map((name) => ({
      name,
      description: name,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      risk: name === 'ac.workbench.run_capability' ? 'confirm' : 'safe',
      surfaces: ['workbench'],
    }));
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19131, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19131, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => tools,
        executeTool: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          if (name === 'ac.workbench.ensure_ready') return { ok: true, content: '{}', structured: { ok: true } };
          if (name === 'ac.workbench.get_context') {
            return {
              ok: true,
              content: '{}',
              structured: {
                activeProjectId: '',
                projects: [],
                capabilityPresets: [
                  {
                    id: 'preset_text',
                    directRunSupported: true,
                    acceptsText: true,
                    requiresImage: false,
                  },
                ],
              },
            };
          }
          if (name === 'ac.workbench.create_project') {
            return { ok: true, content: '{}', structured: { projectId: 'project_1' } };
          }
          if (name === 'ac.workbench.run_capability') {
            return {
              ok: true,
              content: '{}',
              structured: { assetId: 'asset_1', resultKey: 'text' },
            };
          }
          if (name === 'ac.workbench.list_assets') {
            return { ok: true, content: '{}', structured: { assets: [{ id: 'asset_1' }] } };
          }
          if (name === 'ac.workbench.get_asset') {
            return { ok: true, content: '{}', structured: { displayKey: 'asset_1', text: 'done' } };
          }
          return { ok: false, content: '', error: { code: 'AGENT_TOOL_UNKNOWN', message: name } };
        },
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: ['ac.workbench.run_capability'] }),
      appendAudit: () => {},
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);
    try {
      const e2e = await server.runWorkbenchE2eSelf();
      expect(e2e.ok).toBe(true);
      expect(e2e.projectId).toBe('project_1');
      expect(e2e.assetId).toBe('asset_1');
      expect(e2e.steps.map((s: { id: string }) => s.id)).toEqual([
        'tools',
        'ensure_ready',
        'get_context',
        'create_project',
        'preset',
        'run_capability',
        'list_assets',
        'get_asset',
      ]);
      expect(calls.map((c) => c.name)).toEqual([
        'ac.workbench.ensure_ready',
        'ac.workbench.get_context',
        'ac.workbench.create_project',
        'ac.workbench.run_capability',
        'ac.workbench.list_assets',
        'ac.workbench.get_asset',
      ]);
      expect(calls.find((c) => c.name === 'ac.workbench.run_capability')?.args).toMatchObject({
        projectId: 'project_1',
        presetId: 'preset_text',
      });
    } finally {
      await server.stop();
    }
  });

  it('returns actionable auth recovery from the built-in workbench E2E verifier', async () => {
    const tools = [
      'ac.workbench.ensure_ready',
      'ac.workbench.get_context',
      'ac.workbench.create_project',
      'ac.workbench.run_capability',
      'ac.workbench.list_assets',
      'ac.workbench.get_asset',
      'ac.shell.navigate',
    ].map((name) => ({
      name,
      description: name,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      risk: name === 'ac.workbench.run_capability' ? 'confirm' : 'safe',
      surfaces: ['workbench'],
    }));
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19132, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19132, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => tools,
        executeTool: async (name: string) => {
          if (name === 'ac.workbench.ensure_ready') {
            return {
              ok: false,
              content: '',
              error: { code: 'AGENT_AUTH_REQUIRED', message: 'login required' },
              structured: { authRequired: true },
              mcp: { nextStep: '请先在工作台完成登录，然后重新调用。' },
            };
          }
          if (name === 'ac.shell.navigate') {
            return { ok: true, content: '{"navigated":"workbench"}', structured: { view: 'workbench' } };
          }
          return { ok: true, content: '{}', structured: {} };
        },
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: ['ac.workbench.run_capability'] }),
      appendAudit: () => {},
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);
    try {
      const e2e = await server.runWorkbenchE2eSelf({ recoveryWaitMs: 1 });
      expect(e2e.ok).toBe(false);
      expect(e2e.failedStep).toBe('ac.workbench.ensure_ready');
      expect(e2e.errorCode).toBe('AGENT_AUTH_REQUIRED');
      expect(e2e.nextStep).toContain('登录');
      expect(e2e.authRequired).toBe(true);
      expect(e2e.retryable).toBe(true);
      expect(e2e.view).toBe('workbench');
      expect(e2e.action).toBe('open_workbench_login');
      expect(e2e.recoveryTool).toMatchObject({
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
      });
      expect(e2e.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'recovery_tool',
            ok: true,
            tool: 'ac.shell.navigate',
            arguments: { view: 'workbench' },
            waitMs: 1,
          }),
        ]),
      );
    } finally {
      await server.stop();
    }
  });

  it('paginates MCP list methods with opaque cursors', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-page-'));
    for (let i = 0; i < 101; i += 1) {
      const id = `skill-${String(i).padStart(3, '0')}`;
      const dir = path.join(tmp, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'skill.json'),
        JSON.stringify({
          id,
          name: `Skill ${i}`,
          description: 'pagination test',
          prompt: `Run skill ${i}.`,
        }),
      );
    }

    const tools = Array.from({ length: 101 }, (_, i) => ({
      name: `ac.test.tool_${String(i).padStart(3, '0')}`,
      description: 'page test',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'safe',
      surfaces: ['test'],
    }));
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19125, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19125, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => tools,
        executeTool: async () => ({ ok: true, content: '{}' }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: () => {},
      getShellView: () => 'home',
      getSkillsRoot: () => tmp,
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };
    const rpc = async (method: string, params: object = {}) => {
      const r = await fetch(`http://127.0.0.1:19125/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return r.json();
    };

    try {
      const firstTools = await rpc('tools/list');
      expect(firstTools.result.tools).toHaveLength(100);
      expect(typeof firstTools.result.nextCursor).toBe('string');
      const secondTools = await rpc('tools/list', { cursor: firstTools.result.nextCursor });
      expect(secondTools.result.tools).toHaveLength(1);
      expect(secondTools.result.nextCursor).toBeUndefined();

      const firstPrompts = await rpc('prompts/list');
      expect(firstPrompts.result.prompts).toHaveLength(100);
      expect(typeof firstPrompts.result.nextCursor).toBe('string');
      const secondPrompts = await rpc('prompts/list', { cursor: firstPrompts.result.nextCursor });
      expect(secondPrompts.result.prompts).toHaveLength(1);

      const firstResources = await rpc('resources/list');
      expect(firstResources.result.resources).toHaveLength(100);
      expect(typeof firstResources.result.nextCursor).toBe('string');
      const secondResources = await rpc('resources/list', { cursor: firstResources.result.nextCursor });
      expect(secondResources.result.resources.length).toBeGreaterThan(0);
      expect(secondResources.result.resources.map((r: { uri: string }) => r.uri)).toContain('skill://skill-097');

      const templates = await rpc('resources/templates/list', { cursor: 'not-a-real-cursor' });
      expect(templates.result.resourceTemplates).toHaveLength(4);
      expect(templates.result.nextCursor).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('negotiates supported MCP protocol versions and returns protocol headers', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19129, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19129, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: { listTools: async () => [], executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };

    try {
      const latest = await fetch(`http://127.0.0.1:19129/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-latest',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25' },
        }),
      });
      const latestJson = await latest.json();
      expect(latest.headers.get('MCP-Protocol-Version')).toBe('2025-11-25');
      expect(latestJson.result.protocolVersion).toBe('2025-11-25');
      expect(latestJson.result.instructions).toContain('tool-catalog');

      const fallback = await fetch(`http://127.0.0.1:19129/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-fallback',
          method: 'initialize',
          params: { protocolVersion: '2099-01-01' },
        }),
      });
      const fallbackJson = await fallback.json();
      expect(fallbackJson.result.protocolVersion).toBe('2024-11-05');

      const setLevel = await fetch(`http://127.0.0.1:19129/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'log-level',
          method: 'logging/setLevel',
          params: { level: 'warning' },
        }),
      });
      const setLevelJson = await setLevel.json();
      expect(setLevelJson.result).toEqual({});
      expect(audit.some((entry) => entry.action === 'mcp_logging_level_set' && entry.level === 'warning')).toBe(true);

      const statusAfterLevel = await fetch(`http://127.0.0.1:19129/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'status-after-log-level',
          method: 'resources/read',
          params: { uri: 'assetcutter://mcp/server-status' },
        }),
      });
      const statusAfterLevelJson = await statusAfterLevel.json();
      const statusAfterLevelBody = JSON.parse(statusAfterLevelJson.result.contents[0].text);
      expect(statusAfterLevelBody.loggingLevel).toBe('warning');

      const invalidLevel = await fetch(`http://127.0.0.1:19129/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'log-level-invalid',
          method: 'logging/setLevel',
          params: { level: 'verbose' },
        }),
      });
      const invalidLevelJson = await invalidLevel.json();
      expect(invalidLevelJson.error.code).toBe(-32602);
      expect(invalidLevelJson.error.data.supportedLevels).toContain('warning');
    } finally {
      await server.stop();
    }
  });

  it('exposes sanitized MCP policy decisions for external agents', async () => {
    const tools = [
      { name: 'ac.safe.inspect', description: 'safe', inputSchema: { type: 'object' }, risk: 'safe', surfaces: ['shell'] },
      {
        name: 'ac.confirm.auto',
        description: 'auto confirm',
        inputSchema: { type: 'object' },
        risk: 'confirm',
        surfaces: ['workbench'],
      },
      {
        name: 'ac.confirm.prompt',
        description: 'prompt confirm',
        inputSchema: { type: 'object' },
        risk: 'confirm',
        surfaces: ['workbench'],
      },
      {
        name: 'ac.confirm.denied',
        description: 'denied',
        inputSchema: { type: 'object' },
        risk: 'confirm',
        surfaces: ['workbench'],
      },
    ];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19130, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19130, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: { listTools: async () => tools, executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: (tool) => {
        if (tool.name === 'ac.confirm.denied') return 'deny';
        if (tool.name === 'ac.confirm.auto') return 'allow';
        if (tool.risk === 'confirm') return 'confirm';
        return 'allow';
      },
      readPolicy: () => ({
        confirmTools: true,
        autoConfirmTools: ['ac.confirm.auto'],
        forbiddenTools: ['ac.confirm.denied'],
        directoryAllowlist: ['C:/secret/local/path'],
      }),
      appendAudit: () => {},
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19130/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'policy',
          method: 'resources/read',
          params: { uri: 'assetcutter://mcp/policy' },
        }),
      });
      const json = await r.json();
      const policy = JSON.parse(json.result.contents[0].text);
      const byName = new Map(policy.toolDecisions.map((item: { name: string }) => [item.name, item]));
      expect(byName.get('ac.safe.inspect').decision).toBe('allow');
      expect(byName.get('ac.confirm.auto').autoConfirmed).toBe(true);
      expect(byName.get('ac.confirm.prompt').requiresFrontendAuthorization).toBe(true);
      expect(byName.get('ac.confirm.denied').forbidden).toBe(true);
      expect(JSON.stringify(policy)).not.toContain('C:/secret/local/path');
      expect(JSON.stringify(policy)).not.toContain('test-token-12345678');
    } finally {
      await server.stop();
    }
  });

  it('handles MCP notifications, batch requests, and structured tool output', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19122, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19122, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.shell.get_state',
            description: 'state',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            risk: 'safe',
            surfaces: ['shell'],
          },
        ],
        executeTool: async () => ({
          ok: true,
          content: '',
          structured: { shellView: 'home', ready: true },
        }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: (entry) => audit.push(entry),
      listToolExecutions: () =>
        audit
          .filter((entry) => entry.tool)
          .map((entry) => ({
            ts: String(entry.ts || ''),
            clientId: String(entry.clientId || ''),
            sessionId: String(entry.sessionId || ''),
            brainId: String(entry.brainId || ''),
            tool: String(entry.tool || ''),
            ok: Boolean(entry.ok),
            errorCode: entry.errorCode ? String(entry.errorCode) : null,
            durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : null,
            argsDigest: entry.argsDigest ? String(entry.argsDigest) : null,
            policyDecision: entry.policyDecision ? String(entry.policyDecision) : null,
            toolCallId: entry.toolCallId ? String(entry.toolCallId) : null,
            traceId: entry.traceId ? String(entry.traceId) : null,
            jsonRpcId: entry.jsonRpcId != null ? String(entry.jsonRpcId) : null,
          })),
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };

    try {
      const notification = await fetch(`http://127.0.0.1:19122/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      });
      expect(notification.status).toBe(202);

      const batch = await fetch(`http://127.0.0.1:19122/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 'a', method: 'ping', params: {} },
          { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
          { jsonrpc: '2.0', id: 'b', method: 'tools/list', params: {} },
        ]),
      });
      const batchJson = await batch.json();
      expect(batchJson).toHaveLength(2);
      expect(batchJson.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
      expect(batchJson[1].result.tools[0].annotations.readOnlyHint).toBe(true);

      const call = await fetch(`http://127.0.0.1:19122/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-1',
          method: 'tools/call',
          params: { name: 'ac.shell.get_state', arguments: {} },
        }),
      });
      const callJson = await call.json();
      expect(callJson.result.isError).toBe(false);
      expect(callJson.result.structuredContent).toEqual({ shellView: 'home', ready: true });
      expect(callJson.result.content[0].text).toContain('shellView');
      expect(callJson.result._meta.assetcutter.toolCallId).toMatch(/^mcp_tool_/);
      expect(callJson.result._meta.assetcutter.jsonRpcId).toBe('call-1');
      expect(callJson.result._meta.assetcutter.durationMs).toEqual(expect.any(Number));
      expect(callJson.result._meta.assetcutter.policyDecision).toBe('allow');

      const executionsRead = await fetch(`http://127.0.0.1:19122/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'executions',
          method: 'resources/read',
          params: { uri: 'assetcutter://mcp/tool-executions' },
        }),
      });
      const executionsJson = await executionsRead.json();
      const executions = JSON.parse(executionsJson.result.contents[0].text);
      expect(executions.executions).toHaveLength(1);
      expect(executions.executions[0].tool).toBe('ac.shell.get_state');
      expect(executions.executions[0].toolCallId).toBe(callJson.result._meta.assetcutter.toolCallId);
      expect(executions.executions[0].jsonRpcId).toBe('call-1');
      expect(JSON.stringify(executions)).not.toContain('Bearer');
    } finally {
      await server.stop();
    }
  });

  it('probes its own MCP endpoint with current token', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19123, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19123, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.shell.get_state',
            description: 'state',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            risk: 'safe',
            surfaces: ['shell'],
          },
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'confirm',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async () => ({ ok: true, content: '{}' }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: () => {},
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const probe = await server.probeSelf();
      expect(probe.ok).toBe(true);
      expect(probe.endpoint).toBe('http://127.0.0.1:19123/mcp');
      expect(probe.protocolVersion).toBe('2024-11-05');
      expect(probe.toolCount).toBe(2);
      expect(probe.toolsSample).toContain('ac.shell.get_state');
    } finally {
      await server.stop();
    }
  });

  it('promotes workbench bridge input requirements to MCP recovery attributes', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19139, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19139, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'safe',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async () => ({
          ok: false,
          content: '',
          error: { code: 'AGENT_INPUT_REQUIRED', message: 'input_image_required' },
          structured: {
            action: 'runCapability',
            ok: false,
            bridge: {
              ok: false,
              error: 'input_image_required',
              requiresInput: true,
              requiredInput: 'imageDataUrl',
            },
          },
        }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19139/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'need-input',
          method: 'tools/call',
          params: { name: 'ac.workbench.run_capability', arguments: { presetId: 'image-preset' } },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.error.code).toBe('AGENT_INPUT_REQUIRED');
      expect(json.result._meta.assetcutter.requiresInput).toBe(true);
      expect(json.result._meta.assetcutter.requiredInput).toBe('imageDataUrl');
      expect(json.result.structuredContent.requiresInput).toBe(true);
      expect(json.result.structuredContent.requiredInput).toBe('imageDataUrl');
      expect(json.result.structuredContent.details.bridge.error).toBe('input_image_required');
      expect(audit[0].errorCode).toBe('AGENT_INPUT_REQUIRED');
    } finally {
      await server.stop();
    }
  });

  it('audits MCP tool calls blocked by confirmation policy', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19124, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19124, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'confirm',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async () => ({ ok: true, content: '{}' }),
      },
      gateTool: () => 'confirm',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19124/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-1',
          method: 'tools/call',
          params: { name: 'ac.workbench.run_capability', arguments: { presetId: 'demo', traceId: 'trace-demo' } },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.toolCallId).toMatch(/^mcp_tool_/);
      expect(json.result._meta.assetcutter.jsonRpcId).toBe('call-1');
      expect(json.result._meta.assetcutter.traceId).toBe('trace-demo');
      expect(json.result._meta.assetcutter.policyDecision).toBe('confirm_required');
      expect(json.result._meta.assetcutter.nextStep).toContain('允许');
      expect(json.result._meta.assetcutter.requiresFrontendAuthorization).toBe(true);
      expect(json.result._meta.assetcutter.retryable).toBe(true);
      expect(json.result.structuredContent.ok).toBe(false);
      expect(json.result.structuredContent.error.code).toBe('AGENT_CONFIRM_REQUIRED');
      expect(json.result.structuredContent.requiresFrontendAuthorization).toBe(true);
      expect(json.result.structuredContent.retryable).toBe(true);
      expect(json.result.structuredContent.details.clientId).toBe('mcp');
      expect(json.result.structuredContent.details.confirmId).toBe(null);
      expect(json.result.structuredContent.details.confirmReason).toBe('copilot_ui_unavailable');
      expect(audit).toHaveLength(1);
      expect(audit[0].tool).toBe('ac.workbench.run_capability');
      expect(audit[0].toolCallId).toBe(json.result._meta.assetcutter.toolCallId);
      expect(audit[0].traceId).toBe('trace-demo');
      expect(audit[0].jsonRpcId).toBe('call-1');
      expect(audit[0].errorCode).toBe('AGENT_CONFIRM_REQUIRED');
      expect(audit[0].policyDecision).toBe('confirm_required');
      expect(typeof audit[0].durationMs).toBe('number');
    } finally {
      await server.stop();
    }
  });

  it('routes MCP confirm-risk tool calls through frontend authorization', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const confirms: Array<Record<string, unknown>> = [];
    let executed = 0;
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19126, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19126, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'confirm',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async (_name, _args, ctx) => {
          executed += 1;
          return { ok: true, content: '', structured: { ok: true, toolCallId: ctx.toolCallId, traceId: ctx.traceId } };
        },
      },
      gateTool: () => 'confirm',
      readPolicy: () => ({ autoConfirmTools: [] }),
      waitForConfirm: async (_confirmId, meta) => {
        confirms.push(meta);
        return { approved: true, reason: 'approved' };
      },
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19126/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-ok',
          method: 'tools/call',
          params: { name: 'ac.workbench.run_capability', arguments: { presetId: 'demo', traceId: 'trace-ok' } },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(false);
      expect(json.result._meta.assetcutter.policyDecision).toBe('auto_confirm');
      expect(json.result._meta.assetcutter.traceId).toBe('trace-ok');
      expect(json.result.structuredContent.traceId).toBe('trace-ok');
      expect(executed).toBe(1);
      expect(confirms).toHaveLength(1);
      expect(confirms[0].clientId).toBe('mcp');
      expect(confirms[0].toolCallId).toBe(json.result._meta.assetcutter.toolCallId);
      expect(audit[0].policyDecision).toBe('auto_confirm');
    } finally {
      await server.stop();
    }
  });

  it('returns machine-readable MCP tool failure attributes for workbench auth errors', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19132, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19132, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.ensure_ready',
            description: 'ready',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            risk: 'safe',
            surfaces: ['workbench'],
          },
          {
            name: 'ac.workbench.get_context',
            description: 'context',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            risk: 'safe',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async (name: string) => ({
          ok: false,
          content: JSON.stringify({
            action: name === 'ac.workbench.ensure_ready' ? 'ensureReady' : 'getContext',
            ok: false,
            view: 'workbench',
            authRequired: true,
            retryable: true,
            nextStep: '请先在工作台 BrowserView 登录主站，然后重试。',
          }),
          error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
          structured: {
            action: name === 'ac.workbench.ensure_ready' ? 'ensureReady' : 'getContext',
            ok: false,
            view: 'workbench',
            authRequired: true,
            retryable: true,
            nextStep: '请先在工作台 BrowserView 登录主站，然后重试。',
          },
        }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: () => {},
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19132/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'auth-fail',
          method: 'tools/call',
          params: { name: 'ac.workbench.get_context', arguments: {} },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.error.code).toBe('AGENT_AUTH_REQUIRED');
      expect(json.result._meta.assetcutter.authRequired).toBe(true);
      expect(json.result._meta.assetcutter.retryable).toBe(true);
      expect(json.result._meta.assetcutter.action).toBe('open_workbench_login');
      expect(json.result._meta.assetcutter.recoveryTool).toMatchObject({
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
      });
      expect(json.result._meta.assetcutter.nextStep).toContain('登录');
      expect(json.result.structuredContent.ok).toBe(false);
      expect(json.result.structuredContent.authRequired).toBe(true);
      expect(json.result.structuredContent.action).toBe('open_workbench_login');
      expect(json.result.structuredContent.recoveryTool).toMatchObject({
        name: 'ac.shell.navigate',
        arguments: { view: 'workbench' },
      });
      expect(json.result.structuredContent.nextStep).toContain('登录');
      expect(json.result.structuredContent.details).toBeTruthy();
      expect(json.result.structuredContent.details.view).toBe('workbench');
      expect(json.result.structuredContent.details.authRequired).toBe(true);

      const ready = await fetch(`http://127.0.0.1:19132/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'ready-auth-fail',
          method: 'tools/call',
          params: { name: 'ac.workbench.ensure_ready', arguments: { requireProject: true } },
        }),
      });
      const readyJson = await ready.json();
      expect(readyJson.result.isError).toBe(true);
      expect(readyJson.result._meta.assetcutter.error.code).toBe('AGENT_AUTH_REQUIRED');
      expect(readyJson.result.structuredContent.authRequired).toBe(true);
      expect(readyJson.result.structuredContent.details.action).toBe('ensureReady');
    } finally {
      await server.stop();
    }
  });

  it('returns machine-readable MCP recovery attributes when a project is required', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19133, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19133, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'confirm',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async () => ({
          ok: false,
          content: JSON.stringify({
            action: 'runCapability',
            ok: false,
            bridge: { ok: false, error: 'project_required', nextStep: '请先创建项目' },
            nextStep: '请先创建项目',
          }),
          error: { code: 'AGENT_PROJECT_REQUIRED', message: 'workbench project required' },
          structured: {
            action: 'runCapability',
            ok: false,
            bridge: { ok: false, error: 'project_required', nextStep: '请先创建项目' },
            nextStep: '请先创建项目',
          },
        }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: () => {},
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19133/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'project-required',
          method: 'tools/call',
          params: { name: 'ac.workbench.run_capability', arguments: { presetId: 'demo' } },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.error.code).toBe('AGENT_PROJECT_REQUIRED');
      expect(json.result._meta.assetcutter.projectRequired).toBe(true);
      expect(json.result._meta.assetcutter.retryable).toBe(true);
      expect(json.result._meta.assetcutter.nextStep).toContain('create_project');
      expect(json.result.structuredContent.projectRequired).toBe(true);
      expect(json.result.structuredContent.details.bridge.error).toBe('project_required');
    } finally {
      await server.stop();
    }
  });

  it('saves workflow skills over MCP and exposes them as prompts and resources', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-skill-save-'));
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19131, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19131, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: require('../companion-desktop/agent-body-host.cjs').createAgentBodyHost({
        getShellView: () => 'home',
        navigateShell: async () => ({ ok: true }),
        companionApiRequest: async () => ({ ok: true, json: {} }),
        getStateSummary: async () => ({}),
        getSkillsRoot: () => tmp,
      }),
      gateTool: (tool) => (tool.risk === 'confirm' ? 'confirm' : 'allow'),
      readPolicy: () => ({ confirmTools: true, autoConfirmTools: [], forbiddenTools: [] }),
      waitForConfirm: async () => ({ approved: true, reason: 'approved' }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'home',
      getSkillsRoot: () => tmp,
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };
    const rpc = async (method: string, params: object = {}) => {
      const r = await fetch(`http://127.0.0.1:19131/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      });
      return r.json();
    };

    try {
      const saved = await rpc('tools/call', {
        name: 'ac.skills.save',
        arguments: {
          skillId: 'cinematic-scene-character',
          name: '影视级场景和角色',
          description: '团队工作流',
          prompt: '执行影视级场景和角色工作流。',
          toolHints: ['ac.workbench.get_context', 'ac.workbench.run_capability'],
        },
      });
      expect(saved.result.isError).toBe(false);
      expect(saved.result.structuredContent.resourceUri).toBe('skill://cinematic-scene-character');
      expect(saved.result._meta.assetcutter.policyDecision).toBe('auto_confirm');

      const prompts = await rpc('prompts/list');
      expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toContain('skill:cinematic-scene-character');

      const resources = await rpc('resources/list');
      expect(resources.result.resources.map((r: { uri: string }) => r.uri)).toContain('skill://cinematic-scene-character');

      const skill = await rpc('resources/read', { uri: 'skill://cinematic-scene-character' });
      expect(skill.result.contents[0].text).toContain('影视级场景和角色');
      expect(audit.some((entry) => entry.tool === 'ac.skills.save' && entry.policyDecision === 'auto_confirm')).toBe(true);

      const savedAgain = await rpc('tools/call', {
        name: 'ac.skills.save',
        arguments: {
          skillId: 'cinematic-scene-character',
          name: '影视级场景和角色 v2',
          prompt: '执行影视级场景和角色工作流第二版。',
        },
      });
      expect(savedAgain.result.isError).toBe(false);
      expect(savedAgain.result.structuredContent.skill.revision).toBe(2);

      const revisionTool = await rpc('tools/call', {
        name: 'ac.skills.revisions',
        arguments: { skillId: 'cinematic-scene-character' },
      });
      expect(revisionTool.result.isError).toBe(false);
      expect(revisionTool.result.structuredContent.currentRevision).toBe(2);

      const resourcesWithRevisions = await rpc('resources/list');
      const revisionUris = resourcesWithRevisions.result.resources.map((r: { uri: string }) => r.uri);
      expect(revisionUris).toContain('skill://cinematic-scene-character/revisions');
      expect(revisionUris).toContain('skill://cinematic-scene-character/revisions/1');
      expect(revisionUris).toContain('skill://cinematic-scene-character/revisions/2');
      const revisionsRead = await rpc('resources/read', { uri: 'skill://cinematic-scene-character/revisions' });
      const revisions = JSON.parse(revisionsRead.result.contents[0].text);
      expect(revisions.revisions.map((rev: { revision: number }) => rev.revision)).toEqual([1, 2]);
      const firstRevisionRead = await rpc('resources/read', { uri: 'skill://cinematic-scene-character/revisions/1' });
      const firstRevision = JSON.parse(firstRevisionRead.result.contents[0].text);
      expect(firstRevision.kind).toBe('archived');
      expect(firstRevision.skill.prompt).toContain('执行影视级场景和角色工作流。');

      const revisionGet = await rpc('tools/call', {
        name: 'ac.skills.revision_get',
        arguments: { skillId: 'cinematic-scene-character', revision: 1 },
      });
      expect(revisionGet.result.isError).toBe(false);
      expect(revisionGet.result.structuredContent.kind).toBe('archived');
      expect(revisionGet.result.structuredContent.skill.prompt).toContain('执行影视级场景和角色工作流。');

      const revisionCompletion = await rpc('completion/complete', {
        ref: { type: 'ref/resource', uri: 'skill://{skillId}/revisions/{revision}' },
        argument: { name: 'revision', value: '' },
        context: { arguments: { skillId: 'cinematic-scene-character' } },
      });
      expect(revisionCompletion.result.completion.values).toEqual(['1', '2']);

      const deleted = await rpc('tools/call', {
        name: 'ac.skills.delete',
        arguments: { skillId: 'cinematic-scene-character' },
      });
      expect(deleted.result.isError).toBe(false);
      expect(deleted.result.structuredContent.deleted).toBe(true);

      const promptsAfterDelete = await rpc('prompts/list');
      expect(promptsAfterDelete.result.prompts.map((p: { name: string }) => p.name)).not.toContain(
        'skill:cinematic-scene-character',
      );
      const resourcesAfterDelete = await rpc('resources/list');
      expect(resourcesAfterDelete.result.resources.map((r: { uri: string }) => r.uri)).not.toContain(
        'skill://cinematic-scene-character',
      );
      expect(audit.some((entry) => entry.tool === 'ac.skills.delete' && entry.policyDecision === 'auto_confirm')).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('returns explicit MCP confirmation rejection when frontend denies', async () => {
    const audit: Array<Record<string, unknown>> = [];
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19127, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19127, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.workbench.run_capability',
            description: 'run capability',
            inputSchema: { type: 'object', properties: { presetId: { type: 'string' } }, required: ['presetId'] },
            risk: 'confirm',
            surfaces: ['workbench'],
          },
        ],
        executeTool: async () => ({ ok: true, content: '{}' }),
      },
      gateTool: () => 'confirm',
      readPolicy: () => ({ autoConfirmTools: [] }),
      waitForConfirm: async () => ({ approved: false, reason: 'rejected' }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'workbench',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    try {
      const r = await fetch(`http://127.0.0.1:19127/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token-12345678',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'call-no',
          method: 'tools/call',
          params: { name: 'ac.workbench.run_capability', arguments: { presetId: 'demo' } },
        }),
      });
      const json = await r.json();
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.error.code).toBe('AGENT_CONFIRM_REJECTED');
      expect(json.result._meta.assetcutter.policyDecision).toBe('confirm_rejected');
      expect(json.result._meta.assetcutter.nextStep).toContain('拒绝');
      expect(json.result._meta.assetcutter.requiresFrontendAuthorization).toBe(false);
      expect(json.result._meta.assetcutter.retryable).toBe(false);
      expect(json.result.structuredContent.ok).toBe(false);
      expect(json.result.structuredContent.error.code).toBe('AGENT_CONFIRM_REJECTED');
      expect(json.result.structuredContent.requiresFrontendAuthorization).toBe(false);
      expect(json.result.structuredContent.retryable).toBe(false);
      expect(json.result.structuredContent.details.clientId).toBe('mcp');
      expect(json.result.structuredContent.details.confirmId).toMatch(/^cfm_/);
      expect(json.result.structuredContent.details.confirmReason).toBe('rejected');
      expect(audit).toHaveLength(1);
      expect(audit[0].errorCode).toBe('AGENT_CONFIRM_REJECTED');
    } finally {
      await server.stop();
    }
  });

  it('cancels active MCP tool calls through notifications/cancelled', async () => {
    const audit: Array<Record<string, unknown>> = [];
    let startedResolve: (() => void) | null = null;
    const startedPromise = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19128, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19128, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          {
            name: 'ac.shell.get_state',
            description: 'state',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            risk: 'safe',
            surfaces: ['shell'],
          },
        ],
        executeTool: async (_name, _args, ctx) =>
          new Promise((resolve) => {
            if (startedResolve) startedResolve();
            if (ctx.signal?.aborted) {
              resolve({ ok: false, content: '', error: { code: 'AGENT_CANCELLED', message: 'request cancelled' } });
              return;
            }
            ctx.signal?.addEventListener(
              'abort',
              () => {
                resolve({ ok: false, content: '', error: { code: 'AGENT_CANCELLED', message: 'request cancelled' } });
              },
              { once: true },
            );
          }),
      },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
      appendAudit: (entry) => audit.push(entry),
      getShellView: () => 'home',
      getSkillsRoot: () => '',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-12345678',
    };

    try {
      const callPromise = fetch(`http://127.0.0.1:19128/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'slow-call',
          method: 'tools/call',
          params: { name: 'ac.shell.get_state', arguments: {} },
        }),
      }).then((r) => r.json());
      await startedPromise;
      expect(server.status().activeRequestCount).toBe(1);

      const cancelled = await fetch(`http://127.0.0.1:19128/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 'slow-call', reason: 'user stopped from external agent' },
        }),
      });
      expect(cancelled.status).toBe(202);

      const json = await callPromise;
      expect(json.result.isError).toBe(true);
      expect(json.result._meta.assetcutter.error.code).toBe('AGENT_CANCELLED');
      expect(json.result._meta.assetcutter.policyDecision).toBe('allow');
      expect(json.result._meta.assetcutter.nextStep).toContain('取消');
      expect(server.status().activeRequestCount).toBe(0);
      expect(audit.some((entry) => entry.action === 'mcp_cancel_requested')).toBe(true);
      expect(audit.some((entry) => entry.tool === 'ac.shell.get_state' && entry.errorCode === 'AGENT_CANCELLED')).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
