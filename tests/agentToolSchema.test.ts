import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  VALID_SHELL_VIEWS,
  validateArgs,
  buildToolCatalog,
} = require('../companion-desktop/agent-body-host.cjs');

describe('agent P0 tool schemas', () => {
  it('registers exactly four P0 ac.* tools', () => {
    expect(P0_TOOL_SCHEMAS).toHaveLength(4);
    for (const t of P0_TOOL_SCHEMAS) {
      expect(t.name.startsWith('ac.')).toBe(true);
      expect(t.risk).toBe('safe');
    }
    const names = P0_TOOL_SCHEMAS.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'ac.shell.navigate',
      'ac.shell.get_state',
      'ac.shell.login',
      'ac.companion.runtime_status',
    ]);
  });

  it('navigate view enum matches shell views', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    expect(nav).toBeTruthy();
    const enumValues: string[] = nav.inputSchema.properties.view.enum;
    for (const v of enumValues) {
      expect(VALID_SHELL_VIEWS.has(v)).toBe(true);
    }
    expect(enumValues).toContain('scripts');
  });

  it('validateArgs rejects unknown navigate view', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'not-a-view' });
    expect(r.ok).toBe(false);
  });

  it('validateArgs accepts scripts navigate', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'scripts' });
    expect(r.ok).toBe(true);
    expect(r.value.view).toBe('scripts');
  });
});

describe('agent P1 tool schemas', () => {
  it('registers fourteen P1 tools', () => {
    expect(P1_TOOL_SCHEMAS).toHaveLength(14);
  });

  it('ALL_TOOL_SCHEMAS combines P0 P1 P2', () => {
    expect(ALL_TOOL_SCHEMAS).toHaveLength(30);
  });

  it('buildToolCatalog groups tools by surface and summarizes risk', () => {
    const catalog = buildToolCatalog(ALL_TOOL_SCHEMAS);
    expect(catalog.total).toBe(30);
    expect(catalog.riskCounts.safe).toBeGreaterThan(0);
    expect(catalog.riskCounts.confirm).toBeGreaterThan(0);
    const workbench = catalog.surfaces.find((s: { id: string }) => s.id === 'workbench');
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.ensure_ready')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.create_project')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.list_assets')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.get_asset')).toBe(true);
    expect(workbench?.tools.some((t: { name: string }) => t.name === 'ac.workbench.run_capability')).toBe(true);
    const ensureReady = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.ensure_ready');
    expect(ensureReady?.risk).toBe('safe');
    expect(ensureReady?.title).toBe('准备工作台');
    expect(ensureReady?.inputSchema.properties.createIfMissing).toBeTruthy();
    const createProject = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.create_project');
    expect(createProject?.risk).toBe('safe');
    expect(createProject?.title).toBe('创建项目');
    const listAssets = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.list_assets');
    expect(listAssets?.risk).toBe('safe');
    expect(listAssets?.title).toBe('列出资产');
    const getAsset = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.get_asset');
    expect(getAsset?.risk).toBe('safe');
    expect(getAsset?.input.required).toContain('assetId');
    const runCapability = workbench?.tools.find((t: { name: string }) => t.name === 'ac.workbench.run_capability');
    expect(runCapability?.risk).toBe('confirm');
    expect(runCapability?.input.required).toContain('presetId');
    expect(runCapability?.inputSchema.properties.imageDataUrl).toBeTruthy();
    expect(runCapability?.inputSchema).toBeTruthy();
    expect(runCapability?.title).toBe('执行工作台能力');
    expect(runCapability?.whenToUse).toContain('能力预设');
    expect(runCapability?.exampleArguments.presetId).toBe('preset-id');
    expect(runCapability?.successSignals[0]).toContain('run_capability');
    expect(catalog.recommendedFlow[0]).toContain('ac.shell.get_state');
  });
});
