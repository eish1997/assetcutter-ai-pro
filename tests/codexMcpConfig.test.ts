import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const codexMcp = require('../companion-desktop/codex-mcp-config.cjs');

describe('codexMcpConfig', () => {
  it('writes an HTTP MCP server using bearer_token_env_var', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-mcp-'));
    const configPath = path.join(tmp, 'config.toml');
    try {
      const r = codexMcp.upsertCodexMcpServerConfig({
        configPath,
        url: 'http://127.0.0.1:19120/mcp',
        tokenEnvVar: 'ASSETCUTTER_MCP_TOKEN',
      });
      expect(r.ok).toBe(true);
      expect(r.changed).toBe(true);
      const text = fs.readFileSync(configPath, 'utf8');
      expect(text).toContain('[mcp_servers.assetcutter-body]');
      expect(text).toContain('url = "http://127.0.0.1:19120/mcp"');
      expect(text).toContain('bearer_token_env_var = "ASSETCUTTER_MCP_TOKEN"');
      expect(text).toContain('enabled = true');
      expect(text).toContain('required = true');
      expect(text).not.toContain('Bearer ');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preserves unrelated config and replaces the existing AssetCutter block', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-mcp-'));
    const configPath = path.join(tmp, 'config.toml');
    try {
      fs.writeFileSync(
        configPath,
        [
          'model = "gpt-5"',
          '',
          '[mcp_servers.node_repl]',
          'command = "node"',
          '',
          '[mcp_servers.assetcutter-body]',
          'url = "http://old/mcp"',
          'bearer_token_env_var = "OLD_TOKEN"',
          '',
          '[profiles.default]',
          'approval_policy = "never"',
          '',
        ].join('\n'),
        'utf8',
      );
      codexMcp.upsertCodexMcpServerConfig({
        configPath,
        url: 'http://127.0.0.1:19121/mcp',
        tokenEnvVar: 'ASSETCUTTER_MCP_TOKEN',
      });
      const text = fs.readFileSync(configPath, 'utf8');
      expect(text).toContain('model = "gpt-5"');
      expect(text).toContain('[mcp_servers.node_repl]');
      expect(text).toContain('[profiles.default]');
      expect(text).toContain('url = "http://127.0.0.1:19121/mcp"');
      expect(text).not.toContain('http://old/mcp');
      expect(text).not.toContain('OLD_TOKEN');
      expect((text.match(/\[mcp_servers\.assetcutter-body\]/g) || []).length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('builds Codex config from an exported MCP client config without copying the token', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-mcp-'));
    const configPath = path.join(tmp, 'config.toml');
    try {
      const mcpConfig = {
        mcpServers: {
          'assetcutter-body': {
            url: 'http://127.0.0.1:19120/mcp',
            headers: { Authorization: 'Bearer secret-token-value' },
          },
        },
      };
      const r = codexMcp.upsertCodexMcpServerFromClientConfig(mcpConfig, { configPath });
      expect(r.ok).toBe(true);
      const text = fs.readFileSync(configPath, 'utf8');
      expect(text).toContain('bearer_token_env_var');
      expect(text).not.toContain('secret-token-value');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('buildCodexSpawnEnv clears HTTP proxies and injects MCP token for loopback', () => {
    const env = codexMcp.buildCodexSpawnEnv(
      {
        PATH: 'x',
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'example.com',
      },
      { mcpToken: 'token-value-123456789012' },
    );
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.ASSETCUTTER_MCP_TOKEN).toBe('token-value-123456789012');
    expect(env.NO_PROXY).toContain('127.0.0.1');
    expect(env.NO_PROXY).toContain('example.com');
  });
});
