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
const {
  appendMemoryNote,
  listMemoryNotes,
  buildMemoryContextBlock,
  appendProjectMemoryNote,
  listProjectMemoryNotes,
  updateProjectMemoryNote,
  summarizeProjectMemory,
  buildProjectMemoryContextBlock,
} = require('../companion-desktop/agent-memory.cjs');
const { createAgentBodyMcpServer } = require('../companion-desktop/agent-body-mcp.cjs');
const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
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

  it('scopes project memory by project and supports context disabling', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-project-mem-'));
    const a = appendProjectMemoryNote(tmp, {
      projectId: 'p1',
      projectName: 'Campaign',
      kind: 'decision',
      text: 'Use clean product shots for this campaign.',
      tags: ['style'],
      source: 'test',
    });
    const b = appendProjectMemoryNote(tmp, {
      projectId: 'p2',
      kind: 'parameter',
      text: 'Resolution should be 2048px.',
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(listProjectMemoryNotes(tmp, { projectId: 'p1' })).toHaveLength(1);
    expect(listProjectMemoryNotes(tmp, { projectId: 'p2' })[0].kind).toBe('parameter');
    expect(summarizeProjectMemory(tmp, { projectId: 'p1' }).byKind.decision).toBe(1);
    expect(buildProjectMemoryContextBlock(tmp, { projectId: 'p1' })).toContain('clean product shots');

    const disabled = updateProjectMemoryNote(tmp, a.note.id, { contextEnabled: false });
    expect(disabled.ok).toBe(true);
    expect(listProjectMemoryNotes(tmp, { projectId: 'p1' })).toHaveLength(0);
    expect(listProjectMemoryNotes(tmp, { projectId: 'p1', includeDisabled: true })).toHaveLength(1);
    expect(buildProjectMemoryContextBlock(tmp, { projectId: 'p1' })).not.toContain('clean product shots');
  });

  it('rejects secret-like project memory text', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-project-mem-secret-'));
    const r = appendProjectMemoryNote(tmp, {
      projectId: 'p1',
      text: 'token=sk-1234567890abcdef1234567890abcdef',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('secret_like_text');
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

  it('exposes admin permission templates and applies them', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-policy-template-'));
    const policyPath = path.join(tmp, 'policy.json');
    const policy = createAgentPolicy({ getPolicyPath: () => policyPath });
    const templates = policy.listPolicyTemplates();
    expect(templates.map((template: { id: string }) => template.id)).toEqual(
      expect.arrayContaining(['member_safe', 'workflow_admin', 'locked_down']),
    );
    const applied = policy.applyPolicyTemplate('locked_down');
    expect(applied.ok).toBe(true);
    expect(policy.readPolicy().forbiddenTools).toEqual(
      expect.arrayContaining(['ac.memory.append', 'ac.usage.upload_cloud_draft']),
    );
    expect(policy.gateTool({ name: 'ac.memory.append', risk: 'confirm' })).toBe('deny');
  });
});

describe('agent tool execution audit', () => {
  it('preserves Codex runtime settings and normalizes unsafe sandbox values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-store-'));
    const store = createAgentStore({ getRoot: () => tmp });

    const saved = store.writeSettings({
      codexCommand: 'codex-custom',
      codexCwd: tmp,
      codexModel: 'gpt-5-codex',
      codexSandbox: 'read-only',
    });
    const afterInvalidSandbox = store.writeSettings({ codexSandbox: 'not-a-sandbox' });

    expect(saved.codexCommand).toBe('codex-custom');
    expect(saved.codexCwd).toBe(tmp);
    expect(saved.codexModel).toBe('gpt-5-codex');
    expect(saved.codexSandbox).toBe('read-only');
    expect(afterInvalidSandbox.codexSandbox).toBe('read-only');
  });

  it('keeps Codex default cwd in the user agent store instead of the packaged app resources dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-store-'));
    const store = createAgentStore({ getRoot: () => tmp });
    const expected = path.join(tmp, 'codex-workspace');

    const defaults = store.readSettings();
    expect(defaults.codexCwd).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);

    store.writeSettings({ codexCwd: 'C:\\Program Files\\AssetCutterCompanion\\resources' });
    expect(store.readSettings().codexCwd).toBe(expected);

    const custom = path.join(tmp, 'custom-codex-project');
    store.writeSettings({ codexCwd: custom });
    expect(store.readSettings().codexCwd).toBe(custom);
  });

  it('preserves the last workbench e2e entrance summary in settings', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-store-'));
    const store = createAgentStore({ getRoot: () => tmp });
    const lastE2e = {
      ok: false,
      status: 'blocked',
      blockedBy: 'workbench-login',
      accountPrerequisite: {
        ok: false,
        label: '工作台待登录',
        action: 'open-workbench-login',
      },
      checkedAt: '2026-07-21T01:02:03.000Z',
    };

    const written = store.writeSettings({ mcpWorkbenchLastE2e: lastE2e });
    const readBack = store.readSettings();

    expect(written.mcpWorkbenchLastE2e).toEqual(lastE2e);
    expect(readBack.mcpWorkbenchLastE2e).toEqual(lastE2e);
  });

  it('normalizes the last Codex setup report before writing settings JSON', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-agent-store-'));
    const store = createAgentStore({ getRoot: () => tmp });
    const longDetail = 'x'.repeat(700);

    store.writeSettings({
      codexLastSetupReport: {
        ok: false,
        at: '2026-08-03T12:00:00.000Z',
        desktopVersion: '0.2.12',
        activeBrainId: 'codex',
        cloudIdentitySynced: false,
        conversationVerified: true,
        extra: { shouldNotPersist: true },
        checks: [
          {
            id: 'cloud_identity',
            label: 'Cloud identity',
            ok: false,
            status: 'failed',
            detail: longDetail,
            nextAction: 'Run setup again.',
            nested: { shouldNotPersist: true },
          },
        ],
      },
    });

    const raw = fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);

    expect(parsed.codexLastSetupReport.extra).toBeUndefined();
    expect(parsed.codexLastSetupReport.checks[0].nested).toBeUndefined();
    expect(parsed.codexLastSetupReport.checks[0].detail).toHaveLength(500);
    expect(store.readSettings().codexLastSetupReport.failed).toEqual(['cloud_identity']);
  });

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
  it('registers P2 tools including governed workflow promotion preflights', () => {
    expect(P2_TOOL_SCHEMAS).toHaveLength(12);
    expect(ALL_TOOL_SCHEMAS).toHaveLength(37);
    expect(P2_TOOL_SCHEMAS.map((tool: { name: string }) => tool.name)).toContain(
      'ac.workflow.promote_workbench_preset',
    );
    expect(P2_TOOL_SCHEMAS.map((tool: { name: string }) => tool.name)).toContain(
      'ac.workflow.promote_script_hub_tool',
    );
    expect(P2_TOOL_SCHEMAS.map((tool: { name: string }) => tool.name)).toContain('ac.usage.upload_cloud_draft');
    expect(P2_TOOL_SCHEMAS.find((tool: { name: string }) => tool.name === 'ac.usage.upload_cloud_draft')).toMatchObject({
      risk: 'confirm',
      surfaces: ['shell', 'companion'],
    });
    expect(P2_TOOL_SCHEMAS.map((tool: { name: string }) => tool.name)).toContain('ac.usage.probe_quota_policy');
    expect(P2_TOOL_SCHEMAS.find((tool: { name: string }) => tool.name === 'ac.usage.probe_quota_policy')).toMatchObject({
      risk: 'safe',
      surfaces: ['shell', 'companion'],
    });
  });

  it('executes usage cloud upload through the shell dependency', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      uploadCopilotUsageCloudDraft: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return {
          ok: true,
          uploaded: true,
          eventCount: 1,
          inserted: 1,
          skipped: 0,
          endpoint: '/api/usage/events',
          partition: 'persist:assetcutter-team',
        };
      },
    });
    const result = await host.executeTool(
      'ac.usage.upload_cloud_draft',
      { days: 7, limit: 100, dryRun: false },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.structured).toMatchObject({
      uploaded: true,
      endpoint: '/api/usage/events',
      partition: 'persist:assetcutter-team',
    });
    expect(calls).toEqual([{ days: 7, limit: 100, dryRun: false }]);
  });

  it('returns recoverable auth state when usage cloud upload is not logged in', async () => {
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      uploadCopilotUsageCloudDraft: async () => ({
        ok: false,
        uploaded: false,
        code: 'AGENT_AUTH_REQUIRED',
        message: 'Shell team session is not logged in.',
        authRequired: true,
        recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
      }),
    });
    const result = await host.executeTool('ac.usage.upload_cloud_draft', {}, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'AGENT_AUTH_REQUIRED' });
    expect(result.structured).toMatchObject({
      uploaded: false,
      authRequired: true,
      recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
    });
  });

  it('executes usage quota policy probe through the shell dependency', async () => {
    let called = 0;
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      probeCopilotUsageQuotaPolicy: async () => {
        called += 1;
        return {
          ok: true,
          endpoint: '/api/usage/policy',
          partition: 'persist:assetcutter-team',
          quotaPolicy: {
            cloudQuotaEnforced: true,
            enforcementSource: 'auth_api_usage_policy',
            policyId: 'usage-billing-enabled',
          },
        };
      },
    });
    const result = await host.executeTool('ac.usage.probe_quota_policy', {}, {});
    expect(result.ok).toBe(true);
    expect(result.structured).toMatchObject({
      endpoint: '/api/usage/policy',
      partition: 'persist:assetcutter-team',
      quotaPolicy: {
        cloudQuotaEnforced: true,
        enforcementSource: 'auth_api_usage_policy',
      },
    });
    expect(called).toBe(1);
  });

  it('returns recoverable auth state when usage quota policy probe is not logged in', async () => {
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      probeCopilotUsageQuotaPolicy: async () => ({
        ok: false,
        code: 'AGENT_AUTH_REQUIRED',
        authRequired: true,
        endpoint: '/api/usage/policy',
        partition: 'persist:assetcutter-team',
        recoveryTool: { name: 'ac.shell.navigate', arguments: { view: 'workbench' } },
      }),
    });
    const result = await host.executeTool('ac.usage.probe_quota_policy', {}, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'AGENT_AUTH_REQUIRED' });
    expect(result.structured).toMatchObject({
      authRequired: true,
      endpoint: '/api/usage/policy',
      partition: 'persist:assetcutter-team',
    });
  });

  it('passes workflow promotion admin and audit gates for Copilot UI preflight calls', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-shell-promotion-'));
    const saved = saveSkill(tmp, {
      skillId: 'shell-approved-workflow',
      name: 'Shell approved workflow',
      description: 'Workflow draft promoted from the Copilot settings UI.',
      prompt: 'Run the governed workflow.',
      toolHints: ['ac.workbench.run_capability'],
      workbenchPreset: {
        capability: 'workflow_text_to_image',
        modality: 'image',
        canonicalModelId: 'doubao-seedream-5-0',
        providerId: 'volcengine-ark',
        assetContext: { mode: 'current_project' },
      },
    });
    expect(saved.ok).toBe(true);

    const host = createAgentBodyHost({
      getShellView: () => 'settings',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      getSkillsRoot: () => tmp,
    });
    const result = await host.executeTool(
      'ac.workflow.promote_workbench_preset',
      { skillId: 'shell-approved-workflow', presetName: 'Shell approved workflow' },
      {
        clientId: 'shell',
        toolCallId: 'shell_tool_test',
        policyDecision: 'copilot_ui_admin_confirm',
        adminConfirmationPassed: true,
        adminConfirmationSource: 'copilot_ui',
        auditRecordWritten: true,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'AGENT_WORKFLOW_PROMOTION_NOT_READY' });
    expect(result.structured.passedGates).toEqual(
      expect.arrayContaining([
        'skill_draft_exists',
        'capability_route_schema_valid',
        'admin_confirmation',
        'audit_record_written',
      ]),
    );
    expect(result.structured.missingGates).toContain('workbench_login_e2e_ready');
    expect(result.structured.missingGates).not.toContain('admin_confirmation');
    expect(result.structured.missingGates).not.toContain('audit_record_written');
    expect(result.structured.adminConfirmation).toMatchObject({
      required: true,
      passed: true,
      sourceRequired: 'copilot_ui',
      source: 'copilot_ui',
      policyDecision: 'copilot_ui_admin_confirm',
      autoConfirmCountsAsAdminApproval: false,
    });
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
    expect(workbenchStandardFlowText()).toContain('ac.workbench.create_text_asset');
    expect(workbenchStandardFlowText()).toContain('ac.workbench.create_image_asset');
    expect(doc.canonicalFlow.find((step: { id: string }) => step.id === 'capability')?.tool).toContain(
      'create_text_asset',
    );
    expect(doc.canonicalFlow.find((step: { id: string }) => step.id === 'capability')?.tool).toContain(
      'create_image_asset',
    );
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
  it('starts local Body MCP loopback when enabled', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678' }),
      writeSettings: (p: object) => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: { listTools: async () => [], executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: () => 'allow',
      readPolicy: () => ({ confirmTools: true, autoConfirmTools: [], forbiddenTools: [] }),
      appendAudit: () => {},
      getShellView: () => 'home',
      log: () => {},
    });
    const started = await server.start();
    expect(started.running).toBe(true);
    expect(started.port).toBe(19121);
    expect(server.status().running).toBe(true);
    expect(server.status().removed).toBeUndefined();
    const cfg = server.buildMcpClientConfig();
    expect(cfg.mcpServers['assetcutter-body'].url).toContain('19121');
    await server.stop();
  });
});
