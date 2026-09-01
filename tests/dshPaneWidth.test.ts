import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DSH_PANE_WIDTH_DEFAULT,
  clampDshPaneWidth,
  readDshPaneWidthFromSettings,
  withDshPaneWidth,
} = require('../companion-desktop/dsh-pane-width.cjs') as {
  DSH_PANE_WIDTH_DEFAULT: number;
  clampDshPaneWidth: (n: unknown) => number;
  readDshPaneWidthFromSettings: (settings: Record<string, unknown> | null) => number;
  withDshPaneWidth: (settings: Record<string, unknown> | null, width: unknown) => Record<string, unknown>;
};

describe('dshPaneWidth persist helpers', () => {
  it('defaults to 480 and clamps 420–900', () => {
    expect(clampDshPaneWidth(undefined)).toBe(480);
    expect(clampDshPaneWidth(419)).toBe(420);
    expect(clampDshPaneWidth(901)).toBe(900);
    expect(readDshPaneWidthFromSettings({})).toBe(DSH_PANE_WIDTH_DEFAULT);
  });

  it('reads and writes dshPaneWidth without touching copilotWidth', () => {
    const next = withDshPaneWidth({ copilotWidth: 360, siteUrl: 'https://example.test' }, 640);
    expect(next.dshPaneWidth).toBe(640);
    expect(next.copilotWidth).toBe(360);
    expect(readDshPaneWidthFromSettings(next)).toBe(640);
  });

  it('persists dshPaneCollapsed separately from width', () => {
    const { readDshPaneCollapsedFromSettings, withDshPaneCollapsed } = require('../companion-desktop/dsh-pane-width.cjs') as {
      readDshPaneCollapsedFromSettings: (settings: Record<string, unknown> | null) => boolean;
      withDshPaneCollapsed: (settings: Record<string, unknown> | null, collapsed: unknown) => Record<string, unknown>;
    };
    const next = withDshPaneCollapsed({ dshPaneWidth: 640 }, true);
    expect(next.dshPaneCollapsed).toBe(true);
    expect(next.dshPaneWidth).toBe(640);
    expect(readDshPaneCollapsedFromSettings(next)).toBe(true);
    expect(readDshPaneCollapsedFromSettings({})).toBe(false);
  });

  it('reserves visible pane width when the host uncollapses dsh for handoff', () => {
    const { resolveDshPaneChrome } = require('../companion-desktop/dsh-pane-width.cjs') as {
      resolveDshPaneChrome: (
        payload: Record<string, unknown>,
        current: { dshPaneCollapsed?: boolean; dshPaneWidthPx?: number },
      ) => { dshPaneCollapsed: boolean; visiblePx: number; dshPaneWidthPx: number };
    };
    const overlaying = resolveDshPaneChrome({}, { dshPaneCollapsed: true, dshPaneWidthPx: 480 });
    expect(overlaying.visiblePx).toBe(0);
    const opened = resolveDshPaneChrome(
      { dshPaneCollapsed: false, dshPaneWidth: 480 },
      { dshPaneCollapsed: true, dshPaneWidthPx: 480 },
    );
    expect(opened.dshPaneCollapsed).toBe(false);
    expect(opened.visiblePx).toBe(480);
  });

  it('wires a workbench drag handle to persist dshPaneWidth', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const html = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const preload = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');
    expect(main).toContain('shell-set-dsh-pane-width');
    expect(main).not.toMatch(/saveShellSettings\(\{[^}]*copilotWidth/);
    expect(html).toContain('dsh-resize-handle');
    expect(html).toContain('setDshPaneWidth');
    expect(html).toContain('btnDshPaneToggle');
    expect(html).toContain('persist: false');
    expect(preload).toContain('setDshPaneWidth');
    expect(preload).toContain('setDshPaneCollapsed');
    expect(main).toContain('dshPaneCollapsed');
    expect(main).toContain('notifyShellChromeLayout');
    expect(main).toContain('saveShellSettings({ dshPaneCollapsed: false })');
    expect(html).toContain('applyDshPaneLayoutFromHost');
    expect(html).toContain('onCopilotLayout');
    expect(main).toContain('shell-leased-room-context-menu');
  });
});
