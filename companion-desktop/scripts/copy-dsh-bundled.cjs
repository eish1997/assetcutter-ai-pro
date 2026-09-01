'use strict';

/**
 * Install the pinned @deepseek-ai/dsh into companion-desktop/dsh-bundled/
 * so electron-builder extraResources can ship the runtime (no user-machine npx).
 *
 * Windows: do not spawn `npm.cmd` (Node 22 EINVAL) or `cmd /c npm` (silent hang).
 * Drive npm via `node npm-cli.js`. If HTTP(S)_PROXY is unset, default to
 * 127.0.0.1:7890 (same as git-push in this repo). Prefer copying an already-
 * extracted npx tree when npm install would take longer than a spawnSync timeout.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DEFAULT_VERSION, DSH_PACKAGE, PIN_FILE, resolveDshCliEntry } = require('../dsh-host.cjs');
const { patchWin32DialogWorkerIpc } = require('./patch-dsh-win32-dialog-worker.cjs');

const desktopDir = path.resolve(__dirname, '..');
const outDir = path.join(desktopDir, 'dsh-bundled');
const spec = `${DSH_PACKAGE}@${DEFAULT_VERSION}`;
const DEFAULT_PROXY = 'http://127.0.0.1:7890';

function resolveNpmCli() {
  const fromNodeHome = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(fromNodeHome)) return fromNodeHome;
  throw new Error(`npm-cli.js not found next to node: ${fromNodeHome}`);
}

function npmEnv() {
  const env = { ...process.env };
  const hasProxy = Boolean(
    env.HTTP_PROXY || env.HTTPS_PROXY || env.http_proxy || env.https_proxy,
  );
  if (!hasProxy) {
    env.HTTP_PROXY = DEFAULT_PROXY;
    env.HTTPS_PROXY = DEFAULT_PROXY;
    env.http_proxy = DEFAULT_PROXY;
    env.https_proxy = DEFAULT_PROXY;
    console.log('[copy-dsh-bundled] HTTP(S)_PROXY unset; using', DEFAULT_PROXY);
  }
  return env;
}

function writePin() {
  fs.writeFileSync(
    path.join(outDir, PIN_FILE),
    `${JSON.stringify({ package: DSH_PACKAGE, version: DEFAULT_VERSION }, null, 2)}\n`,
    'utf8',
  );
}

function alreadyPinned() {
  try {
    const pin = JSON.parse(fs.readFileSync(path.join(outDir, PIN_FILE), 'utf8'));
    if (!pin || pin.package !== DSH_PACKAGE || pin.version !== DEFAULT_VERSION) return false;
    return Boolean(resolveDshCliEntry(outDir));
  } catch {
    return false;
  }
}

function ensureOutPkg() {
  fs.mkdirSync(outDir, { recursive: true });
  const pkgPath = path.join(outDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      `${JSON.stringify({ name: 'assetcutter-dsh-bundled', private: true, version: '0.0.0' }, null, 2)}\n`,
      'utf8',
    );
  }
}

function pinnedCliInTree(root) {
  const cli = resolveDshCliEntry(root);
  if (!cli) return null;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
    );
    if (pkg && pkg.version === DEFAULT_VERSION) return cli;
  } catch {
    return null;
  }
  return null;
}

function listImmediateDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function findExtractedNpxTree() {
  const fromEnv = String(process.env.DSH_BUNDLE_SOURCE || '').trim();
  if (fromEnv && pinnedCliInTree(fromEnv)) return fromEnv;

  const npxRoots = [];
  const npmCache = process.env.npm_config_cache || path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
  npxRoots.push(path.join(npmCache, '_npx'));
  npxRoots.push(path.join(os.tmpdir(), 'cursor-sandbox-cache'));

  const hashDirs = [];
  for (const root of npxRoots) {
    for (const child of listImmediateDirs(root)) {
      hashDirs.push(child);
      hashDirs.push(path.join(child, 'npm', '_npx'));
      for (const nested of listImmediateDirs(path.join(child, 'npm', '_npx'))) hashDirs.push(nested);
    }
  }

  for (const dir of hashDirs) {
    if (pinnedCliInTree(dir)) return dir;
  }
  return null;
}

function copyTree(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function trySeedFromNpx() {
  const src = findExtractedNpxTree();
  if (!src) return false;
  console.log('[copy-dsh-bundled] seed from extracted tree', src);
  const srcMods = path.join(src, 'node_modules');
  const destMods = path.join(outDir, 'node_modules');
  if (!fs.existsSync(srcMods)) return false;
  copyTree(srcMods, destMods);
  return Boolean(resolveDshCliEntry(outDir));
}

function npmInstall() {
  return new Promise((resolve, reject) => {
    const npmCli = resolveNpmCli();
    const args = [npmCli, 'install', spec, '--omit=dev', '--no-fund', '--no-audit'];
    console.log('[copy-dsh-bundled]', process.execPath, args.join(' '), 'in', outDir);
    const child = spawn(process.execPath, args, {
      cwd: outDir,
      stdio: 'inherit',
      env: npmEnv(),
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`npm install ${spec} exceeded 25 minutes`));
    }, 25 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install ${spec} failed with status ${code}`));
    });
  });
}

function applyWin32PickerPatch() {
  const out = patchWin32DialogWorkerIpc(outDir);
  console.log(
    `[copy-dsh-bundled] win32 dialog worker ${out.changed ? 'patched' : 'already patched'}`,
  );
}

async function main() {
  if (alreadyPinned() && process.env.FORCE_DSH_BUNDLE !== '1') {
    console.log('[copy-dsh-bundled] skip (already pinned)', DEFAULT_VERSION, outDir);
    applyWin32PickerPatch();
    return;
  }
  ensureOutPkg();
  if (process.env.FORCE_DSH_BUNDLE !== '1' && trySeedFromNpx()) {
    writePin();
    applyWin32PickerPatch();
    console.log('[copy-dsh-bundled] ok', DEFAULT_VERSION, resolveDshCliEntry(outDir));
    return;
  }
  await npmInstall();
  const cli = resolveDshCliEntry(outDir);
  if (!cli) throw new Error(`dsh cli missing after install in ${outDir}`);
  writePin();
  applyWin32PickerPatch();
  console.log('[copy-dsh-bundled] ok', DEFAULT_VERSION, cli);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
