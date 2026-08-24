import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const { createAgentSessionService } = require('../companion-desktop/agent-session/index.cjs');
const { buildCodexPrompt } = require('../companion-desktop/brain-adapters/codex.cjs');

function createEchoBrain(id: string, prefix: string) {
  return {
    id,
    displayName: id,
    probe: async () => ({ ok: true, detail: id }),
    async *streamTurn(input: { signal?: AbortSignal }) {
      if (input.signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      const messages = input.messages || [];
      const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
      const text = lastUser?.content || '';
      yield { type: 'text_delta', text: `${prefix}:${text}` };
      yield { type: 'done', stopReason: 'stop' };
    },
  };
}

function readContextSnapshot(storeRoot: string, sessionId: string) {
  const file = path.join(storeRoot, 'sessions', sessionId, 'context-snapshot.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('agent P2 body host concurrency', () => {
  it('serializes concurrent executeTool calls', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    let active = 0;
    let maxActive = 0;
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active -= 1;
        return { ok: true };
      },
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
    });
    await Promise.all([
      host.executeTool('ac.shell.navigate', { view: 'home' }, {}),
      host.executeTool('ac.shell.navigate', { view: 'home' }, {}),
    ]);
    expect(maxActive).toBe(1);
  });

  it('saves reusable skills through the body host', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-host-skills-'));
    const host = createAgentBodyHost({
      getShellView: () => 'home',
      navigateShell: async () => ({ ok: true }),
      companionApiRequest: async () => ({ ok: true, json: {} }),
      getStateSummary: async () => ({}),
      getSkillsRoot: () => tmp,
    });
    const scriptManifest = {
      schemaVersion: 1,
      id: 'cinematic-scene-kit',
      name: 'Cinematic scene kit',
      description: 'Reusable Workflow wrapper for the workflow draft.',
      semver: '0.1.0',
      launch: { kind: 'shell_module', module: 'module/panel.json' },
      run: { command: ['node', 'scripts/run.mjs'], paramsMode: 'env' },
      permissions: ['tool.run'],
    };
    const workbenchPreset = {
      capability: 'workflow_text_to_image',
      modality: 'image',
      canonicalModelId: 'doubao-seedream-5-0',
      providerId: 'volcengine-ark',
      assetContext: { mode: 'current_project' },
    };
    const result = await host.executeTool(
      'ac.skills.save',
      {
        skillId: 'cinematic-scene-character',
        name: '影视级场景和角色',
        description: '团队工作流',
        prompt: '先读取工作台上下文，再执行影视级场景和角色生成。',
        toolHints: ['ac.workbench.get_context', 'ac.workbench.run_capability'],
        workbenchPreset,
        scriptManifest,
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.structured.resourceUri).toBe('skill://cinematic-scene-character');

    const read = await host.executeTool('ac.skills.get', { skillId: 'cinematic-scene-character' }, {});
    expect(read.ok).toBe(true);
    expect(read.structured.workbenchPreset).toMatchObject({
      capability: 'workflow_text_to_image',
      modality: 'image',
      canonicalModelId: 'doubao-seedream-5-0',
    });
    expect(read.structured.scriptManifest).toMatchObject({ id: 'cinematic-scene-kit', semver: '0.1.0' });
    expect(read.structured.prompt).toContain('影视级场景');

    await host.executeTool(
      'ac.skills.save',
      {
        skillId: 'cinematic-scene-character',
        name: '影视级场景和角色 v2',
        prompt: '第二版流程。',
      },
      {},
    );
    const revisions = await host.executeTool('ac.skills.revisions', { skillId: 'cinematic-scene-character' }, {});
    expect(revisions.ok).toBe(true);
    expect(revisions.structured.currentRevision).toBe(2);
    expect(revisions.structured.revisions).toHaveLength(2);
    const readV2 = await host.executeTool('ac.skills.get', { skillId: 'cinematic-scene-character' }, {});
    expect(readV2.ok).toBe(true);
    expect(readV2.structured.workbenchPreset).toMatchObject({
      capability: 'workflow_text_to_image',
      modality: 'image',
      canonicalModelId: 'doubao-seedream-5-0',
    });
    expect(readV2.structured.scriptManifest).toMatchObject({ id: 'cinematic-scene-kit', semver: '0.1.0' });
    const promotion = await host.executeTool(
      'ac.workflow.promote_workbench_preset',
      { skillId: 'cinematic-scene-character', presetName: 'Cinematic scene kit' },
      {},
    );
    expect(promotion.ok).toBe(false);
    expect(promotion.error.code).toBe('AGENT_WORKFLOW_PROMOTION_NOT_READY');
    expect(promotion.structured).toMatchObject({
      publishable: false,
      currentPhase: 'draft_only',
      target: 'workbench_preset',
      plannedTool: 'ac.workflow.promote_workbench_preset',
      skillId: 'cinematic-scene-character',
    });
    expect(promotion.structured.passedGates).toContain('skill_draft_exists');
    expect(promotion.structured.passedGates).toContain('capability_route_schema_valid');
    expect(promotion.structured.missingGates).not.toContain('capability_route_schema_valid');
    if (promotion.structured.modelProviderReadiness?.ok) {
      expect(promotion.structured.passedGates).toContain('model_provider_readiness_checked');
      expect(promotion.structured.missingGates).not.toContain('model_provider_readiness_checked');
    } else {
      expect(promotion.structured.missingGates).toContain('model_provider_readiness_checked');
    }
    expect(promotion.structured.missingGates).toContain('workbench_login_e2e_ready');
    expect(promotion.structured.modelProviderReadiness).toBeTruthy();
    const scriptPromotion = await host.executeTool(
      'ac.workflow.promote_script_hub_tool',
      { skillId: 'cinematic-scene-character', toolName: 'Cinematic scene kit' },
      {},
    );
    expect(scriptPromotion.ok).toBe(false);
    expect(scriptPromotion.error.code).toBe('AGENT_WORKFLOW_PROMOTION_NOT_READY');
    expect(scriptPromotion.structured.passedGates).toContain('skill_draft_exists');
    expect(scriptPromotion.structured.passedGates).toContain('script_manifest_valid');
    expect(scriptPromotion.structured.passedGates).toContain('script_hub_permission_checked');
    expect(scriptPromotion.structured.passedGates).toContain('sandbox_policy_checked');
    expect(scriptPromotion.structured.missingGates).not.toContain('script_manifest_valid');
    expect(scriptPromotion.structured.missingGates).not.toContain('script_hub_permission_checked');
    expect(scriptPromotion.structured.missingGates).not.toContain('sandbox_policy_checked');
    expect(scriptPromotion.structured.missingGates).toContain('admin_confirmation');
    const firstRevision = await host.executeTool(
      'ac.skills.revision_get',
      { skillId: 'cinematic-scene-character', revision: 1 },
      {},
    );
    expect(firstRevision.ok).toBe(true);
    expect(firstRevision.structured.kind).toBe('archived');
    expect(firstRevision.structured.skill.prompt).toContain('先读取工作台上下文');

    const deleted = await host.executeTool('ac.skills.delete', { skillId: 'cinematic-scene-character' }, {});
    expect(deleted.ok).toBe(true);
    expect(deleted.structured.deleted).toBe(true);

    const missing = await host.executeTool('ac.skills.get', { skillId: 'cinematic-scene-character' }, {});
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe('AGENT_SKILL_NOT_FOUND');
  });
});

