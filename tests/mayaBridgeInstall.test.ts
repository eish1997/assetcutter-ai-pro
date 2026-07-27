import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAYA_BRIDGE_MARKER_END,
  MAYA_BRIDGE_MARKER_START,
  MAYA_BRIDGE_PY_NAME,
  buildMayaBridgeUserSetupBlock,
  discoverMayaBridgeVersions,
  installMayaBridge,
  removeMayaBridgeUserSetup,
  stripMayaBridgeBlock,
  uninstallMayaBridge,
  upsertMayaBridgeUserSetup,
} from '../local-companion/src/bridges/mayaBridgeInstall.ts';

const temps: string[] = [];

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('mayaBridgeInstall helpers', () => {
  it('builds userSetup block with port and markers', () => {
    const block = buildMayaBridgeUserSetupBlock(7002);
    expect(block).toContain(MAYA_BRIDGE_MARKER_START);
    expect(block).toContain(MAYA_BRIDGE_MARKER_END);
    expect(block).toContain('_ac_maya_bridge_port = 7002');
    expect(block).toContain('127.0.0.1:%d');
    expect(block).toContain('commandPort');
  });

  it('strips marker block idempotently', () => {
    const before = 'print("hi")\n';
    const mid = buildMayaBridgeUserSetupBlock(7001);
    const after = 'print("bye")\n';
    const full = before + mid + after;
    const stripped = stripMayaBridgeBlock(full);
    expect(stripped).not.toContain(MAYA_BRIDGE_MARKER_START);
    expect(stripped).toContain('print("hi")');
    expect(stripped).toContain('print("bye")');
    expect(stripMayaBridgeBlock(stripped)).toBe(stripped);
  });

  it('upserts then removes userSetup marker without duplicating', () => {
    const dir = tempDir('maya-bridge-us-');
    const scripts = join(dir, 'scripts');
    mkdirSync(scripts, { recursive: true });
    const userSetup = join(scripts, 'userSetup.py');
    writeFileSync(userSetup, '# existing\n', 'utf8');

    upsertMayaBridgeUserSetup(userSetup, 7001);
    upsertMayaBridgeUserSetup(userSetup, 7003);
    const text = readFileSync(userSetup, 'utf8');
    expect(text.split(MAYA_BRIDGE_MARKER_START).length - 1).toBe(1);
    expect(text).toContain('_ac_maya_bridge_port = 7003');
    expect(text).toContain('# existing');

    const r = removeMayaBridgeUserSetup(userSetup);
    expect(r.removed).toBe(true);
    const after = readFileSync(userSetup, 'utf8');
    expect(after).not.toContain(MAYA_BRIDGE_MARKER_START);
    expect(after).toContain('# existing');
  });

  it('discovers year and shared scripts under fake MAYA home', () => {
    const home = tempDir('maya-home-');
    const maya = join(home, 'Documents', 'maya');
    mkdirSync(join(maya, '2024', 'scripts'), { recursive: true });
    mkdirSync(join(maya, 'scripts'), { recursive: true });
    writeFileSync(join(maya, '2024', 'scripts', 'userSetup.py'), buildMayaBridgeUserSetupBlock(7001), 'utf8');

    const versions = discoverMayaBridgeVersions({ home });
    const ids = versions.map((v) => v.id).sort();
    expect(ids).toContain('2024');
    expect(ids).toContain('shared');
    const v2024 = versions.find((v) => v.id === '2024');
    expect(v2024?.hasUserSetupMarker).toBe(true);
  });

  it('installs bridge py + userSetup then uninstalls marker (fixture source)', () => {
    const sandbox = tempDir('maya-bridge-sb-');
    const home = tempDir('maya-bridge-home-');
    const srcDir = tempDir('maya-bridge-src-');
    const srcPy = join(srcDir, MAYA_BRIDGE_PY_NAME);
    writeFileSync(srcPy, '# fake bridge\n', 'utf8');

    const scripts = join(home, 'Documents', 'maya', '2022', 'scripts');
    mkdirSync(scripts, { recursive: true });

    process.env.COMPANION_SANDBOX_ROOT = sandbox;
    process.env.COMPANION_MAYA_BRIDGE_SOURCE = srcPy;

    try {
      const inst = installMayaBridge({ home, versions: ['2022'], port: 7001 });
      expect(inst.ok).toBe(true);
      if (!inst.ok) return;
      expect(existsSync(join(scripts, MAYA_BRIDGE_PY_NAME))).toBe(true);
      const us = readFileSync(join(scripts, 'userSetup.py'), 'utf8');
      expect(us).toContain(MAYA_BRIDGE_MARKER_START);

      const again = installMayaBridge({ home, versions: ['2022'], port: 7001 });
      expect(again.ok).toBe(true);
      const us2 = readFileSync(join(scripts, 'userSetup.py'), 'utf8');
      expect(us2.split(MAYA_BRIDGE_MARKER_START).length - 1).toBe(1);

      const un = uninstallMayaBridge({ home, versions: ['2022'] });
      expect(un.ok).toBe(true);
      const us3 = readFileSync(join(scripts, 'userSetup.py'), 'utf8');
      expect(us3).not.toContain(MAYA_BRIDGE_MARKER_START);
      expect(existsSync(join(scripts, MAYA_BRIDGE_PY_NAME))).toBe(true);
    } finally {
      delete process.env.COMPANION_SANDBOX_ROOT;
      delete process.env.COMPANION_MAYA_BRIDGE_SOURCE;
    }
  });
});
