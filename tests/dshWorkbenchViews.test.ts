import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DSH_SESSION_PARTITION,
  TEAM_SESSION_PARTITION,
  viewsForShellView,
  shellViewShowsDsh,
  sameDshOrigin,
  fingerSurfaceForShellView,
  isDshPartitionAllowed,
} = require('../companion-desktop/dsh-workbench-views.cjs') as {
  DSH_SESSION_PARTITION: string;
  TEAM_SESSION_PARTITION: string;
  viewsForShellView: (
    shellView: string,
    attached: { workbench?: object; dsh?: object; room?: object },
  ) => object[];
  shellViewShowsDsh: (view: string) => boolean;
  sameDshOrigin: (currentUrl: string, targetUrl: string) => boolean;
  fingerSurfaceForShellView: (view: string) => string;
  isDshPartitionAllowed: (partition: string) => boolean;
};

describe('viewsForShellView', () => {
  const workbench = { id: 'wb' };
  const dsh = { id: 'dsh' };

  it('returns both views for workbench', () => {
    expect(viewsForShellView('workbench', { workbench, dsh })).toEqual([workbench, dsh]);
  });

  it('keeps dsh on connections and tools without the workbench view', () => {
    expect(viewsForShellView('connections', { workbench, dsh })).toEqual([dsh]);
    expect(viewsForShellView('tools', { workbench, dsh })).toEqual([dsh]);
  });

  it('attaches the room view with dsh for leased rooms', () => {
    const room = { id: 'room' };
    expect(viewsForShellView('room-abc123-def456', { workbench, dsh, room })).toEqual([room, dsh]);
    expect(fingerSurfaceForShellView('room-abc123-def456')).toBe('room-abc123-def456');
  });

  it('keeps dsh on settings and other left rooms', () => {
    expect(viewsForShellView('settings', { workbench, dsh })).toEqual([dsh]);
    expect(viewsForShellView('workflow', { workbench, dsh })).toEqual([dsh]);
    expect(viewsForShellView('home', { workbench, dsh })).toEqual([dsh]);
    expect(shellViewShowsDsh('workbench')).toBe(true);
    expect(shellViewShowsDsh('connections')).toBe(true);
    expect(shellViewShowsDsh('tools')).toBe(true);
    expect(shellViewShowsDsh('settings')).toBe(true);
    expect(fingerSurfaceForShellView('connections')).toBe('connections');
    expect(fingerSurfaceForShellView('tools')).toBe('tools');
    expect(fingerSurfaceForShellView('workflow')).toBe('workflow');
    expect(fingerSurfaceForShellView('settings')).toBe('settings');
  });

  it('does not treat an in-app dsh route as a different host', () => {
    expect(sameDshOrigin('http://127.0.0.1:3080/chat', 'http://127.0.0.1:3080')).toBe(true);
    expect(sameDshOrigin('http://127.0.0.1:3080/', 'http://127.0.0.1:3080')).toBe(true);
    expect(sameDshOrigin('http://127.0.0.1:3081/', 'http://127.0.0.1:3080')).toBe(false);
    expect(sameDshOrigin('about:blank', 'http://127.0.0.1:3080')).toBe(false);
  });
});

describe('dsh partition', () => {
  it('is not the team partition', () => {
    expect(DSH_SESSION_PARTITION).not.toBe(TEAM_SESSION_PARTITION);
    expect(isDshPartitionAllowed(DSH_SESSION_PARTITION)).toBe(true);
    expect(isDshPartitionAllowed(TEAM_SESSION_PARTITION)).toBe(false);
  });
});

describe('main.cjs workbench+dsh wiring', () => {
  it('adds a second BrowserView on loopback dsh partition and hides workbench copilot', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const html = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    expect(main).toContain('ensureDshBrowserView');
    expect(main).toContain('attachDshBrowserView');
    expect(main).toContain('DSH_SESSION_PARTITION');
    expect(main).toContain("host: '127.0.0.1'");
    expect(main).toContain('dshPaneWidth');
    expect(html).toContain('shell-view-workbench');
    expect(html).toContain('shell-has-dsh');
    expect(html).toContain('onShellViewSync');
    expect(html.indexOf('#dsh-resize-handle {')).toBeLessThan(html.indexOf('body.shell-has-dsh #dsh-resize-handle'));
    expect(main).toContain('shellViewShowsDsh');
    expect(main).toContain('applyShellRoomFinger');
    expect(main).toContain('syncEmbeddedBrowserViews');
    expect(main).toContain('sameDshOrigin');
    expect(main).toContain('isDshBrowserViewLive');
    expect(main).toContain('attachRoomBrowserView');
    expect(main).toContain('ensureRoomBrowserView');
    expect(main).toContain('wc.loadFile(entry)');
    expect(main).toContain('shell-room-reload');
    expect(main).toContain('ROOM_SESSION_PARTITION');
    expect(html).toContain("document.body.classList.add('shell-has-dsh')");
  });
});
