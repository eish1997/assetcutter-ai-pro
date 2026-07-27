import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAYA_BRIDGE_BOOT_PY_NAME,
  MAYA_BRIDGE_MARKER_END,
  MAYA_BRIDGE_MARKER_START,
  MAYA_BRIDGE_MEL_MARKER_START,
  MAYA_BRIDGE_PY_NAME,
  buildMayaBridgeUserSetupBlock,
  discoverMayaBridgeVersions,
  ensurePy2SourceCodingCookie,
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
    expect(block).toContain('assetcutter_maya_cmdport_boot');
    expect(block).toContain('ensure(7002)');
  });

  it('adds gb18030 coding cookie for Py2 when file has high bytes', () => {
    const gbk = Buffer.from([0x23, 0x20, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]).toString('latin1');
    const out = ensurePy2SourceCodingCookie(gbk);
    expect(out.startsWith('# -*- coding: gb18030 -*-')).toBe(true);
    expect(ensurePy2SourceCodingCookie('# ascii only\n')).toBe('# ascii only\n');
    expect(ensurePy2SourceCodingCookie('# -*- coding: utf-8 -*-\n' + gbk)).toContain('coding: utf-8');
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
    expect(text).toContain('ensure(7003)');
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
    const years = versions.map((v) => v.id.split('::')[0]).sort();
    expect(years).toContain('2024');
    expect(years).toContain('shared');
    const v2024 = versions.find((v) => v.id.startsWith('2024::'));
    expect(v2024?.hasUserSetupMarker).toBe(true);
  });

  it('preserves GBK bytes and adds Py2 coding cookie when upserting', () => {
    const dir = tempDir('maya-bridge-gbk-');
    const scripts = join(dir, 'scripts');
    mkdirSync(scripts, { recursive: true });
    const userSetup = join(scripts, 'userSetup.py');
    const gbkHello = Buffer.from([0x23, 0x20, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]); // "# 你好\n" in GBK
    writeFileSync(userSetup, gbkHello);
    upsertMayaBridgeUserSetup(userSetup, 7001);
    const raw = readFileSync(userSetup);
    expect(raw.includes(gbkHello.subarray(0, gbkHello.length - 1))).toBe(true);
    const text = raw.toString('latin1');
    expect(text).toContain(MAYA_BRIDGE_MARKER_START);
    expect(text).toContain('coding: gb18030');
  });

  it('installing bare year writes boot + mel + all matching scripts roots', () => {
    const sandbox = tempDir('maya-bridge-multi-sb-');
    const home = tempDir('maya-bridge-multi-home-');
    const srcDir = tempDir('maya-bridge-multi-src-');
    const srcPy = join(srcDir, MAYA_BRIDGE_PY_NAME);
    writeFileSync(srcPy, '# fake bridge\n', 'utf8');
    const a = join(home, 'Documents', 'maya', '2020', 'scripts');
    const b = join(home, '文档', 'maya', '2020', 'scripts');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    process.env.COMPANION_SANDBOX_ROOT = sandbox;
    process.env.COMPANION_MAYA_BRIDGE_SOURCE = srcPy;
    try {
      const inst = installMayaBridge({ home, versions: ['2020'], port: 7001 });
      expect(inst.ok).toBe(true);
      if (!inst.ok) return;
      expect(inst.installed.length).toBeGreaterThanOrEqual(2);
      expect(existsSync(join(a, 'userSetup.py'))).toBe(true);
      expect(existsSync(join(a, 'userSetup.mel'))).toBe(true);
      expect(existsSync(join(a, MAYA_BRIDGE_BOOT_PY_NAME))).toBe(true);
      expect(readFileSync(join(a, 'userSetup.mel'), 'latin1')).toContain(MAYA_BRIDGE_MEL_MARKER_START);
      expect(readFileSync(join(a, MAYA_BRIDGE_BOOT_PY_NAME), 'utf8')).toContain('def ensure');
      expect(existsSync(join(b, 'userSetup.py'))).toBe(true);
    } finally {
      delete process.env.COMPANION_SANDBOX_ROOT;
      delete process.env.COMPANION_MAYA_BRIDGE_SOURCE;
    }
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
      const us = readFileSync(join(scripts, 'userSetup.py'), 'latin1');
      expect(us).toContain(MAYA_BRIDGE_MARKER_START);

      const again = installMayaBridge({ home, versions: ['2022'], port: 7001 });
      expect(again.ok).toBe(true);
      const us2 = readFileSync(join(scripts, 'userSetup.py'), 'latin1');
      expect(us2.split(MAYA_BRIDGE_MARKER_START).length - 1).toBe(1);

      const un = uninstallMayaBridge({ home, versions: ['2022'] });
      expect(un.ok).toBe(true);
      const us3 = readFileSync(join(scripts, 'userSetup.py'), 'latin1');
      expect(us3).not.toContain(MAYA_BRIDGE_MARKER_START);
      expect(readFileSync(join(scripts, 'userSetup.mel'), 'latin1')).not.toContain(MAYA_BRIDGE_MEL_MARKER_START);
      expect(existsSync(join(scripts, MAYA_BRIDGE_PY_NAME))).toBe(true);
    } finally {
      delete process.env.COMPANION_SANDBOX_ROOT;
      delete process.env.COMPANION_MAYA_BRIDGE_SOURCE;
    }
  });
});
