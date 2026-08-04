import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCodexBrainAdapter } = require('../companion-desktop/brain-adapters/codex.cjs');

function createFakeCodexProcess(onPrompt: (prompt: string) => void, outputEvents?: any[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: Writable;
    kill: () => void;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      onPrompt(chunk.toString('utf8'));
      callback();
    },
    final(callback) {
      const events =
        outputEvents ||
        [
          { type: 'thread.started', thread_id: 'thread_123' },
          { type: 'turn.started' },
          { type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text: 'ready' } },
          { type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 3 } },
        ];
      for (const event of events) {
        child.stdout.write(`${JSON.stringify(event)}\n`);
      }
      child.stdout.end();
      setImmediate(() => child.emit('exit', 0));
      callback();
    },
  });
  child.kill = () => {
    child.emit('exit', 1);
  };
  return child;
}

describe('Codex brain adapter', () => {
  it('injects AssetCutter MCP token and writes Codex MCP config for Copilot loopback', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-brain-'));
    const spawns: Array<{ command: string; args: string[]; options: any }> = [];
    const mcpWrites: any[] = [];
    const prompts: string[] = [];
    const store = {
      readSettings: () => ({
        codexCommand: 'codex-test',
        codexCwd: process.cwd(),
        codexModel: 'gpt-5-codex',
        codexSandbox: 'workspace-write',
        mcpEnabled: true,
        mcpToken: 'assetcutter-secret-token',
        mcpPort: 19120,
      }),
      brainsDir: () => tmp,
    };
    const adapter = createCodexBrainAdapter({
      store,
      upsertCodexMcpServerConfig: (options: any) => {
        mcpWrites.push(options);
        return { ok: true, changed: true, path: 'config.toml' };
      },
      spawnCodex: (command: string, args: string[], options: any) => {
        spawns.push({ command, args, options });
        return createFakeCodexProcess((prompt) => prompts.push(prompt));
      },
    });

    const events = [];
    for await (const ev of adapter.streamTurn({
      sessionId: 'session_1',
      messages: [{ role: 'user', content: 'run workbench task' }],
      tools: [{ name: 'ac.workbench.ensure_ready' }, { name: 'ac.workbench.run_capability' }, { name: 'ac.workbench.create_text_asset' }, { name: 'ac.workbench.create_image_asset' }],
    })) {
      events.push(ev);
    }

    expect(mcpWrites).toEqual([
      {
        url: 'http://127.0.0.1:19120/mcp',
        tokenEnvVar: 'ASSETCUTTER_MCP_TOKEN',
        startupTimeoutSec: 30,
      },
    ]);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].command).toBe('codex-test');
    expect(spawns[0].options.env.ASSETCUTTER_MCP_TOKEN).toBe('assetcutter-secret-token');
    expect(spawns[0].options.env.NO_PROXY).toContain('127.0.0.1');
    expect(spawns[0].options.env.HTTP_PROXY).toBeUndefined();
    expect(spawns[0].args).toContain('exec');
    expect(spawns[0].args).toEqual(
      expect.arrayContaining(['--model', 'gpt-5-codex', '--sandbox', 'workspace-write', '-C', process.cwd()]),
    );
    expect(spawns[0].args).toEqual(expect.arrayContaining(['--ignore-rules', '--skip-git-repo-check']));
    expect(spawns[0].args).toEqual(expect.arrayContaining(['--disable', 'plugins']));
    expect(prompts.join('\n')).toContain('AssetCutter Copilot context');
    expect(prompts.join('\n')).toContain('ac.workbench.create_text_asset');
    expect(prompts.join('\n')).toContain('ac.workbench.create_image_asset');
    expect(prompts.join('\n')).toContain('localPath');
    expect(prompts.join('\n')).toContain('mcp__assetcutter-body__');
    expect(prompts.join('\n')).toContain('Do not invent PowerShell');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'activity', phase: 'start', name: 'codex.turn' }),
      expect.objectContaining({ type: 'activity', phase: 'start', name: 'codex.thinking' }),
      expect.objectContaining({ type: 'activity', phase: 'done', name: 'codex.turn' }),
    ]));
    expect(events.some((ev: any) => ev.type === 'usage')).toBe(true);
    expect(events.some((ev: any) => ev.type === 'done')).toBe(true);
  });

  it('turns Codex MCP tool JSON events into compact activity events', async () => {
    const outputEvents = [
      { type: 'thread.started', thread_id: 'thread_456' },
      {
        type: 'item.started',
        item: {
          id: 'tool_1',
          type: 'mcp_tool_call',
          server_name: 'assetcutter-body',
          tool_name: 'ac.workbench.ensure_ready',
          arguments: { requireProject: false },
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'tool_1',
          type: 'mcp_tool_call',
          server_name: 'assetcutter-body',
          tool_name: 'ac.workbench.ensure_ready',
          status: 'failed',
          error: { code: 'AGENT_AUTH_REQUIRED', message: 'login required' },
        },
      },
      { type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 2 } },
    ];
    const store = {
      readSettings: () => ({
        codexCommand: 'codex-test',
        codexCwd: process.cwd(),
        codexSandbox: 'workspace-write',
        mcpEnabled: true,
        mcpToken: 'assetcutter-secret-token',
        mcpPort: 19120,
      }),
      brainsDir: () => process.cwd(),
    };
    const adapter = createCodexBrainAdapter({
      store,
      upsertCodexMcpServerConfig: () => ({ ok: true, changed: false, path: 'config.toml' }),
      spawnCodex: () => createFakeCodexProcess(() => {}, outputEvents),
    });

    const events = [];
    for await (const ev of adapter.streamTurn({
      sessionId: 'session_2',
      messages: [{ role: 'user', content: 'check workbench login' }],
      tools: [{ name: 'ac.workbench.ensure_ready' }],
    })) {
      events.push(ev);
    }

    const activities = events.filter((ev: any) => ev.type === 'activity');
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'start', name: 'codex.turn' }),
      expect.objectContaining({ phase: 'done', name: 'codex.turn' }),
    ]));
    const toolActivities = activities.filter((ev: any) => ev.name === 'codex.ac.workbench.ensure_ready');
    expect(toolActivities).toHaveLength(2);
    expect(toolActivities[0]).toMatchObject({
      phase: 'start',
      name: 'codex.ac.workbench.ensure_ready',
    });
    expect(toolActivities[0].detail).toContain('assetcutter-body');
    expect(toolActivities[0].detail).toContain('requireProject');
    expect(toolActivities[1]).toMatchObject({
      phase: 'error',
      name: 'codex.ac.workbench.ensure_ready',
    });
    expect(toolActivities[1].detail).toContain('AGENT_AUTH_REQUIRED');
  });

  it('starts a fresh Codex thread when the saved thread is stale', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-thread-'));
    fs.writeFileSync(
      path.join(tmp, 'codex-sessions.json'),
      JSON.stringify({
        session_stale: {
          threadId: 'thread_old',
          cwd: process.cwd(),
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
        session_fresh: {
          threadId: 'thread_fresh',
          cwd: process.cwd(),
          updatedAt: '2026-08-04T01:59:00.000Z',
        },
      }),
      'utf8',
    );
    const spawns: Array<{ args: string[] }> = [];
    const store = {
      readSettings: () => ({
        codexCommand: 'codex-test',
        codexCwd: process.cwd(),
        codexSandbox: 'workspace-write',
        mcpEnabled: true,
        mcpToken: 'assetcutter-secret-token',
        mcpPort: 19120,
      }),
      brainsDir: () => tmp,
    };
    const adapter = createCodexBrainAdapter({
      store,
      now: () => Date.parse('2026-08-04T02:30:00.000Z'),
      upsertCodexMcpServerConfig: () => ({ ok: true, changed: false, path: 'config.toml' }),
      spawnCodex: (_command: string, args: string[]) => {
        spawns.push({ args });
        return createFakeCodexProcess(() => {});
      },
    });

    for await (const _ev of adapter.streamTurn({
      sessionId: 'session_stale',
      messages: [{ role: 'user', content: 'say ok' }],
      tools: [],
    })) {
      /* drain */
    }
    for await (const _ev of adapter.streamTurn({
      sessionId: 'session_fresh',
      messages: [{ role: 'user', content: 'say ok' }],
      tools: [],
    })) {
      /* drain */
    }

    expect(spawns[0].args).not.toContain('resume');
    expect(spawns[0].args).not.toContain('thread_old');
    expect(spawns[1].args).toEqual(expect.arrayContaining(['resume', 'thread_fresh']));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('surfaces Codex transport retries without failing the turn', async () => {
    const outputEvents = [
      { type: 'thread.started', thread_id: 'thread_retry' },
      { type: 'turn.started' },
      { type: 'error', message: 'Reconnecting... 2/5 (request timed out)' },
      {
        type: 'item.completed',
        item: {
          id: 'transport_1',
          type: 'error',
          message: 'Falling back from WebSockets to HTTPS transport. request timed out',
        },
      },
      { type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text: 'OK' } },
      { type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 2 } },
    ];
    const store = {
      readSettings: () => ({
        codexCommand: 'codex-test',
        codexCwd: process.cwd(),
        codexSandbox: 'workspace-write',
        mcpEnabled: true,
        mcpToken: 'assetcutter-secret-token',
        mcpPort: 19120,
      }),
      brainsDir: () => process.cwd(),
    };
    const adapter = createCodexBrainAdapter({
      store,
      upsertCodexMcpServerConfig: () => ({ ok: true, changed: false, path: 'config.toml' }),
      spawnCodex: () => createFakeCodexProcess(() => {}, outputEvents),
    });

    const events = [];
    for await (const ev of adapter.streamTurn({
      sessionId: 'session_retry',
      messages: [{ role: 'user', content: 'say ok' }],
      tools: [],
    })) {
      events.push(ev);
    }

    const networkEvents = events.filter((ev: any) => ev.type === 'activity' && ev.name === 'codex.network');
    expect(networkEvents).toHaveLength(2);
    expect(networkEvents[0].detail).toContain('Reconnecting');
    expect(networkEvents[1].detail).toContain('Falling back');
    expect(events.find((ev: any) => ev.type === 'text_delta')).toMatchObject({ text: 'OK' });
    expect(events.some((ev: any) => ev.type === 'error')).toBe(false);
  });

  it('repairs stale Codex models cache before starting a turn', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-cache-'));
    const codexHome = path.join(tmp, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });
    const cachePath = path.join(codexHome, 'models_cache.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        models: [
          {
            slug: 'codex-auto',
            display_name: 'Codex Auto',
            supported_reasoning_levels: ['low', 'medium'],
          },
        ],
      }),
      'utf8',
    );

    const store = {
      readSettings: () => ({
        codexCommand: 'codex-test',
        codexCwd: process.cwd(),
        codexSandbox: 'workspace-write',
        mcpEnabled: true,
        mcpToken: 'assetcutter-secret-token',
        mcpPort: 19120,
      }),
      brainsDir: () => tmp,
    };
    const adapter = createCodexBrainAdapter({
      store,
      codexHome: () => codexHome,
      upsertCodexMcpServerConfig: () => ({ ok: true, changed: false, path: 'config.toml' }),
      spawnCodex: () => createFakeCodexProcess(() => {}),
    });

    const events = [];
    for await (const ev of adapter.streamTurn({
      sessionId: 'session_cache',
      messages: [{ role: 'user', content: 'say ok' }],
      tools: [],
    })) {
      events.push(ev);
    }

    expect(fs.existsSync(cachePath)).toBe(false);
    expect(fs.readdirSync(codexHome).some((name) => name.startsWith('models_cache.json.stale-'))).toBe(true);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'activity', phase: 'done', name: 'codex.cache' }),
    ]));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
