import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('function sidebar shell pin', () => {
  it('allows Document PiP from the workbench view and wires pin IPC', () => {
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const preload = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-workbench.cjs'), 'utf8');
    expect(main).toContain('isWorkbenchOwnedPopup');
    expect(main).toContain("frameName === 'ac-function-sidebar'");
    expect(main).toContain("frameName === 'ac-quick-compose'");
    expect(main).toContain('transparent: compose');
    expect(main).toContain('minWidth: compose ? 760 : 220');
    expect(main).toContain('minHeight: compose ? 160 : 320');
    expect(main).toContain('rememberQuickComposePopupWindow');
    expect(main).toContain('isTrackedQuickComposePopupWindow');
    expect(main).toContain("disposition === 'picture-in-picture'");
    expect(main).toContain("action: 'allow'");
    expect(main).toContain('shouldOpenExternalFromWorkbench');
    expect(main).toContain("setParentWindow(null)");
    expect(main).not.toMatch(/openExternal\(details && details\.url\)/);
    expect(main).toContain('frame: false');
    expect(main).toContain('rememberFunctionSidebarPopupWindow');
    expect(main).toContain('resolveFunctionSidebarPopupWindow');
    expect(main).toContain("pinned == null ? !win.isAlwaysOnTop()");
    expect(main).toContain("setAlwaysOnTop(true, 'screen-saver')");
    expect(main).toContain('win.setAlwaysOnTop(false)');
    expect(main).toContain('enableBlinkFeatures: \'DocumentPictureInPictureAPI\'');
    expect(preload).toContain('toggleFunctionSidebarPin');
    expect(preload).toContain('workbench-function-sidebar-toggle-pin');
  });
});
