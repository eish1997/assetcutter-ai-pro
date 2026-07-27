import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildShellToolParamEnv,
  parseShellToolPanelSpecJson,
  parseShellToolSpecJson,
  shellToolParamToEnvKey,
  validateShellToolPackageDir,
} from '../local-companion/src/shellToolSpec.ts';

const examplePkg = join(process.cwd(), 'packages', 'shell-tools', 'example-image-converter');

describe('shellToolSpec', () => {
  it('maps param ids to TOOL_PARAM env keys', () => {
    expect(shellToolParamToEnvKey('sourceDir')).toBe('TOOL_PARAM_SOURCE_DIR');
    expect(shellToolParamToEnvKey('format')).toBe('TOOL_PARAM_FORMAT');
    expect(buildShellToolParamEnv({ sourceDir: '/tmp/x', format: 'webp', recursive: true })).toEqual({
      TOOL_PARAM_SOURCE_DIR: '/tmp/x',
      TOOL_PARAM_FORMAT: 'webp',
      TOOL_PARAM_RECURSIVE: '1',
    });
  });

  it('parses example tool.json', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'tool.json'), 'utf8')) as unknown;
    const tool = parseShellToolSpecJson(raw);
    expect(tool?.id).toBe('image-format-converter');
    expect(tool?.launch.kind).toBe('shell_module');
    expect(tool?.run?.paramsMode).toBe('env');
    expect(tool?.permissions).toContain('tool.run');
  });

  it('parses example panel.json', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'module', 'panel.json'), 'utf8')) as unknown;
    const panel = parseShellToolPanelSpecJson(raw);
    expect(panel?.sections[0]?.fields[0]?.type).toBe('path');
    expect(panel?.actions[0]?.kind).toBe('run');
  });

  it('validates example package directory', () => {
    const r = validateShellToolPackageDir(examplePkg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool.id).toBe('image-format-converter');
      expect(r.panel.title).toBe('图片格式转换');
    }
  });

  it('rejects tool.run without run block', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'tool.json'), 'utf8')) as Record<string, unknown>;
    delete raw.run;
    expect(parseShellToolSpecJson(raw)).toBeNull();
  });

  it('rejects unknown panel field type', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'module', 'panel.json'), 'utf8')) as Record<string, unknown>;
    const sections = raw.sections as { fields: { type: string }[] }[];
    sections[0].fields[0].type = 'customWidget';
    expect(parseShellToolPanelSpecJson(raw)).toBeNull();
  });

  it('rejects paramsMode other than env', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'tool.json'), 'utf8')) as Record<string, unknown>;
    const run = raw.run as Record<string, unknown>;
    run.paramsMode = 'params-file';
    expect(parseShellToolSpecJson(raw)).toBeNull();
  });

  it('accepts open_in_host panel action kind', () => {
    const raw = JSON.parse(readFileSync(join(examplePkg, 'module', 'panel.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const actions = raw.actions as { kind: string; host?: string }[];
    actions[0] = { ...actions[0], kind: 'open_in_host', host: 'maya' };
    // panel alone may parse; package validation still needs host.open + maya on tool
    const panel = parseShellToolPanelSpecJson(raw);
    expect(panel?.actions[0]?.kind).toBe('open_in_host');
    expect(panel?.actions[0]?.host).toBe('maya');
  });
});
