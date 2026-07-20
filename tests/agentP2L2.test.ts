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
    const result = await host.executeTool(
      'ac.skills.save',
      {
        skillId: 'cinematic-scene-character',
        name: '影视级场景和角色',
        description: '团队工作流',
        prompt: '先读取工作台上下文，再执行影视级场景和角色生成。',
        toolHints: ['ac.workbench.get_context', 'ac.workbench.run_capability'],
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect(result.structured.resourceUri).toBe('skill://cinematic-scene-character');

    const read = await host.executeTool('ac.skills.get', { skillId: 'cinematic-scene-character' }, {});
    expect(read.ok).toBe(true);
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
    expect(prompt).toContain('navigate-scripts');
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
