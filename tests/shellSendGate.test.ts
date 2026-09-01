import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell send gate UI', () => {
  it('wires titlebar send gate and subscribes to finger changes', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const gate = readFileSync(join(process.cwd(), 'companion-desktop/shell/shell-send-gate.js'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');

    expect(html).toContain('id="shellSendGate"');
    expect(html).toContain('<script src="shell-send-gate.js"></script>');
    expect(html).toContain('window.ShellSendGate.bind(shell)');
    expect(html).not.toContain('id="connectionsDockBar"');
    expect(gate).toContain('window.ShellSendGate');
    expect(gate).toContain('sendToCurrentHost');
    expect(gate).toContain('getWorkspaceFinger');
    expect(gate).toContain('onWorkspaceFingerChanged');
    expect(gate).toContain('发送到 ▾');
    expect(gate).not.toContain('<select');
    expect(preload).toContain('onWorkspaceFingerChanged');
    expect(preload).toContain('shell-workspace-finger-changed');
    expect(main).toContain("e.type === 'finger.changed'");
    expect(main).toContain("'shell-workspace-finger-changed'");
  });
});
