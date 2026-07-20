import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveTarget } from '../scripts/agent-mcp-smoke.mjs';

describe('agent MCP smoke script', () => {
  it('loads endpoint and bearer token from mcpServers config', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-mcp-smoke-'));
    const file = path.join(tmp, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          'assetcutter-body': {
            url: 'http://127.0.0.1:19120/mcp',
            headers: { Authorization: 'Bearer test-token' },
          },
        },
      }),
    );

    expect(loadConfig(file)).toEqual({
      url: 'http://127.0.0.1:19120/mcp',
      token: 'test-token',
    });
    expect(resolveTarget({}, ['node', 'script', '--config', file])).toMatchObject({
      url: 'http://127.0.0.1:19120/mcp',
      token: 'test-token',
      workbenchE2e: false,
    });
  });

  it('lets environment override config values', () => {
    expect(
      resolveTarget(
        { AGENT_MCP_URL: 'http://127.0.0.1:19999/mcp', AGENT_MCP_TOKEN: 'env-token' },
        ['node', 'script'],
      ),
    ).toMatchObject({
      url: 'http://127.0.0.1:19999/mcp',
      token: 'env-token',
      workbenchE2e: false,
    });
  });

  it('enables optional authenticated workbench e2e checks from env or args', () => {
    expect(
      resolveTarget(
        {
          AGENT_MCP_WORKBENCH_E2E: '1',
          AGENT_MCP_WORKBENCH_PRESET_ID: 'text_writer',
          AGENT_MCP_WORKBENCH_PROJECT_NAME: 'Smoke Project',
          AGENT_MCP_WORKBENCH_RECOVERY_WAIT_MS: '1500',
        },
        ['node', 'script'],
      ),
    ).toMatchObject({
      workbenchE2e: true,
      workbenchPresetId: 'text_writer',
      workbenchProjectName: 'Smoke Project',
      workbenchRecoveryWaitMs: 1500,
    });
    expect(
      resolveTarget(
        {},
        ['node', 'script', '--workbench-e2e', '--workbench-preset-id', 'demo', '--workbench-recovery-wait-ms', '2500'],
      ),
    ).toMatchObject({
      workbenchE2e: true,
      workbenchPresetId: 'demo',
      workbenchRecoveryWaitMs: 2500,
    });
  });

  it('covers product-grade MCP compatibility checks', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'agent-mcp-smoke.mjs'), 'utf8');
    expect(script).toContain('logging/setLevel');
    expect(script).toContain('resources/subscribe');
    expect(script).toContain('resources/unsubscribe');
    expect(script).toContain('assetcutter://mcp/tool-executions');
    expect(script).toContain('assetcutter://mcp/workbench-flow');
    expect(script).toContain('resource.workbench-flow.read');
    expect(script).toContain('resource.manifest.recovery');
    expect(script).toContain('loginRecoveryTool');
    expect(script).toContain('ac.workbench.ensure_ready');
    expect(script).toContain('ac.workbench.get_context');
    expect(script).toContain('ac.workbench.run_capability.schema');
    expect(script).toContain('imageDataUrl');
    expect(script).toContain('directRunSupported');
    expect(script).toContain('recoverable:');
    expect(script).toContain('recoveryTool');
    expect(script).toContain('isWorkbenchLoginRecoveryTool');
    expect(script).toContain('ac.shell.navigate');
    expect(script).toContain('workbench.e2e.recovery_tool');
    expect(script).toContain('workbench.e2e.recovery_wait');
    expect(script).toContain('workbench-e2e-recovery-login');
    expect(script).toContain('--workbench-recovery-wait-ms');
    expect(script).toContain('--workbench-e2e');
    expect(script).toContain('ac.workbench.ensure_ready');
    expect(script).toContain('workbench.e2e.ensure_ready');
    expect(script).toContain('workbench.e2e.run_capability');
    expect(script).toContain('workbench.e2e.get_asset');
  });
});
