import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadSchema() {
  const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/capability-card-schema.js'), 'utf8');
  const sandbox: { window: Record<string, unknown> } = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.ShellCapabilityCardSchema as {
    actions: (pkg: Record<string, unknown>, opts?: Record<string, unknown>) => string[];
    tags: (pkg: Record<string, unknown>, extra?: Record<string, unknown>) => string[];
    view: (pkg: Record<string, unknown>, opts?: Record<string, unknown>) => {
      title: string;
      subtitle: string;
      description: string;
      status: string;
      tags: string[];
      actions: string[];
    };
    canPublish: (pkg: Record<string, unknown>, opts?: Record<string, unknown>) => boolean;
    canSwitchVersion: (pkg: Record<string, unknown>, opts?: Record<string, unknown>) => boolean;
    versionOptions: (pkg: Record<string, unknown>) => Array<{
      id: string;
      semver: string;
      label: string;
      current: boolean;
      dateLabel: string;
    }>;
  };
}

describe('shell capability card schema', () => {
  it('centralizes software connection cloud actions and tags', () => {
    const schema = loadSchema();
    const pkg = {
      id: 'spine',
      type: 'software_connection',
      source: 'draft',
      hasCloud: true,
      hasCloudMismatch: true,
      cloudVersion: '1.0.0',
      cloudVersions: [{ id: 'v1', semver: '1.0.0' }],
      tags: ['动画'],
      governance: { cloudVersioned: true },
    };

    expect(schema.tags(pkg, { templateHint: 'heartbeat' })).toEqual([
      'software_connection',
      '云端 v1.0.0',
      'heartbeat',
      '动画',
    ]);
    expect(schema.canPublish(pkg, { isAdmin: true })).toBe(true);
    expect(schema.canSwitchVersion(pkg, { isAdmin: true })).toBe(true);
    expect(schema.actions(pkg, { isAdmin: true })).toEqual([
      'agent_loop',
      'conversation',
      'discover_running',
      'launch',
      'install',
      'probe',
      'close',
      'uninstall',
      'export',
      'version',
      'publish',
      'delete',
    ]);
    expect(schema.actions(pkg, { isAdmin: false })).not.toContain('publish');
    expect(schema.view(pkg, { isAdmin: true, templateHint: 'heartbeat' })).toMatchObject({
      title: 'spine',
      subtitle: 'spine',
      description: '本机软件 连接草稿',
      status: 'draft',
      tags: ['software_connection', '云端 v1.0.0', 'heartbeat', '动画'],
      actions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export', 'version', 'publish', 'delete'],
    });
    expect(schema.versionOptions(pkg)).toMatchObject([
      { id: 'v1', semver: '1.0.0', label: '1. v1.0.0 (current)', current: true },
    ]);
  });

  it('uses connectionState for software connection maturity labels and actions', () => {
    const schema = loadSchema();
    const templateMissing = {
      id: 'spine',
      type: 'software_connection',
      source: 'draft',
      hasCloud: false,
      hasCloudMismatch: true,
      tags: ['动画'],
      governance: { cloudVersioned: true },
      connectionState: {
        maturity: 'template_missing',
        label: '模板待接入',
        availableActions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'close', 'export'],
        blockedReason: '当前软件还没有接入真实安装/探测模板。',
        nextAction: '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。',
        publishEligible: false,
      },
    };

    expect(schema.view(templateMissing, { isAdmin: true })).toMatchObject({
      status: '模板待接入',
      tags: ['software_connection', '模板待接入', '动画'],
      actions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'close', 'export', 'delete'],
    });
    expect(schema.actions(templateMissing, { isAdmin: true })).not.toContain('install');
    expect(schema.actions(templateMissing, { isAdmin: true })).not.toContain('probe');
    expect(schema.actions(templateMissing, { isAdmin: true })).not.toContain('publish');
    expect(schema.canPublish(templateMissing, { isAdmin: true })).toBe(false);

    const connected = {
      ...templateMissing,
      hasCloudMismatch: true,
      connectionState: {
        maturity: 'connected',
        label: '已连接',
        availableActions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export'],
        blockedReason: '',
        nextAction: '已收到真实软件信号，可提交云端。',
        publishEligible: true,
      },
    };
    expect(schema.view(connected, { isAdmin: true })).toMatchObject({
      status: '已连接',
      tags: ['software_connection', '已连接', '动画'],
      actions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export', 'publish', 'delete'],
    });
  });

  it('centralizes tool publish and version actions', () => {
    const schema = loadSchema();
    const pkg = {
      id: 'random-selector',
      type: 'tool',
      origin: 'authored',
      hasCloud: true,
      hasCloudVersionMismatch: true,
      reviewStatus: 'local',
      semverLocal: '1.0.0',
      cloudVersions: [{ id: 'v1', semver: '1.0.0', publishedAt: '2026-08-10T00:00:00.000Z' }],
    };

    expect(schema.actions(pkg, { isAdmin: true })).toEqual(['open', 'export', 'version', 'publish']);
    expect(schema.canPublish(pkg, { isAdmin: true })).toBe(true);
    expect(schema.canPublish(pkg, { isAdmin: false })).toBe(false);
    expect(schema.view({ ...pkg, name: '随机选择', displaySemver: '0.1.0' }, { isAdmin: true })).toMatchObject({
      title: '随机选择',
      subtitle: 'random-selector · v0.1.0',
      status: '云端',
      tags: ['tool', '云端'],
      actions: ['open', 'export', 'version', 'publish'],
    });
    expect(schema.versionOptions(pkg)).toMatchObject([
      { id: 'v1', semver: '1.0.0', current: true, dateLabel: '2026-08-10' },
    ]);
  });

  it('keeps workflow actions first-class with local run support', () => {
    const schema = loadSchema();
    const pkg = {
      id: 'daily-export-flow',
      type: 'workflow',
      source: 'draft',
      hasCloud: false,
      hasCloudMismatch: true,
      cloudVersions: [{ id: 'v1', semver: '1.0.0' }],
      governance: { cloudVersioned: true },
      tags: ['automation'],
    };

    expect(schema.canPublish(pkg, { isAdmin: true })).toBe(true);
    expect(schema.canPublish(pkg, { isAdmin: false })).toBe(false);
    expect(schema.actions(pkg, { isAdmin: true })).toEqual([
      'conversation',
      'validate',
      'run',
      'export',
      'version',
      'publish',
      'delete',
    ]);
    expect(schema.view({ ...pkg, name: 'Daily Export Flow' }, { isAdmin: true, fallbackDescription: 'Workflow draft' })).toMatchObject({
      title: 'Daily Export Flow',
      subtitle: 'daily-export-flow',
      description: 'Workflow draft',
      tags: ['workflow', 'automation'],
      actions: ['conversation', 'validate', 'run', 'export', 'version', 'publish', 'delete'],
    });
  });
});
