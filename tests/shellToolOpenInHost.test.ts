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

describe('shellToolOpenInHost / transfer-maps-batch', () => {
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

  it('keeps Chinese UI strings in tool.json / panel.json (no mojibake ?????)', () => {
    const toolRaw = JSON.parse(readFileSync(join(transferPkg, 'tool.json'), 'utf8')) as {
      name?: string;
      description?: string;
      tags?: string[];
    };
    const panelRaw = JSON.parse(readFileSync(join(transferPkg, 'module', 'panel.json'), 'utf8')) as {
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
    for (const s of toolRaw.tags || []) {
      expect(String(s || '')).not.toMatch(/\?{2,}/);
    }
    expect(toolRaw.name).toBe('批量传递贴图');
    expect(toolRaw.tags).toEqual(expect.arrayContaining(['贴图', '传递']));
  });

  it('parses transfer-maps-batch tool.json with maya + host.open', () => {
    const raw = JSON.parse(readFileSync(join(transferPkg, 'tool.json'), 'utf8')) as unknown;
    const tool = parseShellToolSpecJson(raw);
    expect(tool?.id).toBe('transfer-maps-batch');
    expect(tool?.permissions).toContain('host.open');
    expect(tool?.maya?.entryModule).toBe('transfermaps.main.maya_entry');
    expect(tool?.maya?.entryFunc).toBe('show_transfer_window');
    expect(tool?.run).toBeUndefined();
  });

  it('parses open_in_host panel action', () => {
    const raw = JSON.parse(readFileSync(join(transferPkg, 'module', 'panel.json'), 'utf8')) as unknown;
    const panel = parseShellToolPanelSpecJson(raw);
    expect(panel?.actions[0]?.kind).toBe('open_in_host');
    expect(panel?.actions[0]?.host).toBe('maya');
  });

  it('validates transfer-maps-batch package directory', () => {
    const r = validateShellToolPackageDir(transferPkg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool.id).toBe('transfer-maps-batch');
      expect(r.panel.actions.some((a) => a.kind === 'open_in_host')).toBe(true);
    }
  });

  it('rejects host.open without maya block', () => {
    const raw = JSON.parse(readFileSync(join(transferPkg, 'tool.json'), 'utf8')) as Record<string, unknown>;
    delete raw.maya;
    expect(parseShellToolSpecJson(raw)).toBeNull();
  });
});
