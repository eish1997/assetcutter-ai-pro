import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isLoopbackHost,
  buildDshWebArgv,
  formatPortBusyError,
  createDshHost,
  resolveDshCliEntry,
  DEFAULT_VERSION,
} = require('../companion-desktop/dsh-host.cjs') as {
  isLoopbackHost: (host: string) => boolean;
  buildDshWebArgv: (opts?: Record<string, unknown>) => { command: string; args: string[]; url: string; cwd?: string };
  formatPortBusyError: (port: number) => string;
  createDshHost: (deps?: Record<string, unknown>) => {
    start: (opts?: Record<string, unknown>) => Promise<{ url: string; pid?: number; command?: string }>;
    stop: () => void;
  };
  resolveDshCliEntry: (root: string) => string | null;
  DEFAULT_VERSION: string;
};

describe('dsh-host command assembly', () => {
  it('pins version, loopback, --no-open, and returns local url', () => {
    const spec = buildDshWebArgv({ version: '0.1.1-rc.2', host: '127.0.0.1', port: 3080 });
    expect(spec.command).toBe('npx');
    expect(spec.args).toEqual([
      '--yes',
      '@deepseek-ai/dsh@0.1.1-rc.2',
      'web',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '3080',
    ]);
    expect(spec.url).toBe('http://127.0.0.1:3080');
  });

  it('uses the bundled cli instead of npx when cliFile is set', () => {
    const spec = buildDshWebArgv({
      version: DEFAULT_VERSION,
      host: '127.0.0.1',
      port: 3080,
      cliFile: 'C:/dsh-bundled/node_modules/@deepseek-ai/dsh/lib/bin.js',
      command: 'C:/electron.exe',
      cwd: 'C:/dsh-bundled',
      patchFile: 'C:/tmp/cordis.yml',
    });
    expect(spec.command).toBe('C:/electron.exe');
    expect(spec.args[0].replace(/\\/g, '/')).toContain('lib/bin.js');
    expect(spec.args).toContain('web');
    expect(spec.args).toContain('--patch');
    expect(spec.args.indexOf('web')).toBeLessThan(spec.args.indexOf('--patch'));
    expect(spec.args.indexOf('--patch')).toBeLessThan(spec.args.indexOf('--no-open'));
    expect(spec.args).not.toContain('--yes');
    expect(spec.args.some((a) => String(a).includes('@deepseek-ai/dsh@'))).toBe(false);
    expect(spec.cwd).toBe('C:/dsh-bundled');
  });

  it('resolves the pinned package bin from a bundled tree', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bundled-'));
    const pkgDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: { dsh: 'lib/bin.js' } }));
    fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), 'console.log("dsh")\n');
    const cli = resolveDshCliEntry(root);
    expect(cli && cli.replace(/\\/g, '/')).toContain('lib/bin.js');
    expect(resolveDshCliEntry(path.join(root, 'missing'))).toBeNull();
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(() => buildDshWebArgv({ host: '0.0.0.0' })).toThrow(/loopback/);
  });

  it('reuses an already-serving loopback url without spawn', async () => {
    const spawn = vi.fn();
    const host = createDshHost({ spawn, httpGetStatus: async () => 200 });
    const started = await host.start({ version: '0.1.1-rc.2' });
    expect(started.reused).toBe(true);
    expect(started.url).toBe('http://127.0.0.1:3080');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns mock child, waits for HTTP, and stop kills it', async () => {
    let spawned = false;
    const kill = vi.fn();
    const spawn = vi.fn(() => {
      spawned = true;
      return { pid: 4242, kill, on: vi.fn() };
    });
    const host = createDshHost({ spawn, httpGetStatus: async () => (spawned ? 200 : 0) });
    const started = await host.start({ version: '0.1.1-rc.2' });
    expect(started.url).toBe('http://127.0.0.1:3080');
    expect(spawn).toHaveBeenCalledTimes(1);
    const again = await host.start({ version: '0.1.1-rc.2' });
    expect(again.reused).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    host.stop();
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('fails if the child exits before HTTP is ready', async () => {
    const spawn = vi.fn(() => ({
      pid: 3,
      kill: vi.fn(),
      stderr: { on: (ev: string, fn: (chunk: Buffer) => void) => { if (ev === 'data') fn(Buffer.from('boot failed')); } },
      on: (ev: string, fn: (code: number) => void) => {
        if (ev === 'exit') queueMicrotask(() => fn(1));
      },
    }));
    const host = createDshHost({ spawn, httpGetStatus: async () => 0 });
    await expect(host.start({ readyTimeoutMs: 1500 })).rejects.toThrow(/exited 1/);
  });

  it('passes patch file and plugin env to the spawned child', async () => {
    let spawned = false;
    const spawn = vi.fn(() => {
      spawned = true;
      return { pid: 7, kill: vi.fn(), on: vi.fn() };
    });
    const host = createDshHost({ spawn, httpGetStatus: async () => (spawned ? 200 : 0) });
    await host.start({
      version: '0.1.1-rc.2',
      patchFile: 'C:/tmp/cordis.yml',
      env: { ASSETCUTTER_DSH_INJECT: 'C:/tmp/dsh-inject' },
    });
    expect(spawn.mock.calls[0][1]).toContain('--patch');
    expect(spawn.mock.calls[0][1].indexOf('web')).toBeLessThan(spawn.mock.calls[0][1].indexOf('--patch'));
    expect(spawn.mock.calls[0][1].indexOf('--patch')).toBeLessThan(spawn.mock.calls[0][1].indexOf('--no-open'));
    expect(spawn.mock.calls[0][1]).toContain('C:/tmp/cordis.yml');
    expect(spawn.mock.calls[0][2].env.ASSETCUTTER_DSH_INJECT).toBe('C:/tmp/dsh-inject');
  });

  it('passes cwd when starting a bundled cli', async () => {
    let spawned = false;
    const spawn = vi.fn(() => {
      spawned = true;
      return { pid: 9, kill: vi.fn(), on: vi.fn() };
    });
    const host = createDshHost({ spawn, httpGetStatus: async () => (spawned ? 200 : 0) });
    await host.start({
      cliFile: 'C:/dsh-bundled/node_modules/@deepseek-ai/dsh/lib/bin.js',
      command: 'node',
      cwd: 'C:/dsh-bundled',
    });
    expect(spawn.mock.calls[0][0]).toBe('node');
    expect(spawn.mock.calls[0][2].cwd).toBe('C:/dsh-bundled');
  });

  it('returns a clear error when listenProbe says busy', async () => {
    const spawn = vi.fn();
    const host = createDshHost({ spawn, listenProbe: async () => true, httpGetStatus: async () => 0 });
    await expect(host.start({ port: 3080 })).rejects.toThrow(formatPortBusyError(3080));
    expect(spawn).not.toHaveBeenCalled();
  });
});
