import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const companionConnect = require('../companion-desktop/companion-connect.cjs');
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');
const { ALL_TOOL_SCHEMAS } = require('../companion-desktop/agent-tool-schemas.cjs');

describe('companionConnect', () => {
  it('uses the same sandbox userData default as the Electron shell on Windows', () => {
    const prevUserData = process.env.AC_COMPANION_USER_DATA;
    const prevSandbox = process.env.AC_COMPANION_SANDBOX_ROOT;
    delete process.env.AC_COMPANION_USER_DATA;
    delete process.env.AC_COMPANION_SANDBOX_ROOT;
    try {
      const userData = companionConnect.defaultCompanionUserDataDir();
      if (process.platform === 'win32') {
        expect(userData.replace(/\\/g, '/')).toContain('/AssetCutterCompanion/sandbox/desktop-shell');
        expect(companionConnect.agentStoreRootFromUserData(userData).replace(/\\/g, '/')).toContain(
          '/AssetCutterCompanion/sandbox/agent-store',
        );
      } else {
        expect(userData).toContain('AssetCutterCompanion');
      }
    } finally {
      if (prevUserData === undefined) delete process.env.AC_COMPANION_USER_DATA;
      else process.env.AC_COMPANION_USER_DATA = prevUserData;
      if (prevSandbox === undefined) delete process.env.AC_COMPANION_SANDBOX_ROOT;
      else process.env.AC_COMPANION_SANDBOX_ROOT = prevSandbox;
    }
  });

  it('keeps explicit companion userData and sandbox overrides', () => {
    const prevUserData = process.env.AC_COMPANION_USER_DATA;
    const prevSandbox = process.env.AC_COMPANION_SANDBOX_ROOT;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-connect-paths-'));
    try {
      process.env.AC_COMPANION_USER_DATA = path.join(tmp, 'custom-user-data');
      delete process.env.AC_COMPANION_SANDBOX_ROOT;
      expect(companionConnect.defaultCompanionUserDataDir()).toBe(path.resolve(path.join(tmp, 'custom-user-data')));

      process.env.AC_COMPANION_SANDBOX_ROOT = path.join(tmp, 'custom-sandbox');
      expect(companionConnect.agentStoreRootFromUserData(path.join(tmp, 'custom-user-data'))).toBe(
        path.join(path.resolve(path.join(tmp, 'custom-sandbox')), 'agent-store'),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (prevUserData === undefined) delete process.env.AC_COMPANION_USER_DATA;
      else process.env.AC_COMPANION_USER_DATA = prevUserData;
      if (prevSandbox === undefined) delete process.env.AC_COMPANION_SANDBOX_ROOT;
      else process.env.AC_COMPANION_SANDBOX_ROOT = prevSandbox;
    }
  });

  it('parseGatewayUrl via hermes host re-export paths', () => {
    const { parseGatewayUrl } = require('../companion-desktop/hermes-gateway-host.cjs');
    const p = parseGatewayUrl('http://127.0.0.1:19119/v1');
    expect(p.baseUrl).toBe('http://127.0.0.1:19119/v1');
    expect(p.port).toBe(19119);
  });

  it('buildConnectBundle includes mcp and scriptHub', () => {
    const bundle = companionConnect.buildConnectBundle({
      readAgentSettings: () => ({
        hermesGatewayUrl: 'http://127.0.0.1:19119/v1',
        hermesApiKey: 'hermes-local',
        hermesModel: 'default',
        hermesManagedGateway: false,
        mcpPort: 19120,
        mcpToken: 'abc123456789012345678901234',
      }),
      readShellSettings: () => ({
        scriptHubUrl: 'http://localhost:5173/',
        scriptHubApiUrl: 'http://localhost:8787/',
        scriptHubApiToken: 'tok',
      }),
    });
    expect(bundle.mcp.mcpServers['assetcutter-body'].url).toContain('19120');
    expect(bundle.scriptHub.apiUrl).toContain('8787');
    expect(bundle.hermes.gatewayUrl).toContain('19119');
    expect(bundle.instructions.join('\n')).toContain(`${ALL_TOOL_SCHEMAS.length} 个 ac.*`);
    expect(bundle.instructions.join('\n')).not.toContain('17 个 ac.*');
    expect(bundle.instructions.join('\n')).toContain('smoke:agent-mcp');
  });

  it('mergeMcpConfig merges assetcutter-body', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-connect-'));
    const cfgPath = path.join(tmp, 'mcp.json');
    fs.writeFileSync(cfgPath, `${JSON.stringify({ mcpServers: { other: { url: 'http://x' } } })}\n`);
    const r = companionConnect.writeHermesMcpImport(
      {
        mcpServers: {
          'assetcutter-body': { url: 'http://127.0.0.1:19120/mcp', headers: { Authorization: 'Bearer t' } },
        },
      },
      { paths: [cfgPath] },
    );
    expect(r.written).toContain(cfgPath);
    const j = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(j.mcpServers.other.url).toBe('http://x');
    expect(j.mcpServers['assetcutter-body'].url).toContain('19120');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exports current connection bundle with a generated MCP token', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-connect-export-'));
    const store = createAgentStore({ getRoot: () => path.join(tmp, 'agent-store') });
    store.ensureLayout();
    const ctx = {
      readAgentSettings: () => store.readSettings(),
      writeAgentSettings: (patch: object) => store.writeSettings(patch),
      readShellSettings: () => ({
        scriptHubUrl: 'http://localhost:5173/',
        scriptHubApiUrl: 'http://localhost:8787/',
        scriptHubApiToken: '',
      }),
      writeShellSettings: (patch: object) => patch,
      getExportRoot: () => path.join(tmp, 'exports'),
    };
    const exported = companionConnect.exportCurrentConnectionBundle(ctx, { writeMcp: false });
    expect(store.readSettings().mcpEnabled).toBe(true);
    expect(String(store.readSettings().mcpToken).length).toBeGreaterThanOrEqual(16);
    expect(fs.existsSync(exported.exported.bundlePath)).toBe(true);
    expect(fs.existsSync(exported.exported.mcpPath)).toBe(true);
    expect(exported.bundle.instructions.join('\n')).toContain(`${ALL_TOOL_SCHEMAS.length} 个 ac.*`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('can write a Codex MCP config from the exported connection bundle without storing the token', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-connect-codex-'));
    const store = createAgentStore({ getRoot: () => path.join(tmp, 'agent-store') });
    store.ensureLayout();
    const codexConfigPath = path.join(tmp, 'codex-home', 'config.toml');
    const ctx = {
      readAgentSettings: () => store.readSettings(),
      writeAgentSettings: (patch: object) => store.writeSettings(patch),
      readShellSettings: () => ({
        scriptHubUrl: 'http://localhost:5173/',
        scriptHubApiUrl: 'http://localhost:8787/',
        scriptHubApiToken: '',
      }),
      writeShellSettings: (patch: object) => patch,
      getExportRoot: () => path.join(tmp, 'exports'),
    };
    const exported = companionConnect.exportCurrentConnectionBundle(ctx, {
      writeMcp: false,
      writeCodexMcp: true,
      codexConfigPath,
    });
    expect(exported.codexMcpWrite.ok).toBe(true);
    expect(exported.codexMcpWrite.written).toContain(codexConfigPath);
    const text = fs.readFileSync(codexConfigPath, 'utf8');
    expect(text).toContain('[mcp_servers.assetcutter-body]');
    expect(text).toContain('bearer_token_env_var = "ASSETCUTTER_MCP_TOKEN"');
    expect(text).not.toContain(String(store.readSettings().mcpToken));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('connectScriptHub does not mark brainSetupCompleted when detect fails', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sh-'));
    const store = createAgentStore({ getRoot: () => path.join(tmp, 'agent-store') });
    store.ensureLayout();
    const shellPath = path.join(tmp, 'companion-shell-settings.json');
    fs.writeFileSync(shellPath, `${JSON.stringify({ scriptHubUrl: 'http://localhost:5173/' })}\n`);
    const ctx = {
      readAgentSettings: () => store.readSettings(),
      writeAgentSettings: (patch: object) => store.writeSettings(patch),
      readShellSettings: () => JSON.parse(fs.readFileSync(shellPath, 'utf8')),
      writeShellSettings: (patch: object) => {
        const cur = JSON.parse(fs.readFileSync(shellPath, 'utf8'));
        const next = { ...cur, ...patch };
        fs.writeFileSync(shellPath, `${JSON.stringify(next, null, 2)}\n`);
        return next;
      },
    };
    const r = await companionConnect.connectScriptHub(ctx, { detect: false });
    expect(r.reachable).toBe(false);
    expect(store.readSettings().brainSetupCompleted).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
