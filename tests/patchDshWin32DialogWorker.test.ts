import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  BROKEN_POST,
  FIXED_POST,
  patchWin32DialogWorkerIpc,
} = require('../companion-desktop/scripts/patch-dsh-win32-dialog-worker.cjs') as {
  BROKEN_POST: string;
  FIXED_POST: string;
  patchWin32DialogWorkerIpc: (root: string) => { file: string; changed: boolean };
};

function writeFixture(body: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-win32-picker-'));
  const file = path.join(
    root,
    'node_modules',
    '@deepseek-ai',
    'dsh-host-directory-picker-native',
    'lib',
    'worker.cjs',
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `prefix\n${body}\nsuffix\n`, 'utf8');
  return { root, file };
}

describe('patch-dsh-win32-dialog-worker', () => {
  it('keeps IPC open on showing and disconnects only on done/error', () => {
    const { root, file } = writeFixture(BROKEN_POST);
    const first = patchWin32DialogWorkerIpc(root);
    expect(first.changed).toBe(true);
    const patched = fs.readFileSync(file, 'utf8');
    expect(patched).toContain(FIXED_POST);
    expect(patched).not.toContain('\tif (process.connected) process.disconnect();');
    const second = patchWin32DialogWorkerIpc(root);
    expect(second.changed).toBe(false);
  });

  it('fails loudly when the upstream worker shape changes', () => {
    const { root } = writeFixture('const post = (message) => { send(message); };');
    expect(() => patchWin32DialogWorkerIpc(root)).toThrow(/shape changed/);
  });
});
