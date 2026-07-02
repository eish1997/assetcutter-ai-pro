import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const companionConnect = require('../companion-desktop/companion-connect.cjs');
const { createAgentStore } = require('../companion-desktop/agent-store.cjs');

describe('companionConnect', () => {
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
