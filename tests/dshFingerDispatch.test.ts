import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('dsh finger dispatch cut', () => {
  it('workbench preload exposes dispatchWorkspaceCommand', () => {
    const preload = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-workbench.cjs'), 'utf8');
    expect(preload).toContain('dispatchWorkspaceCommand');
    expect(preload).toContain("timedInvoke('workspace-dispatch'");
  });

  it('shell store is not copied from getContext finger', () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    expect(main).not.toContain('delete rest.connectedHosts');
    expect(main).toContain("ipcMain.handle('workspace-dispatch'");
    expect(main).toContain('refreshDshFingerInject(workspaceDocumentStore.getSnapshot())');
  });

  it('canvas publishes set_finger instead of only a local finger copy', () => {
    const section = fs.readFileSync(path.resolve(process.cwd(), 'components/WorkflowSection.tsx'), 'utf8');
    const bridge = fs.readFileSync(path.resolve(process.cwd(), 'services/agentWorkbenchBridge.ts'), 'utf8');
    const preload = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-workbench.cjs'), 'utf8');
    expect(section).toContain('dispatchWorkspaceSetFinger');
    expect(section).toContain('finger.changed');
    expect(section).toContain('onWorkspaceShellView');
    expect(bridge).toContain("type: 'set_finger'");
    expect(preload).toContain('onWorkspaceShellView');
  });

  it('workbench syncs document assets through hydrate and upsert/remove', () => {
    const preload = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-workbench.cjs'), 'utf8');
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const app = fs.readFileSync(path.resolve(process.cwd(), 'App.tsx'), 'utf8');
    expect(preload).toContain('hydrateWorkspaceDocument');
    expect(main).toContain("ipcMain.handle('workspace-hydrate-document'");
    expect(main).toContain("ipcMain.handle('workspace-read-document'");
    expect(app).toContain('hydrateWorkspaceDocument');
    expect(app).toContain("type: 'upsert_asset'");
    expect(app).toContain("type: 'remove_asset'");
    expect(app).toContain('asset.removed');
  });
});
