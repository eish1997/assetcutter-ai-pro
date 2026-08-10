import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('connection page UI', () => {
  it('wires the first-class connection page shell', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');

    expect(html).toContain('data-view="connections"');
    expect(html).toContain('aria-label="连接"');
    expect(html).toContain('id="view-connections"');
    expect(html).toContain('id="connectionsEmpty"');
    expect(html).toContain('还没有连接');
    expect(html).toContain('id="btnConnectionCreateWithCopilot"');
    expect(html).toContain('id="btnConnectionImportTransfer"');
    expect(html).toContain('id="connectionsSearch"');
    expect(html).toContain('id="connectionsSummary"');
    expect(html).toContain('id="connectionsInlineStatus"');
    expect(html).toContain('搜索连接、软件、路径或标签');
    expect(html).toContain('对话添加连接');
    expect(html).toContain('导入连接');
    expect(html).toContain('也可以把桌面软件快捷方式或 exe 拖到这里');
    expect(html).toContain('connections-empty-drop');
    expect(html).toContain('<script src="capability-card-schema.js"></script>');
    expect(html).toContain('<script src="capability-version-picker.js"></script>');
    expect(html).toContain('<script src="connection-page.js"></script>');
    expect(html).toContain("connections: $('view-connections')");
    expect(main).toContain("'workbench' | 'workflow' | 'scripts' | 'tools' | 'connections' | 'settings'");
    expect(main).not.toContain("view === 'workflows'");
    expect(main).toContain("view === 'connections'");
    expect(main).toContain('detachAllEmbeddedBrowserViews()');
    expect(preload).toContain('droppedFilePaths');
    expect(preload).toContain('latestDroppedFilePaths');
    expect(preload).toContain("window.addEventListener('drop', rememberDroppedFilePaths, true)");
    expect(preload).toContain('pathsFromDroppedFiles(files)');
    expect(preload).toContain('resolveDroppedConnectionPath');
    expect(preload).toContain('saveTextFile');
    expect(preload).toContain('readTextFile');
    expect(main).toContain("ipcMain.handle('shell-resolve-dropped-connection-path'");
    expect(main).toContain("ipcMain.handle('shell-save-text-file'");
    expect(main).toContain("ipcMain.handle('shell-read-text-file'");
    expect(main).toContain('shell.readShortcutLink');
    expect(main).toContain("['blender.exe', { hostId: 'blender', name: 'Blender' }]");
  });

  it('starts creation from a CapabilityPackage conversation instead of the legacy host catalog', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');

    expect(page).toContain('window.ShellConnectionPage');
    expect(page).toContain('openCreateConnectionCopilot');
    expect(page).toContain('__acOpenCopilotObjectSession');
    expect(page).toContain("type: 'capability'");
    expect(page).toContain('ac.capability.draft_create');
    expect(page).toContain('CapabilityPackage');
    expect(page).toContain('software_connection');
    expect(page).toContain('不要把连接创建成 Workbench 文本资产');
    expect(page).toContain('不要要求用户选择技术模板');
    expect(page).toContain('不要恢复旧 62 宿主默认列表');
    expect(page).not.toContain('HOST_CENTER_FALLBACK_CATALOG');
    expect(page).not.toContain('ShellToolsBridges');
  });

  it('loads only software connection capability package drafts into cards', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');

    expect(page).toContain("shell.api('GET', '/v1/capability-packages/drafts'");
    expect(page).toContain("shell.api('GET', '/v1/capability-packages/cloud'");
    expect(page).toContain('mergePackages(drafts, cloud)');
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/context'");
    expect(page).toContain('fetchCapabilityContext(pkg)');
    expect(page).toContain('sessionId: session.sessionId');
    expect(page).toContain("pkg.type === 'software_connection'");
    expect(page).toContain('renderCard(pkg)');
    expect(page).toContain('data-action="conversation"');
    expect(page).toContain('data-action="agent_loop"');
    expect(page).toContain('data-action="discover_running"');
    expect(page).toContain('data-action="launch"');
    expect(page).toContain('data-action="install"');
    expect(page).toContain('data-action="probe"');
    expect(page).toContain('data-action="close"');
    expect(page).toContain('data-action="uninstall"');
    expect(page).toContain('data-action="export"');
    expect(page).toContain('data-action="delete"');
    expect(page).toContain("runLifecycleAction(pkg, 'discover_running')");
    expect(page).toContain("runLifecycleAction(pkg, 'launch')");
    expect(page).toContain("runLifecycleAction(pkg, 'close')");
    expect(page).toContain('runConnectionAgentLoop(pkg)');
    expect(page).toContain('ac.capability.connection_loop_run');
    expect(page).toContain('当前成熟度:');
    expect(page).toContain('connectionState.maturity');
    expect(page).toContain('不要 mock probe 成功');
    expect(page).toContain('shell.agentSession.send(prompt, sessionId)');
    expect(page).toContain('connection-card-submeta-label">位置');
    expect(page).toContain('connection-card-submeta-label">最近');
    expect(page).toContain('connection-card-submeta-label">状态');
    expect(page).toContain('connection-card-submeta-label">阻塞');
    expect(page).toContain('connection-card-submeta-label">能力');
    expect(page).toContain('connection-card-submeta-label">下一步');
    expect(page).toContain('connectionStateFor(pkg)');
    expect(page).toContain("make('template_missing', '模板待接入'");
    expect(page).toContain('当前软件还没有接入真实安装/探测模板。');
    expect(page).toContain('真实连接需要 Copilot 或开发者补齐模板');
    expect(page).toContain('actionLabel(action)');
    expect(page).toContain('connection-card-availability');
    expect(page).toContain('connection-card-result');
    expect(page).toContain('connection-card-events');
    expect(page).toContain('connection-card-template-draft');
    expect(page).toContain('latestTemplateDraft(pkg)');
    expect(page).toContain('connection_template_draft_created');
    expect(page).toContain('模板草稿');
    expect(page).toContain('真实信号：');
    expect(page).toContain('需要目录：');
    expect(page).toContain('安全边界：');
    expect(page).toContain('最近事件');
    expect(page).toContain('setCardResult(pkg');
    expect(page).toContain('处理中...');
    expect(page).toContain('安装中...');
    expect(page).toContain('探测真实连接信号中...');
    expect(page).toContain('卸载中...');
    expect(page).toContain('connectionState.blockedReason');
    expect(page).toContain('connectionState.nextAction');
    expect(page).toContain('blender_http');
    expect(page).toContain('recentEvents(pkg)');
    expect(page).toContain('matchesSearch(pkg)');
    expect(page).toContain('renderSummary(this.packages, visiblePackages)');
    expect(page).toContain('connections-empty-result');
    expect(page).toContain('没有匹配的连接，换个关键词试试。');
    expect(page).toContain('筛选 ');
    expect(page).toContain("shell.pickPath({ pick: 'folder'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/lifecycle'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/install'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/probe'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/uninstall'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/export'");
    expect(page).toContain("'/v1/capability-packages/import'");
    expect(page).toContain('shell.saveTextFile');
    expect(page).toContain('shell.readTextFile');
    expect(page).toContain("shell.api('DELETE', '/v1/capability-packages/drafts/'");
    expect(page).not.toContain("window.alert('执行失败：'");
    expect(page).not.toContain("window.alert('安装失败：'");
    expect(page).not.toContain("window.alert('探测失败：'");
    expect(page).not.toContain("window.alert('探测成功：'");
    expect(page).not.toContain("window.alert((r.json && r.json.result && r.json.result.message) || '安装完成')");
    expect(page).not.toContain("shell.api('GET', '/v1/bridges'");
    expect(page).not.toContain("shell.api('POST', '/v1/bridges");
  });

  it('focuses a connection card for Workflow repair handoff', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="connectionsSummary"></div>
          <div id="connectionsInlineStatus"></div>
          <div id="connectionsEmpty" class="connections-empty"></div>
          <div id="connectionsList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellConnectionPage;
    page.packages = [{
      id: 'maya',
      type: 'software_connection',
      name: 'Maya',
      source: 'draft',
      status: 'draft',
      manifest: { executablePath: 'C:/Program Files/Autodesk/Maya/maya.exe' },
    }];
    expect(page.focusConnection('maya')).toBe(true);
    expect(dom.window.document.querySelector('[data-connection-id="maya"]')?.className).toContain('is-focused');
    expect(dom.window.document.getElementById('connectionsInlineStatus')?.textContent).toContain('已定位连接：maya');
    expect(page.focusConnection('missing')).toBe(false);
    expect(dom.window.document.getElementById('connectionsInlineStatus')?.textContent).toContain('未找到连接草稿：missing');
  });

  it('creates software connection drafts from dropped shortcuts without bypassing capability packages', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');

    expect(page).toContain('bindDropCreate(shell)');
    expect(page).toContain('connection-drop-active .connections-empty');
    expect(page).toContain("target.addEventListener('drop'");
    expect(page).toContain('handleDroppedConnectionFiles(files)');
    expect(page).toContain('createConnectionFromDroppedPath(first)');
    expect(page).toContain('shell.droppedFilePaths(files)');
    expect(page).toContain('shell.resolveDroppedConnectionPath({ path: rawPath })');
    expect(page).toContain("'/v1/capability-packages/drafts'");
    expect(page).toContain("type: 'software_connection'");
    expect(page).toContain("droppedFrom: 'connection_page'");
    expect(page).toContain('shortcutPath');
    expect(page).toContain('executablePath');
    expect(page).not.toContain("'/v1/bridges/drafts'");
  });

  it('shows admin-only capability cloud publish and existing-version switching', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');

    expect(page).toContain('refreshAdminState(shell)');
    expect(page).toContain("String(user.role || '') === 'admin'");
    expect(page).toContain('ShellCapabilityCardSchema');
    expect(page).toContain('schema.view(pkg');
    expect(page).toContain('ShellCapabilityVersionPicker');
    expect(page).toContain('picker.pick(pkg, versions');
    expect(page).not.toContain("window.prompt('选择要激活的云端版本");
    expect(page).toContain('canPublishPackage(pkg)');
    expect(page).toContain('data-action="publish"');
    expect(page).toContain('data-action="version"');
    expect(page).toContain('>Copilot 处理</button>');
    expect(page).toContain('>对话</button>');
    expect(page).toContain('>识别运行中</button>');
    expect(page).toContain('>启动</button>');
    expect(page).toContain('>安装</button>');
    expect(page).toContain('>探测</button>');
    expect(page).toContain('>关闭</button>');
    expect(page).toContain('>卸载</button>');
    expect(page).toContain('>导出</button>');
    expect(page).toContain('提交云端');
    expect(page).toContain('版本');
    expect(page).toContain('删除草稿');
    expect(page).not.toMatch(/[鐢瀹鎺鍗鐗鎻鍒鑽瀵鏂]/);
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions'");
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions/' + encodeURIComponent(version.id) + '/activate'");
    expect(page).toContain('versionNote');
    expect(page).toContain('actorRole');
    expect(page).toContain('当前账号不是管理员');
  });

  it('refreshes connection cards when Copilot creates a software connection capability', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');

    expect(page).toContain("window.addEventListener('assetcutter:capability-created'");
    expect(page).toContain("detail.type !== 'software_connection'");
    expect(page).toContain('void this.reload(this._shell || shell)');
  });
});
