import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getShellToolDetail,
  installExampleShellTool,
  installShellToolFromLocalDir,
  listInstalledShellTools,
  resolveExampleShellToolSourceDir,
  uninstallShellTool,
} from '../local-companion/src/shellToolBundles.ts';
import { runShellTool } from '../local-companion/src/shellToolRun.ts';

const examplePkg = join(process.cwd(), 'packages', 'shell-tools', 'example-image-converter');

describe('shellToolBundles', () => {
  let volumeRoot = '';

  beforeEach(() => {
    volumeRoot = mkdtempSync(join(tmpdir(), 'ac-shell-tools-'));
    process.env.COMPANION_VOLUME_ROOT = volumeRoot;
  });

  afterEach(() => {
    delete process.env.COMPANION_VOLUME_ROOT;
    try {
      rmSync(volumeRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('installs from local package dir and lists tool', async () => {
    const { toolId } = await installShellToolFromLocalDir(examplePkg);
    expect(toolId).toBe('image-format-converter');

    const tools = await listInstalledShellTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('图片格式转换');

    const detail = await getShellToolDetail(toolId);
    expect(detail?.panel.title).toBe('图片格式转换');
  });

  it('upgrades atomically and keeps package runnable', async () => {
    await installShellToolFromLocalDir(examplePkg);

    const v2Dir = mkdtempSync(join(tmpdir(), 'ac-tool-v2-'));
    mkdirSync(join(v2Dir, 'module'), { recursive: true });
    mkdirSync(join(v2Dir, 'scripts'), { recursive: true });
    writeFileSync(
      join(v2Dir, 'tool.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'image-format-converter',
        name: '图片格式转换 v2',
        description: 'v2',
        semver: '2.0.0',
        launch: { kind: 'shell_module', module: 'module/panel.json' },
        run: { command: ['node', 'scripts/convert.mjs'], paramsMode: 'env' },
        permissions: ['path.pick', 'tool.run'],
      }),
      'utf8',
    );
    writeFileSync(join(v2Dir, 'module', 'panel.json'), JSON.stringify({
      schemaVersion: 1,
      title: 'v2',
      sections: [{ id: 's', fields: [{ type: 'text', id: 'note', label: 'Note' }] }],
      actions: [{ id: 'convert', label: 'Run', kind: 'run' }],
      outputs: [{ type: 'log', id: 'runLog', label: 'Log' }],
    }), 'utf8');
    writeFileSync(join(v2Dir, 'scripts', 'convert.mjs'), 'console.log("v2");\n', 'utf8');

    await installShellToolFromLocalDir(v2Dir);
    const detail = await getShellToolDetail('image-format-converter');
    expect(detail?.name).toBe('图片格式转换 v2');
    expect(existsSync(join(volumeRoot, 'shell-tools', 'image-format-converter', 'extracted.bak'))).toBe(false);

    rmSync(v2Dir, { recursive: true, force: true });
  });

  it('uninstalls tool directory', async () => {
    const { toolId } = await installShellToolFromLocalDir(examplePkg);
    expect(await uninstallShellTool(toolId)).toBe(true);
    expect(await listInstalledShellTools()).toHaveLength(0);
  });
});

describe('shellToolRun', () => {
  let volumeRoot = '';

  beforeEach(async () => {
    volumeRoot = mkdtempSync(join(tmpdir(), 'ac-shell-run-'));
    process.env.COMPANION_VOLUME_ROOT = volumeRoot;
    await installShellToolFromLocalDir(examplePkg);
  });

  afterEach(() => {
    delete process.env.COMPANION_VOLUME_ROOT;
    try {
      rmSync(volumeRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('runs tool script with env params on existing directory', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'ac-imgs-'));
    writeFileSync(join(workDir, 'a.png'), 'x');

    const result = await runShellTool({
      toolId: 'image-format-converter',
      actionId: 'convert',
      params: { sourceDir: workDir, format: 'webp' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('image-format-converter');
      expect(result.stdout).toContain('找到 1 个图片文件');
    }

    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns tool_not_found for missing id', async () => {
    const result = await runShellTool({ toolId: 'missing-tool', params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('tool_not_found');
  });

  it('installExampleShellTool resolves repo example package', async () => {
    process.env.COMPANION_SHELL_TOOL_EXAMPLE_DIR = examplePkg;
    expect(resolveExampleShellToolSourceDir()).toBe(examplePkg);
    const { toolId } = await installExampleShellTool();
    expect(toolId).toBe('image-format-converter');
    delete process.env.COMPANION_SHELL_TOOL_EXAMPLE_DIR;
  });

  it('resolveExampleShellToolSourceDir finds repo package without env', () => {
    delete process.env.COMPANION_SHELL_TOOL_EXAMPLE_DIR;
    expect(resolveExampleShellToolSourceDir()).toBe(examplePkg);
  });
});
