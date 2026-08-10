import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { executablePathsFromProcessRows, resolveHostExecutable } from '../local-companion/src/bridges/hostAppProcess';
import { readCustomHostTargetsForHost, upsertCustomHostTarget } from '../local-companion/src/bridges/customHostTargets';

describe('host app process control', () => {
  it('resolves only known host executable names', () => {
    const root = join(tmpdir(), 'assetcutter-host-process-test-' + Date.now());
    const blenderDir = join(root, 'Blender Foundation', 'Blender 4.2');
    mkdirSync(blenderDir, { recursive: true });
    const blenderExe = join(blenderDir, 'blender.exe');
    writeFileSync(blenderExe, '');

    const ok = resolveHostExecutable('blender', blenderExe);
    expect(ok.ok).toBe(true);
    expect(ok.executablePath).toBe(blenderExe);
  });

  it('rejects hosts without a process whitelist', () => {
    const result = resolveHostExecutable('unknown-host', 'C:\\Tools\\unknown.exe');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('host_launch_not_supported');
  });

  it('extracts executable paths from already running whitelisted host processes', () => {
    const root = join(tmpdir(), 'assetcutter-host-running-process-test-' + Date.now());
    const blenderDir = join(root, 'Blender 4.4');
    const otherDir = join(root, 'Other');
    mkdirSync(blenderDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    const blenderExe = join(blenderDir, 'blender.exe');
    const otherExe = join(otherDir, 'other.exe');
    writeFileSync(blenderExe, '');
    writeFileSync(otherExe, '');

    const paths = executablePathsFromProcessRows('blender', [
      { Name: 'blender.exe', ExecutablePath: blenderExe },
      { Name: 'other.exe', ExecutablePath: otherExe },
      { Name: 'blender.exe', ExecutablePath: otherExe },
    ]);
    expect(paths).toEqual([blenderExe]);
  });

  it('resolves a selected saved host version before other detected versions', () => {
    const root = join(tmpdir(), 'assetcutter-host-version-test-' + Date.now());
    const previousSandboxRoot = process.env.COMPANION_SANDBOX_ROOT;
    process.env.COMPANION_SANDBOX_ROOT = join(root, 'sandbox');
    try {
      const blender42Dir = join(root, 'Blender 4.2');
      const blender43Dir = join(root, 'Blender 4.3');
      mkdirSync(blender42Dir, { recursive: true });
      mkdirSync(blender43Dir, { recursive: true });
      const blender42Exe = join(blender42Dir, 'blender.exe');
      const blender43Exe = join(blender43Dir, 'blender.exe');
      writeFileSync(blender42Exe, '');
      writeFileSync(blender43Exe, '');

      upsertCustomHostTarget('blender', {
        id: 'blender-42',
        label: 'Blender 4.2',
        inputPath: blender42Dir,
        resolvedPath: blender42Dir,
        targetKind: 'install_dir',
        versionHint: '4.2',
      });
      upsertCustomHostTarget('blender', {
        id: 'blender-43',
        label: 'Blender 4.3',
        inputPath: blender43Dir,
        resolvedPath: blender43Dir,
        targetKind: 'install_dir',
        versionHint: '4.3',
      });

      const result = resolveHostExecutable('blender', { versionId: 'blender-43' });
      expect(result.ok).toBe(true);
      expect(result.executablePath).toBe(blender43Exe);
    } finally {
      if (previousSandboxRoot == null) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = previousSandboxRoot;
    }
  });

  it('falls back to saved running executable paths when the UI sends an install target id', () => {
    const root = join(tmpdir(), 'assetcutter-host-launch-fallback-test-' + Date.now());
    const previousSandboxRoot = process.env.COMPANION_SANDBOX_ROOT;
    process.env.COMPANION_SANDBOX_ROOT = join(root, 'sandbox');
    try {
      const blenderDir = join(root, 'Blender Foundation', 'Blender 4.4');
      const startupDir = join(root, 'Blender Config', '4.4', 'scripts', 'startup');
      mkdirSync(blenderDir, { recursive: true });
      mkdirSync(startupDir, { recursive: true });
      const blenderExe = join(blenderDir, 'blender.exe');
      writeFileSync(blenderExe, '');

      upsertCustomHostTarget('blender', {
        label: 'Blender 4.4（运行中识别）',
        inputPath: blenderExe,
        resolvedPath: blenderDir,
        targetKind: 'install_dir',
        versionHint: '4.4',
      });

      const result = resolveHostExecutable('blender', { targetId: `4.4::${startupDir}` });
      expect(result.ok).toBe(true);
      expect(result.executablePath).toBe(blenderExe);
    } finally {
      if (previousSandboxRoot == null) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = previousSandboxRoot;
    }
  });

  it('recovers saved launch targets from a corrupted custom target file', () => {
    const root = join(tmpdir(), 'assetcutter-host-corrupt-target-test-' + Date.now());
    const previousSandboxRoot = process.env.COMPANION_SANDBOX_ROOT;
    process.env.COMPANION_SANDBOX_ROOT = join(root, 'sandbox');
    try {
      const blenderDir = join(root, 'Blender Foundation', 'Blender 4.5');
      mkdirSync(blenderDir, { recursive: true });
      const blenderExe = join(blenderDir, 'blender.exe');
      writeFileSync(blenderExe, '');
      const stateDir = join(process.env.COMPANION_SANDBOX_ROOT, 'bridges');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, 'custom-host-targets.json'),
        `{
  "blender": [
    {
      "id": "custom::blender::${blenderDir.replace(/\\/g, '\\\\')}",
      "label": "Blender 4.5锛堣繍琛屼腑璇嗗埆锛?,
      "inputPath": "${blenderExe.replace(/\\/g, '\\\\')}",
      "resolvedPath": "${blenderDir.replace(/\\/g, '\\\\')}",
      "targetKind": "install_dir",
      "versionHint": "4.5",
      "createdAt": "2026-08-09T00:00:00.000Z",
      "updatedAt": "2026-08-09T00:00:00.000Z"
    }
  ]
}`,
        'utf8',
      );

      const custom = readCustomHostTargetsForHost('blender');
      expect(custom).toHaveLength(1);
      expect(custom[0].resolvedPath).toBe(blenderDir);
      const result = resolveHostExecutable('blender');
      expect(result.ok).toBe(true);
      expect(result.executablePath).toBe(blenderExe);
    } finally {
      if (previousSandboxRoot == null) delete process.env.COMPANION_SANDBOX_ROOT;
      else process.env.COMPANION_SANDBOX_ROOT = previousSandboxRoot;
    }
  });

  it('exposes launch and close through the local bridge API', () => {
    const http = readFileSync(join(process.cwd(), 'local-companion/src/httpHandler.ts'), 'utf8');
    expect(http).toContain('/(launch|close|discover-running)');
    expect(http).toContain('launchHostApp');
    expect(http).toContain('closeHostApp');
    expect(http).toContain('saveRunningHostTarget');
    expect(http).toContain('versionId');
    expect(http).toContain('targetId');
    const processControl = readFileSync(join(process.cwd(), 'local-companion/src/bridges/hostAppProcess.ts'), 'utf8');
    expect(processControl).toContain('installUsable');
    expect(processControl).toContain('nextStep');
    expect(processControl).toContain('manualTarget');
    expect(processControl).toContain('matchedTargets.length ? matchedTargets : targets');
  });

  it('keeps process specs aligned with every built-in host definition', () => {
    const definitions = readFileSync(join(process.cwd(), 'local-companion/src/bridges/definitions/hostBridgeDefinitions.ts'), 'utf8');
    const processSpecs = readFileSync(join(process.cwd(), 'local-companion/src/bridges/hostAppProcess.ts'), 'utf8');
    const hostIds = [...definitions.matchAll(/^    id: '([^']+)'/gm)].map((match) => match[1]);
    const specIds = new Set([
      ...[...processSpecs.matchAll(/^  '([^']+)': \{/gm)].map((match) => match[1]),
      ...[...processSpecs.matchAll(/^  ([a-z][a-z0-9-]*): \{/gm)].map((match) => match[1]),
    ]);
    expect(hostIds).toHaveLength(62);
    expect(hostIds.filter((id) => !specIds.has(id))).toEqual([]);
  });
});