describe('agent capability unified creation tools', () => {
  it('creates a tool through ac.capability.create_draft without routing to workbench text assets', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const openedTools: string[] = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      runShellTool: async (toolId: string) => {
        openedTools.push(toolId);
        return { ok: true };
      },
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        if (pathname === '/v1/shell-tools/authored/scaffold') {
          return {
            ok: true,
            json: {
              ok: true,
              toolId: body?.id || 'tool-generated',
              path: `F:/tmp/${body?.id || 'tool-generated'}`,
              installed: true,
            },
          };
        }
        if (pathname.includes('/context')) {
          return {
            ok: true,
            json: {
              ok: true,
              session: { id: `capability:tool:${pathname.split('/')[3]}` },
              package: { type: 'tool' },
            },
          };
        }
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const result = await host.executeTool(
      'ac.capability.create_draft',
      {
        name: '随机选择工具',
        intent: '做一个可以维护候选项并随机抽取的小工具',
        type: 'tool',
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.structured.type).toBe('tool');
    expect(String(result.structured.id)).toMatch(/^tool-/);
    expect(openedTools).toEqual([result.structured.id]);
    expect(calls.map((c) => c.pathname)).toContain('/v1/shell-tools/authored/scaffold');
    expect(calls.some((c) => c.pathname.includes('workbench') || c.pathname.includes('create-text-asset'))).toBe(false);
    const scaffold = calls.find((c) => c.pathname === '/v1/shell-tools/authored/scaffold');
    expect(scaffold?.body?.name).toBe('随机选择工具');
    expect(scaffold?.body?.install).toBe(true);
  });

  it('creates a software connection draft through ac.capability.create_draft without asking for a template', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        if (pathname === '/v1/capability-packages/drafts') {
          return {
            ok: true,
            json: {
              ok: true,
              draft: {
                id: body?.id,
                type: 'software_connection',
                name: body?.name,
                manifest: { appName: body?.appName },
              },
            },
          };
        }
        if (pathname === '/v1/capability-packages/spine/context') {
          return {
            ok: true,
            json: {
              ok: true,
              session: {
                type: 'capability',
                id: 'spine',
                sessionId: 'capability:software_connection:spine',
              },
              package: { id: 'spine', type: 'software_connection' },
              recentEvents: [],
            },
          };
        }
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const result = await host.executeTool(
      'ac.capability.create_draft',
      {
        name: 'Spine',
        intent: '添加 Spine 连接，后续可以安装脚本并探测真实连接',
        appName: 'Spine',
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.structured).toMatchObject({ type: 'software_connection', id: 'spine' });
    expect(result.structured.context.session.sessionId).toBe('capability:software_connection:spine');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      pathname: '/v1/capability-packages/drafts',
    });
    expect(calls[0].body).toMatchObject({
      id: 'spine',
      type: 'software_connection',
      name: 'Spine',
      appName: 'Spine',
      createdBy: 'copilot',
    });
    expect(calls[1]).toMatchObject({
      method: 'GET',
      pathname: '/v1/capability-packages/spine/context',
    });
    expect(Object.prototype.hasOwnProperty.call(calls[0].body || {}, 'templateId')).toBe(false);
  });

  it('creates a workflow draft through ac.capability.create_draft without routing to tools or software connections', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const openedTools: string[] = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      runShellTool: async (toolId: string) => {
        openedTools.push(toolId);
        return { ok: true };
      },
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        if (pathname === '/v1/capability-packages/drafts') {
          return {
            ok: true,
            json: {
              ok: true,
              draft: {
                id: body?.id,
                type: 'workflow',
                name: body?.name,
                manifest: body?.manifest,
              },
            },
          };
        }
        if (pathname === '/v1/capability-packages/daily-export-flow/context') {
          return {
            ok: true,
            json: {
              ok: true,
              session: {
                type: 'capability',
                id: 'daily-export-flow',
                sessionId: 'capability:workflow:daily-export-flow',
              },
              package: { id: 'daily-export-flow', type: 'workflow' },
              recentEvents: [],
            },
          };
        }
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const result = await host.executeTool(
      'ac.capability.create_draft',
      {
        id: 'daily-export-flow',
        name: 'Daily Export Flow',
        intent: '创建一个自动导出资产、校验结果、通知用户的工作流',
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.structured).toMatchObject({ type: 'workflow', id: 'daily-export-flow' });
    expect(result.structured.context.session.sessionId).toBe('capability:workflow:daily-export-flow');
    expect(openedTools).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      pathname: '/v1/capability-packages/drafts',
    });
    expect(calls[0].body).toMatchObject({
      id: 'daily-export-flow',
      type: 'workflow',
      name: 'Daily Export Flow',
      createdBy: 'copilot',
    });
    expect(calls[0].body?.manifest).toMatchObject({
      intent: '创建一个自动导出资产、校验结果、通知用户的工作流',
    });
    expect(calls.some((c) => c.pathname === '/v1/shell-tools/authored/scaffold')).toBe(false);
  });

  it('routes unified validate and publish tools through the capability lifecycle endpoint', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        return { ok: true, json: { ok: true, action: body?.action, packageId: pathname.split('/')[3] } };
      },
    });

    const validate = await host.executeTool('ac.capability.validate_draft', { id: 'spine' }, {});
    const publish = await host.executeTool(
      'ac.capability.publish_cloud',
      { id: 'spine', isAdmin: true, semver: '0.2.0', versionNote: '首次可用版本' },
      {},
    );

    expect(validate.ok).toBe(true);
    expect(publish.ok).toBe(true);
    expect(calls).toEqual([
      {
        method: 'POST',
        pathname: '/v1/capability-packages/spine/lifecycle',
        body: { action: 'validate' },
      },
      {
        method: 'POST',
        pathname: '/v1/capability-packages/spine/lifecycle',
        body: {
          action: 'publish',
          actorRole: undefined,
          isAdmin: true,
          semver: '0.2.0',
          versionNote: '首次可用版本',
          publishedBy: undefined,
        },
      },
    ]);
  });

  it('passes safe host process arguments through the unified capability lifecycle endpoint', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        return { ok: true, json: { ok: true, action: body?.action, received: body } };
      },
    });

    const launched = await host.executeTool(
      'ac.capability.lifecycle_run',
      {
        id: 'photoshop',
        action: 'launch',
        executablePath: 'C:/Program Files/Adobe/Adobe Photoshop 2026/Photoshop.exe',
        targetId: 'photoshop-2026',
      },
      {},
    );

    expect(launched.ok).toBe(true);
    expect(calls).toEqual([
      {
        method: 'POST',
        pathname: '/v1/capability-packages/photoshop/lifecycle',
        body: expect.objectContaining({
          action: 'launch',
          executablePath: 'C:/Program Files/Adobe/Adobe Photoshop 2026/Photoshop.exe',
          targetId: 'photoshop-2026',
        }),
      },
    ]);
  });

  it('runs the connection loop according to connectionState maturity', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const contextById: Record<string, Record<string, unknown>> = {
      spine: {
        ok: true,
        connectionState: {
          maturity: 'template_missing',
          label: '模板待接入',
          availableActions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'close', 'export'],
          nextAction: '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。',
        },
      },
      photoshop: {
        ok: true,
        connectionState: {
          maturity: 'bridge_installed',
          label: '已安装待探测',
          availableActions: ['agent_loop', 'conversation', 'install', 'probe', 'uninstall'],
          nextAction: '打开目标软件并探测真实信号。',
        },
      },
    };
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        const id = pathname.split('/')[3];
        if (pathname.endsWith('/context')) return { ok: true, json: contextById[id] };
        if (pathname.endsWith('/events')) return { ok: true, json: { ok: true, event: body } };
        if (pathname.endsWith('/lifecycle')) return { ok: true, json: { ok: true, action: body?.action } };
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const missing = await host.executeTool(
      'ac.capability.connection_loop_run',
      {
        id: 'spine',
        goal: '继续补齐 Spine 连接',
        permissions: ['context.read', 'process.discover', 'process.launch', 'bridge.install', 'connection.probe', 'event.write', 'conversation.open'],
      },
      {},
    );
    expect(missing.ok).toBe(true);
    expect(missing.structured).toMatchObject({
      maturity: 'template_missing',
      plannedSteps: ['event.write.loop_summary', 'conversation.open'],
      nextAction: 'create_software_bridge_driver_plan',
    });
    expect(calls.filter((call) => call.pathname === '/v1/capability-packages/spine/lifecycle').map((call) => call.body?.action)).toEqual([
      'validate',
      'open_conversation',
    ]);
    expect(calls.some((call) => call.pathname === '/v1/capability-packages/spine/lifecycle' && call.body?.action === 'install')).toBe(false);
    expect(calls.some((call) => call.pathname === '/v1/capability-packages/spine/lifecycle' && call.body?.action === 'probe')).toBe(false);
    expect(calls.find((call) => call.pathname === '/v1/capability-packages/spine/events')?.body?.kind).toBe(
      'connection_loop_template_missing',
    );
    expect(calls.find((call) => call.pathname === '/v1/capability-packages/spine/events')?.body?.detail).toMatchObject({
      architecture: 'softwareBridgeRegistry bridge driver required; do not edit capabilityLifecycle.ts.',
    });

    calls.length = 0;
    const installed = await host.executeTool(
      'ac.capability.connection_loop_run',
      {
        id: 'photoshop',
        goal: '探测 Photoshop 连接',
        permissions: ['context.read', 'bridge.install', 'connection.probe', 'event.write'],
      },
      {},
    );
    expect(installed.ok).toBe(true);
    expect(installed.structured).toMatchObject({
      maturity: 'bridge_installed',
      plannedSteps: ['connection.probe', 'event.write.loop_summary'],
    });
    expect(calls.filter((call) => call.pathname === '/v1/capability-packages/photoshop/lifecycle').map((call) => call.body?.action)).toEqual([
      'validate',
      'probe',
    ]);
    expect(calls.find((call) => call.pathname === '/v1/capability-packages/photoshop/events')?.body?.kind).toBe(
      'connection_loop_passed',
    );
    expect(calls.some((call) => call.pathname === '/v1/capability-packages/photoshop/lifecycle' && call.body?.action === 'install')).toBe(
      false,
    );
  });

  it('records failed connection strategies and selects the next candidate', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        if (pathname.endsWith('/context')) {
          return {
            ok: true,
            json: {
              ok: true,
              connectionState: {
                maturity: 'strategy_draft',
                label: '策略草稿',
                availableActions: ['agent_loop', 'conversation'],
                nextAction: '选择下一候选策略',
              },
              strategyDraft: {
                candidateStrategies: [
                  { id: 'script-folder', label: '脚本目录', kind: 'script_folder' },
                  { id: 'manual-bridge-script', label: '手动桥接脚本', kind: 'manual_bridge_script' },
                ],
                recommendedNextStrategy: { id: 'script-folder', label: '脚本目录', kind: 'script_folder' },
              },
            },
          };
        }
        if (pathname.endsWith('/events')) return { ok: true, json: { ok: true, event: body } };
        if (pathname.endsWith('/lifecycle')) return { ok: true, json: { ok: true, action: body?.action } };
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const result = await host.executeTool(
      'ac.capability.connection_loop_run',
      {
        id: 'unknown-app',
        goal: '继续连接未知软件',
        permissions: ['context.read', 'event.write', 'conversation.open'],
        failedStrategyId: 'script-folder',
        failureClass: 'missing_path',
        failureMessage: '脚本目录不存在',
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.structured).toMatchObject({
      maturity: 'strategy_draft',
      plannedSteps: ['event.write.strategy_failed', 'event.write.strategy_next_selected', 'conversation.open'],
      nextAction: 'run_next_connection_strategy',
    });
    expect(calls.find((call) => call.pathname === '/v1/capability-packages/unknown-app/events' && call.body?.kind === 'connection_strategy_failed')?.body).toMatchObject({
      ok: false,
      detail: {
        strategyId: 'script-folder',
        failureClass: 'missing_path',
        nextCandidateStrategy: expect.objectContaining({ id: 'manual-bridge-script' }),
      },
    });
    expect(calls.find((call) => call.pathname === '/v1/capability-packages/unknown-app/events' && call.body?.kind === 'connection_strategy_next_selected')?.body).toMatchObject({
      ok: true,
      detail: {
        failedStrategyIds: ['script-folder'],
        nextCandidateStrategy: expect.objectContaining({ id: 'manual-bridge-script' }),
      },
    });
  });

  it('creates connection template drafts as object events without writing production definitions', async () => {
    const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');
    const calls: Array<{ method: string; pathname: string; body: Record<string, unknown> | null }> = [];
    const host = createAgentBodyHost({
      getShellView: () => 'connections',
      navigateShell: async () => ({ ok: true }),
      getStateSummary: async () => ({}),
      companionApiRequest: async (method: string, pathname: string, body: Record<string, unknown> | null) => {
        calls.push({ method, pathname, body });
        if (pathname === '/v1/capability-packages/spine/events') return { ok: true, json: { ok: true, draft: { events: [body] } } };
        return { ok: false, text: `unexpected ${method} ${pathname}` };
      },
    });

    const result = await host.executeTool(
      'ac.capability.template_draft_create',
      {
        id: 'spine',
        hostId: 'spine',
        appName: 'Spine',
        kind: 'command_port',
      },
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.structured.templateDraft).toMatchObject({
      status: 'draft',
      hostId: 'spine',
      appName: 'Spine',
      kind: 'command_port',
      productionDefinition: false,
    });
    expect(result.structured.templateDraft.files).toContain('local-companion/src/bridges/spineBridgeInstall.ts');
    expect(result.structured.templateDraft.files).toContain('local-companion/src/bridges/templates/spine-command-port.js');
    expect(result.structured.templateDraft.requiredUserDirs).toContain('宿主脚本目录或启动脚本目录');
    expect(result.structured.templateDraft.probeSignal).toContain('command port 返回真实宿主响应');
    expect(result.structured.templateDraft.safetyBoundaries.join('\n')).toContain('端口必须绑定本机');
    expect(calls).toEqual([
      {
        method: 'POST',
        pathname: '/v1/capability-packages/spine/events',
        body: expect.objectContaining({
          kind: 'connection_template_draft_created',
          ok: false,
          detail: expect.objectContaining({
            notProductionDefinition: true,
            publishBlockedUntilRealProbe: true,
            templateDraft: expect.objectContaining({ productionDefinition: false }),
          }),
        }),
      },
    ]);
    expect(calls.some((call) => call.pathname.includes('/bridges/definitions'))).toBe(false);
  });
});

