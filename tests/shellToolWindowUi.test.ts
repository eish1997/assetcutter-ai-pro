import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell tool window UI chrome', () => {
  it('uses the shared dark scrollbar treatment for generated tools', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/tool-window.html'), 'utf8');

    expect(html).toContain('scrollbar-gutter: stable');
    expect(html).toContain('.tool-body::-webkit-scrollbar-button');
    expect(html).toContain('display: none');
    expect(html).toContain('.shell-tool-dd-list::-webkit-scrollbar-thumb');
    expect(html).toContain('#toolModuleLog::-webkit-scrollbar-thumb');
    expect(html).toContain('.tool-module-log::-webkit-scrollbar-thumb');
    expect(html).toContain('scrollbar-color: #343946 #07080c');
  });

  it('uses one workspace window with icon rail navigation and no top tabs', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/tool-window.html'), 'utf8');
    const js = readFileSync(join(process.cwd(), 'companion-desktop/shell/tool-window.js'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-tool-window.cjs'), 'utf8');

    expect(html).toContain('id="toolWorkspace"');
    expect(html).toContain('id="toolNavList"');
    expect(html).toContain('grid-template-columns: 52px minmax(0, 1fr)');
    expect(html).toContain('top: 0; left: 52px; right: 0;');
    expect(html).toContain('body.details-hidden .app-titlebar');
    expect(html).toContain('.tool-workspace.details-hidden');
    expect(html).toContain('.tool-nav-list');
    expect(html).toContain('-webkit-app-region: drag');
    expect(html).toContain('-webkit-app-region: no-drag');
    expect(html).not.toContain('id="toolTabs"');
    expect(html).not.toContain('btnToolNavToggle');
    expect(html).not.toContain('.tool-tabs');
    expect(html).not.toContain('.tool-tab');
    expect(js).toContain('const tabs = new Map()');
    expect(js).toContain('function addTool');
    expect(js).toContain('function closeToolTab');
    expect(js).toContain('function setDetailsHidden');
    expect(js).toContain('api.setDetailsCollapsed');
    expect(js).toContain("navBtn.addEventListener('dblclick'");
    expect(js).toContain('setDetailsHidden(!detailsHidden)');
    expect(js).not.toContain('toolTabs');
    expect(js).not.toContain('tabBtn');
    expect(preload).toContain('onOpenTool');
    expect(preload).toContain('onCloseTool');
    expect(preload).toContain('setDetailsCollapsed');
    expect(main).toContain("const SHELL_TOOL_WORKSPACE_KEY = '__tool_workspace__'");
    expect(main).toContain("existing.webContents.send('shell-tool-workspace-open-tool'");
    expect(main).toContain('SHELL_TOOL_WORKSPACE_COLLAPSED_WIDTH = 52');
    expect(main).toContain("shell-tool-window-set-details-collapsed");
  });
});
