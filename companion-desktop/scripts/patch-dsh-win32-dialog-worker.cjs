'use strict';

/**
 * dsh 0.1.1-rc.2 Win32 folder picker: worker posts {kind:'showing'} then
 * disconnects IPC and exits, so the host never gets {kind:'done'|'error'}.
 * Keep the channel open for showing; close only on a terminal message.
 * Re-applied after every copy-dsh-bundled (including skip-already-pinned).
 */
const fs = require('fs');
const path = require('path');

const WORKER_REL = path.join(
  'node_modules',
  '@deepseek-ai',
  'dsh-host-directory-picker-native',
  'lib',
  'worker.cjs',
);

const BROKEN_POST = [
  'const post = (message) => {',
  '\t/* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */',
  '\tsend(message, () => {',
  '\t\tif (process.connected) process.disconnect();',
  '\t});',
  '};',
].join('\n');

const FIXED_POST = [
  'const post = (message) => {',
  '\tconst terminal = message.kind === "done" || message.kind === "error";',
  '\tsend(message, () => {',
  '\t\tif (terminal && process.connected) process.disconnect();',
  '\t});',
  '};',
].join('\n');

function workerPath(bundledRoot) {
  return path.join(String(bundledRoot || ''), WORKER_REL);
}

function patchWin32DialogWorkerIpc(bundledRoot) {
  const file = workerPath(bundledRoot);
  if (!fs.existsSync(file)) {
    throw new Error(`dsh win32 dialog worker missing: ${file}`);
  }
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('const terminal = message.kind === "done" || message.kind === "error"')) {
    return { file, changed: false };
  }
  if (!src.includes(BROKEN_POST)) {
    throw new Error(
      `dsh win32 dialog worker shape changed; update patch-dsh-win32-dialog-worker.cjs (${file})`,
    );
  }
  fs.writeFileSync(file, src.replace(BROKEN_POST, FIXED_POST), 'utf8');
  return { file, changed: true };
}

module.exports = {
  WORKER_REL,
  BROKEN_POST,
  FIXED_POST,
  workerPath,
  patchWin32DialogWorkerIpc,
};

if (require.main === module) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'dsh-bundled');
  const out = patchWin32DialogWorkerIpc(root);
  console.log(
    `[patch-dsh-win32-dialog-worker] ${out.changed ? 'patched' : 'already patched'} ${out.file}`,
  );
}
