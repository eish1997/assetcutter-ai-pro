'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_VERSION = '0.1.1-rc.2';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;
const DSH_PACKAGE = '@deepseek-ai/dsh';
const PIN_FILE = 'dsh-pin.json';

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function resolveDshCliEntry(root) {
  const base = String(root || '').trim();
  if (!base) return null;
  const pkgPath = path.join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  const bin = pkg && pkg.bin;
  let rel = '';
  if (typeof bin === 'string') rel = bin;
  else if (bin && typeof bin === 'object') rel = String(bin.dsh || Object.values(bin)[0] || '');
  if (!rel) return null;
  const cli = path.resolve(path.dirname(pkgPath), rel);
  return fs.existsSync(cli) ? cli : null;
}

function readDshPin(root) {
  const pinPath = path.join(String(root || ''), PIN_FILE);
  if (!fs.existsSync(pinPath)) return null;
  try {
    const pin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
    return pin && typeof pin === 'object' ? pin : null;
  } catch {
    return null;
  }
}

function buildDshWebArgv(opts = {}) {
  const version = String(opts.version || DEFAULT_VERSION).trim();
  const host = String(opts.host || DEFAULT_HOST).trim();
  const port = Number(opts.port || DEFAULT_PORT);
  if (!isLoopbackHost(host)) {
    throw new Error(`dsh host must be loopback, got ${host}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`dsh port invalid: ${port}`);
  }
  const url = `http://${host}:${port}`;
  const inner = ['web'];
  if (opts.patchFile) inner.push('--patch', String(opts.patchFile));
  inner.push('--no-open', '--host', host, '--port', String(port));
  const cliFile = String(opts.cliFile || '').trim();
  if (cliFile) {
    return {
      command: String(opts.command || 'node'),
      args: [path.resolve(cliFile), ...inner],
      url,
      cwd: opts.cwd ? String(opts.cwd) : undefined,
    };
  }
  return {
    command: 'npx',
    args: ['--yes', `${DSH_PACKAGE}@${version}`, ...inner],
    url,
  };
}

function formatPortBusyError(port) {
  return `dsh port ${port} is already in use`;
}

function defaultHttpGetStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(Number(res.statusCode) || 0);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function isHttpReady(status) {
  return Number(status) >= 200 && Number(status) < 400;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachChildLogs(proc, chunks) {
  if (!proc) return;
  const push = (chunk) => {
    chunks.push(String(chunk || ''));
  };
  if (proc.stdout && typeof proc.stdout.on === 'function') proc.stdout.on('data', push);
  if (proc.stderr && typeof proc.stderr.on === 'function') proc.stderr.on('data', push);
}

function createDshHost(deps = {}) {
  const spawnFn = deps.spawn;
  const listenProbe = deps.listenProbe;
  const httpGetStatus = deps.httpGetStatus || defaultHttpGetStatus;
  let child = null;

  async function waitUntilReady(spec, opts) {
    const timeoutMs = Number(opts.readyTimeoutMs) > 0 ? Number(opts.readyTimeoutMs) : 30000;
    const deadline = Date.now() + timeoutMs;
    let exitCode = null;
    const logs = [];
    attachChildLogs(child, logs);
    if (child && typeof child.on === 'function') {
      child.on('exit', (code) => {
        exitCode = code == null ? 0 : code;
      });
      child.on('error', (err) => {
        logs.push(err instanceof Error ? err.message : String(err));
        exitCode = 1;
      });
    }
    while (Date.now() < deadline) {
      if (exitCode != null) {
        child = null;
        const tail = logs.join('').trim();
        throw new Error(`dsh exited ${exitCode} before ready${tail ? `: ${tail.slice(0, 800)}` : ''}`);
      }
      try {
        const status = await httpGetStatus(spec.url);
        if (isHttpReady(status)) {
          return { url: spec.url, pid: child && child.pid, command: spec.command };
        }
      } catch {
        /* still booting */
      }
      await sleep(200);
    }
    const tail = logs.join('').trim();
    throw new Error(`dsh did not become ready at ${spec.url}${tail ? `: ${tail.slice(0, 800)}` : ''}`);
  }

  async function start(opts = {}) {
    const spec = buildDshWebArgv(opts);
    if (child) return { url: spec.url, pid: child.pid, reused: true };
    const reclaimExternal = opts.reclaimExternal !== false;
    let reusedExternal = false;
    try {
      const status = await httpGetStatus(spec.url);
      if (isHttpReady(status)) reusedExternal = true;
    } catch {
      /* not up yet */
    }
    if (reusedExternal && reclaimExternal && typeof deps.killPortListeners === 'function') {
      await deps.killPortListeners(Number(opts.port || DEFAULT_PORT));
      reusedExternal = false;
    } else if (reusedExternal) {
      return { url: spec.url, pid: null, reused: true };
    }
    if (typeof listenProbe === 'function') {
      const busy = await listenProbe(spec);
      if (busy) throw new Error(formatPortBusyError(Number(opts.port || DEFAULT_PORT)));
    }
    if (typeof spawnFn !== 'function') {
      throw new Error('dsh spawn is not wired');
    }
    const spawnOpts = {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...(opts.env || {}) },
    };
    if (spec.cwd) spawnOpts.cwd = spec.cwd;
    child = spawnFn(spec.command, spec.args, spawnOpts);
    return waitUntilReady(spec, opts);
  }

  function stop() {
    if (!child) return;
    try {
      if (typeof child.kill === 'function') child.kill();
    } catch {
      /* ignore */
    }
    child = null;
  }

  return { start, stop, buildDshWebArgv };
}

module.exports = {
  DEFAULT_VERSION,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DSH_PACKAGE,
  PIN_FILE,
  isLoopbackHost,
  resolveDshCliEntry,
  readDshPin,
  buildDshWebArgv,
  formatPortBusyError,
  createDshHost,
};
