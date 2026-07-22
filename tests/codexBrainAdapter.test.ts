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
  it('configures AssetCutter MCP and passes the MCP token as an environment variable', async () => {
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
      tools: [{ name: 'ac.workbench.ensure_ready' }, { name: 'ac.workbench.run_capability' }],
    })) {
      events.push(ev);
    }

    expect(mcpWrites).toEqual([
      {
        url: 'http://127.0.0.1:19120/mcp',
        tokenEnvVar: 'ASSETCUTTER_MCP_TOKEN',
      },
    ]);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].command).toBe('codex-test');
    expect(spawns[0].options.env.ASSETCUTTER_MCP_TOKEN).toBe('assetcutter-secret-token');
    expect(spawns[0].args).toContain('exec');
    expect(spawns[0].args).toEqual(
      expect.arrayContaining(['--model', 'gpt-5-codex', '--sandbox', 'workspace-write', '-C', process.cwd()]),
    );
    expect(prompts.join('\n')).toContain('AssetCutter Copilot context');
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
        mcpToken: 'assetcutter-secret-token',
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
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      phase: 'start',
      name: 'codex.ac.workbench.ensure_ready',
    });
    expect(activities[0].detail).toContain('assetcutter-body');
    expect(activities[0].detail).toContain('requireProject');
    expect(activities[1]).toMatchObject({
      phase: 'error',
      name: 'codex.ac.workbench.ensure_ready',
    });
    expect(activities[1].detail).toContain('AGENT_AUTH_REQUIRED');
  });
});
