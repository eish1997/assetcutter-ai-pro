/**
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('shellToolAuthored', () => {
  let volumeRoot = '';
  let prevVolume = '';

  beforeEach(() => {
    volumeRoot = mkdtempSync(join(tmpdir(), 'ac-authored-'));
    prevVolume = process.env.COMPANION_VOLUME_ROOT || '';
    process.env.COMPANION_VOLUME_ROOT = volumeRoot;
  });

  afterEach(() => {
    if (prevVolume) process.env.COMPANION_VOLUME_ROOT = prevVolume;
    else delete process.env.COMPANION_VOLUME_ROOT;
    try {
      rmSync(volumeRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('scaffolds, installs, upserts panel, and packs zip', async () => {
    const mod = await import('../local-companion/src/shellToolAuthored.ts');
    const sc = await mod.scaffoldAuthoredTool({
      id: 'demo-tool',
      name: '演示工具',
      description: '测试',
    });
    expect(sc.toolId).toBe('demo-tool');
    expect(existsSync(join(sc.path, 'tool.json'))).toBe(true);

    const installed = await mod.installAuthoredTool('demo-tool');
    expect(installed.toolId).toBe('demo-tool');

    const panel = {
      schemaVersion: 1,
      title: '演示工具改',
      sections: [
        {
          id: 'main',
          fields: [{ type: 'text', id: 'hello', label: '你好', default: 'world' }],
        },
      ],
      actions: [{ id: 'run', label: '运行', kind: 'run', style: 'primary' }],
      outputs: [{ type: 'log', id: 'runLog', label: '日志' }],
    };
    await mod.upsertAuthoredFiles({
      toolId: 'demo-tool',
      files: [{ path: 'module/panel.json', content: JSON.stringify(panel, null, 2) }],
    });

    const extractedPanel = join(volumeRoot, 'shell-tools', 'demo-tool', 'extracted', 'module', 'panel.json');
    expect(existsSync(extractedPanel)).toBe(true);
    const parsed = JSON.parse(readFileSync(extractedPanel, 'utf8'));
    expect(parsed.title).toBe('演示工具改');

    const packed = await mod.packAuthoredTool('demo-tool');
    expect(packed.bytes).toBeGreaterThan(20);
    expect(packed.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(packed.zipPath)).toBe(true);

    const list = await mod.listAuthoredTools();
    expect(list.some((t) => t.id === 'demo-tool' && t.valid)).toBe(true);
  }, 20000);
});