describe('agent P2 L2 cross-brain continuity', () => {
  it('keeps session messages and updates context snapshot after brain switch', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-l2-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();

    const brainA = createEchoBrain('brain_a', 'A');
    const brainB = createEchoBrain('brain_b', 'B');
    let activeBrain = brainA;

    const bodyHost = {
      listTools: async () => [],
      executeTool: async () => ({ ok: true, content: '{}' }),
    };

    const session = createAgentSessionService({
      store,
      bodyHost,
      getBrain: () => activeBrain,
      getShellView: () => 'home',
      gateTool: () => 'allow',
      onEvent: () => {},
    });

    const sessionId = store.getOrCreateDefaultSessionId();

    const r1 = await session.sendUserMessage('first turn');
    expect(r1.ok).toBe(true);
    expect(session.getBrainId()).toBe('brain_a');

    let messages = session.listMessages(sessionId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].meta.brainId).toBe('brain_a');
    expect(messages[1].content).toContain('A:first turn');

    let snap = readContextSnapshot(tmp, sessionId);
    expect(snap.brainId).toBe('brain_a');
    expect(snap.messageCount).toBe(2);
    expect(snap.schemaVersion).toBe(1);

    activeBrain = brainB;
    store.writeSettings({ defaultBrainId: 'brain_b' });

    const r2 = await session.sendUserMessage('second turn');
    expect(r2.ok).toBe(true);
    expect(session.getBrainId()).toBe('brain_b');

    messages = session.listMessages(sessionId);
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('second turn');
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].meta.brainId).toBe('brain_b');
    expect(messages[3].content).toContain('B:second turn');

    snap = readContextSnapshot(tmp, sessionId);
    expect(snap.brainId).toBe('brain_b');
    expect(snap.messageCount).toBe(4);
  });

  it('keeps object-scoped Copilot sessions isolated', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-session-object-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();
    const brain = createEchoBrain('object_brain', 'OBJ');
    const bodyHost = {
      listTools: async () => [],
      executeTool: async () => ({ ok: true, content: '{}' }),
    };
    const session = createAgentSessionService({
      store,
      bodyHost,
      getBrain: () => brain,
      getShellView: () => 'tools',
      gateTool: () => 'allow',
      onEvent: () => {},
    });

    const toolSessionId = 'tool-random-selector';
    const hostSessionId = 'host-maya';
    const toolResult = await session.sendUserMessage('fix export button', { sessionId: toolSessionId });
    const hostResult = await session.sendUserMessage('probe bridge log', { sessionId: hostSessionId });

    expect(toolResult.ok).toBe(true);
    expect(hostResult.ok).toBe(true);
    expect(session.listMessages(toolSessionId).map((m) => m.content).join('\n')).toContain('fix export button');
    expect(session.listMessages(toolSessionId).map((m) => m.content).join('\n')).not.toContain('probe bridge log');
    expect(session.listMessages(hostSessionId).map((m) => m.content).join('\n')).toContain('probe bridge log');
    expect(session.listMessages(hostSessionId).map((m) => m.content).join('\n')).not.toContain('fix export button');
    expect(readContextSnapshot(tmp, toolSessionId).messageCount).toBe(2);
    expect(readContextSnapshot(tmp, hostSessionId).messageCount).toBe(2);
  });

  it('emits structured diagnostics with failed tool status events', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-session-structured-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();
    const events: Array<Record<string, unknown>> = [];
    let turns = 0;
    const brain = {
      id: 'tool_brain',
      displayName: 'tool_brain',
      probe: async () => ({ ok: true }),
      async *streamTurn() {
        turns += 1;
        if (turns === 1) {
          yield { type: 'tool_call', id: 'tc1', name: 'ac.workbench.get_context', arguments: '{}' };
          yield { type: 'done', stopReason: 'tool_calls' };
          return;
        }
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };
    const bodyHost = {
      listTools: async () => [{ name: 'ac.workbench.get_context', risk: 'safe' }],
      executeTool: async () => ({
        ok: false,
        content: '',
        error: { code: 'AGENT_AUTH_REQUIRED', message: '请在工作台登录主站' },
        structured: { authRequired: true, view: 'workbench', nextStep: '请先登录工作台' },
      }),
    };
    const session = createAgentSessionService({
      store,
      bodyHost,
      getBrain: () => brain,
      getShellView: () => 'home',
      gateTool: () => 'allow',
      onEvent: (event: Record<string, unknown>) => events.push(event),
    });

    const result = await session.sendUserMessage('读取工作台上下文');
    expect(result.ok).toBe(true);
    const failed = events.find((event) => event.type === 'tool_status' && event.phase === 'error');
    expect(failed?.errorCode).toBe('AGENT_AUTH_REQUIRED');
    expect(failed?.structured).toEqual({
      authRequired: true,
      view: 'workbench',
      nextStep: '请先登录工作台',
    });
  });

  it('profile system prompt includes seeded skills after layout init', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-profile-'));
    const store = createAgentStore({ getRoot: () => tmp });
    store.ensureLayout();
    const prompt = store.readProfileSystemPrompt();
    expect(prompt).toContain('navigate-workflow');
  });

  it('adds AssetCutter workbench MCP guidance to Codex CLI prompts', () => {
    const prompt = buildCodexPrompt({
      messages: [{ role: 'user', content: '帮我在工作台运行一个文本能力，并读回产物' }],
      tools: [
        { name: 'ac.shell.get_state' },
        { name: 'ac.workbench.ensure_ready' },
        { name: 'ac.workbench.get_context' },
        { name: 'ac.workbench.create_project' },
        { name: 'ac.workbench.run_capability' },
        { name: 'ac.workbench.list_assets' },
        { name: 'ac.workbench.get_asset' },
      ],
    });
    expect(prompt).toContain('AssetCutter Copilot context');
    expect(prompt).toContain('ac.workbench.ensure_ready -> ac.workbench.get_context/create_project/open_project');
    expect(prompt).toContain('ac.workbench.run_capability -> ac.workbench.list_assets -> ac.workbench.get_asset');
    expect(prompt).toContain('AGENT_AUTH_REQUIRED');
    expect(prompt).toContain('User request:');
    expect(prompt).toContain('帮我在工作台运行一个文本能力');
  });
});
