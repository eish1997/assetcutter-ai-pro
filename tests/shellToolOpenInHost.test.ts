import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMayaOpenBootstrap } from '../local-companion/src/shellToolOpenInHost.ts';
import {
  parseShellToolPanelSpecJson,
  parseShellToolSpecJson,
  validateShellToolPackageDir,
} from '../local-companion/src/shellToolSpec.ts';

const transferPkg = join(process.cwd(), 'packages', 'shell-tools', 'transfer-maps-batch');
const fbxPkg = join(process.cwd(), 'packages', 'shell-tools', 'maya-export-models-fbx');

describe('shellToolOpenInHost bootstrap', () => {
  it('builds bootstrap that defines run(params) and calls entry', () => {
    const src = buildMayaOpenBootstrap({
      roots: ['F:/tools/transfer-maps-batch/extracted'],
      entryModule: 'transfermaps.main.maya_entry',
      entryFunc: 'show_transfer_window',
    });
    expect(src).toContain('def run(params):');
    expect(src).toContain('transfermaps.main.maya_entry');
    expect(src).toContain('show_transfer_window');
    expect(src).toContain('F:/tools/transfer-maps-batch/extracted');
  });
});

describe('transfer-maps-batch shell tool', () => {
  it('keeps its Maya-host UI entry', () => {
    const toolRaw = JSON.parse(readFileSync(join(transferPkg, 'tool.json'), 'utf8')) as unknown;
    const panelRaw = JSON.parse(readFileSync(join(transferPkg, 'module', 'panel.json'), 'utf8')) as unknown;
    const tool = parseShellToolSpecJson(toolRaw);
    const panel = parseShellToolPanelSpecJson(panelRaw);
    expect(tool?.id).toBe('transfer-maps-batch');
    expect(tool?.semver).toBe('1.1.0');
    expect(tool?.permissions).toContain('host.open');
    expect(tool?.maya?.entryFunc).toBe('show_transfer_window');
    expect(tool?.run).toBeUndefined();
    expect(panel?.actions[0]?.kind).toBe('open_in_host');
    expect(panel?.actions[0]?.host).toBe('maya');
  });
});

describe('maya-export-models-fbx shell tool', () => {
  it('keeps Chinese local shell UI strings', () => {
    const toolRaw = JSON.parse(readFileSync(join(fbxPkg, 'tool.json'), 'utf8')) as {
      name?: string;
      description?: string;
      tags?: string[];
    };
    const panelRaw = JSON.parse(readFileSync(join(fbxPkg, 'module', 'panel.json'), 'utf8')) as {
      title?: string;
      actions?: { label?: string }[];
    };
    const chineseFields = [
      toolRaw.name,
      toolRaw.description,
      panelRaw.title,
      ...(panelRaw.actions || []).map((a) => a.label),
    ];
    for (const s of chineseFields) {
      expect(String(s || ''), String(s)).toMatch(/[\u4e00-\u9fff]/);
      expect(String(s || '')).not.toMatch(/\?{2,}/);
    }
    expect(toolRaw.name).toBe('Maya 模型单独导出 FBX');
    expect(toolRaw.tags).toEqual(expect.arrayContaining(['导出']));
  });

  it('parses tool.json as a local shell run tool', () => {
    const raw = JSON.parse(readFileSync(join(fbxPkg, 'tool.json'), 'utf8')) as unknown;
    const tool = parseShellToolSpecJson(raw);
    expect(tool?.id).toBe('maya-export-models-fbx');
    expect(tool?.semver).toBe('0.2.0');
    expect(tool?.permissions).toContain('tool.run');
    expect(tool?.permissions).toContain('path.pick');
    expect(tool?.run?.command).toEqual(['node', 'scripts/run-export-fbx.mjs']);
    expect(tool?.maya).toBeUndefined();
  });

  it('parses local shell run panel action', () => {
    const raw = JSON.parse(readFileSync(join(fbxPkg, 'module', 'panel.json'), 'utf8')) as unknown;
    const panel = parseShellToolPanelSpecJson(raw);
    expect(panel?.actions[0]?.kind).toBe('run');
    expect(panel?.actions[0]?.label).toBe('导出 FBX');
    expect(panel?.sections.flatMap((s) => s.fields).some((f) => f.id === 'outputDir' && f.type === 'path')).toBe(true);
  });

  it('validates package directory', () => {
    const r = validateShellToolPackageDir(fbxPkg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool.id).toBe('maya-export-models-fbx');
      expect(r.panel.actions.some((a) => a.kind === 'run')).toBe(true);
    }
  });

  it('rejects tool.run without run block', () => {
    const raw = JSON.parse(readFileSync(join(fbxPkg, 'tool.json'), 'utf8')) as Record<string, unknown>;
    delete raw.run;
    expect(parseShellToolSpecJson(raw)).toBeNull();
  });
});
