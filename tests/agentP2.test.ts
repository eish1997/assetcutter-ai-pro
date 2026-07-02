import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { listSkillEntries, buildSkillsContextBlock } = require('../companion-desktop/agent-skills.cjs');
const { appendMemoryNote, listMemoryNotes, buildMemoryContextBlock } = require('../companion-desktop/agent-memory.cjs');
const { createAgentBodyMcpServer } = require('../companion-desktop/agent-body-mcp.cjs');
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

describe('agent P2 tool schemas', () => {
  it('registers four P2 tools totaling 17 ac.*', () => {
    expect(P2_TOOL_SCHEMAS).toHaveLength(4);
    expect(ALL_TOOL_SCHEMAS).toHaveLength(17);
  });
});

describe('agent P2 MCP server', () => {
  it('rejects when disabled', async () => {
    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: false, mcpPort: 19120, mcpToken: 'abc' }),
      writeSettings: (p) => p,
      bodyHost: { listTools: async () => [], executeTool: async () => ({ ok: true, content: '' }) },
      gateTool: () => 'allow',
      readPolicy: () => ({ autoConfirmTools: [] }),
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
      readPolicy: () => ({ autoConfirmTools: [] }),
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
      JSON.stringify({ id: 'demo-skill', name: 'Demo', description: 'mcp resource test' }),
    );

    const server = createAgentBodyMcpServer({
      readSettings: () => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678' }),
      writeSettings: (p) => ({ mcpEnabled: true, mcpPort: 19121, mcpToken: 'test-token-12345678', ...p }),
      bodyHost: {
        listTools: async () => [
          { name: 'ac.shell.get_state', description: 'state', inputSchema: { type: 'object' }, risk: 'safe' },
        ],
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
      const r = await fetch(`http://127.0.0.1:19121/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return r.json();
    };

    const toolsList = await rpc('tools/list');
    expect(toolsList.result.tools).toHaveLength(1);

    const resList = await rpc('resources/list');
    expect(resList.result.resources).toHaveLength(1);
    expect(resList.result.resources[0].uri).toBe('skill://demo-skill');

    const resRead = await rpc('resources/read', { uri: 'skill://demo-skill' });
    expect(resRead.result.contents[0].text).toContain('demo-skill');

    await server.stop();
  });
});
