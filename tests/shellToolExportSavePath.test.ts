import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell tool export location', () => {
  it('asks for a save path before packing authored tools', () => {
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-page.js'), 'utf8');

    expect(preload).toContain("savePath: (opts) => timedInvoke('shell-save-path'");
    expect(main).toContain("ipcMain.handle('shell-save-path'");
    expect(main).toContain('dialog.showSaveDialog');
    expect(page).toContain("typeof shell.savePath === 'function'");
    expect(page).toContain('if (!picked || picked.canceled) return');
    expect(page).toContain('destZipPath ? { destZipPath } : {}');
    expect(page).toContain("filters: [{ name: 'ZIP', extensions: ['zip'] }]");
  });
});
