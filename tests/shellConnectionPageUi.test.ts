import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

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
    expect(html).toContain('id="btnConnectionsDiscoverRunning"');
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
    expect(main).toContain("'workbench' | 'workflow' | 'tools' | 'connections' | 'settings'");
    expect(main).toContain("if (view === 'scripts') return 'workflow'");
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
    expect(page).toContain('discoverRunningConnections()');
    expect(page).toContain('btnConnectionsDiscoverRunning');
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
    expect(page).toContain('connection-card-fact-label">软件版本');
    expect(page).toContain('connection-card-fact-label">启动位置');
    expect(page).toContain('connection-card-next-label">下一步');
    expect(page).toContain('softwareVersionLabel(pkg, facts)');
    expect(page).toContain('manifest.softwareVersion');
    expect(page).toContain('connection-card-support');
    expect(page).toContain('维护摘要');
    expect(page).toContain('connection-card-utility-actions');
    expect(page).not.toContain('<summary>连接详情</summary>');
    expect(page).not.toContain('<summary>更多</summary>');
    expect(page).toContain('connectionStateFor(pkg)');
    expect(page).toContain("make('strategy_draft', '策略草稿'");
    expect(page).toContain("make('exploring', '正在探索连接方式'");
    expect(page).toContain("make('discovery_pending', '等待探索'");
    expect(page).toContain('当前还没有已验证连接策略。');
    expect(page).toContain('让 Copilot 基于事实选择候选策略。');
    expect(page).toContain('actionLabel(action)');
    expect(page).toContain('connection-card-availability');
    expect(page).toContain('connection-card-result');
    expect(page).toContain('connection-card-support');
    expect(page).toContain('connection-card-support-chip');
    expect(page).toContain('latestStrategyDraft(pkg)');
    expect(page).toContain('connection_strategy_draft_created');
    expect(page).toContain('latestStrategyFailure(pkg)');
    expect(page).toContain('connection_strategy_failed');
    expect(page).toContain('factsSummary(facts)');
    expect(page).toContain('strategySummary(strategyDraft)');
    expect(page).toContain('策略草稿');
    expect(page).toContain('connection_template_draft_created');
    expect(page).not.toContain('connection-card-template-draft');
    expect(page).not.toContain('模板草稿');
    expect(page).not.toContain('真实信号：');
    expect(page).not.toContain('需要目录：');
    expect(page).not.toContain('安全边界：');
    expect(page).toContain('setCardResult(pkg');
    expect(page).toContain('处理中...');
    expect(page).toContain('安装中...');
    expect(page).toContain('探测真实连接信号中...');
    expect(page).toContain('卸载中...');
    expect(page).toContain('connectionState.blockedReason');
    expect(page).toContain('connectionState.nextAction');
    expect(page).not.toContain('blender_http');
    expect(page).not.toContain('maya_command_port');
    expect(page).not.toContain('unreal_http');
    expect(page).not.toContain('extendscript_heartbeat');
    expect(page).not.toContain('project plugin');
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

  it('renders a product-designed connection card with lightweight maintenance summary', () => {
    const schemaCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/capability-card-schema.js'), 'utf8');
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
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

    dom.window.eval(schemaCode);
    dom.window.eval(pageCode);
    const page = dom.window.ShellConnectionPage;
    page.isAdmin = true;
    page.packages = [{
      id: 'codex-visible-ui-smoke',
      type: 'software_connection',
      name: 'Codex Smoke Unknown App',
      source: 'draft',
      hasCloud: false,
      hasCloudMismatch: true,
      governance: { cloudVersioned: true },
      connectionState: {
        maturity: 'strategy_draft',
        label: '策略草稿',
        publishEligible: true,
        blockedReason: '上一条策略没有收到真实信号。',
        nextAction: 'run_next_connection_strategy',
        availableActions: ['agent_loop', 'conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export'],
        facts: {
          executablePath: 'C:/Smoke/CodexSmokeApp.exe',
          processName: 'CodexSmokeApp.exe',
          candidateScriptDirs: ['C:/Smoke/Scripts'],
        },
      },
      events: [
        {
          kind: 'connection_strategy_draft_created',
          ok: true,
          message: 'Connection strategy draft created from collected facts.',
          detail: {
            facts: {
              executablePath: 'C:/Smoke/CodexSmokeApp.exe',
              processName: 'CodexSmokeApp.exe',
            },
            recommendedNextStrategy: { id: 'existing-process-probe', label: '运行进程探测' },
            candidateStrategies: [
              { id: 'existing-process-probe', label: '运行进程探测' },
              { id: 'manual-bridge-script', label: '手动桥接脚本' },
            ],
          },
        },
        {
          kind: 'connection_strategy_failed',
          ok: false,
          message: '没有收到 heartbeat。',
          detail: {
            strategyId: 'script-folder',
            failureClass: 'probe_failed',
            nextCandidateStrategy: { id: 'manual-bridge-script', label: '手动桥接脚本' },
          },
        },
      ],
      manifest: {
        inputPath: 'C:/Smoke/CodexSmokeApp.exe',
        executablePath: 'C:/Smoke/CodexSmokeApp.exe',
        softwareVersion: '2026.1',
      },
    }];

    page.render();

    const card = dom.window.document.querySelector('[data-connection-id="codex-visible-ui-smoke"]');
    expect(card).toBeTruthy();
    const text = card?.textContent || '';
    expect(text).toContain('Codex Smoke Unknown App');
    expect(text).toContain('策略草稿');
    expect(text).toContain('软件版本');
    expect(text).toContain('2026.1');
    expect(text).toContain('启动位置');
    expect(text).toContain('C:/Smoke/CodexSmokeApp.exe');
    expect(text).toContain('下一步');
    expect(text).toContain('run_next_connection_strategy');
    expect(text).toContain('维护摘要');
    expect(text).toContain('事实');
    expect(text).toContain('exe / 进程 / 脚本目录 1');
    expect(text).toContain('策略');
    expect(text).toContain('运行进程探测 / 2 个候选');
    expect(card?.querySelectorAll('.connection-card-support-chip')).toHaveLength(3);
    expect(card?.querySelector('.connection-card-appmark')).toBeTruthy();
    expect(card?.querySelector('.connection-card-next')).toBeTruthy();
    expect(card?.querySelector('.connection-card-support')).toBeTruthy();
    expect(card?.querySelector('.connection-card-utility-actions')).toBeTruthy();
    expect(card?.querySelector('.connection-card-details')).toBeFalsy();
    expect(card?.querySelector('.connection-card-more')).toBeFalsy();
    expect(Array.from(card?.querySelectorAll('[data-action]') || []).map((node) => node.getAttribute('data-action'))).toEqual(
      expect.arrayContaining(['agent_loop', 'conversation', 'install', 'probe', 'publish', 'delete']),
    );
    expect(Array.from(card?.querySelectorAll('.connection-card-actions > [data-action]') || []).map((node) => node.getAttribute('data-action'))).toEqual(
      expect.arrayContaining(['agent_loop', 'launch', 'probe', 'publish']),
    );
    expect(Array.from(card?.querySelectorAll('.connection-card-utility-actions [data-action]') || []).map((node) => node.getAttribute('data-action'))).toEqual(
      expect.arrayContaining(['conversation', 'install', 'delete']),
    );
    const publishButton = card?.querySelector('[data-action="publish"]');
    expect(publishButton?.getAttribute('aria-label')).toBe('提交云端');
    expect(publishButton?.getAttribute('title')).toBe('提交云端');
    expect(publishButton?.querySelector('svg.connection-card-action-icon')).toBeTruthy();
    expect((publishButton?.textContent || '').trim()).toBe('');
  });

  it('prefers backend connectionCardView for current local version and card actions', () => {
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
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

    dom.window.eval(pageCode);
    const page = dom.window.ShellConnectionPage;
    page.isAdmin = true;
    page.packages = [{
      id: 'backend-card-model',
      type: 'software_connection',
      name: 'Backend Card Model',
      source: 'draft',
      governance: { cloudVersioned: true },
      connectionState: {
        maturity: 'connected',
        label: '已连接',
        publishEligible: true,
        blockedReason: '',
        nextAction: '后端模型下一步',
        availableActions: ['agent_loop', 'launch', 'probe', 'export'],
      },
      connectionCardView: {
        id: 'backend-card-model',
        name: 'Backend Card Model',
        statusLabel: '已连接',
        currentLocalVersion: {
          id: 'model-7',
          label: 'Model App 7',
          softwareVersion: '7.0',
          executablePath: 'D:/Model/App7.exe',
          source: 'manual',
          status: 'verified',
        },
        localVersions: [],
        nextActionLabel: '后端模型下一步',
        maintenanceChips: [
          { label: '信号 OK', tone: 'ok' },
          { label: '事实 exe / 版本', tone: 'neutral' },
          { label: '可提交云端', tone: 'ok' },
          { label: '第四个不显示', tone: 'neutral' },
        ],
        primaryActions: ['agent_loop', 'launch', 'probe', 'publish'],
      },
      manifest: {
        softwareVersion: 'old-version',
        executablePath: 'C:/Old/App.exe',
      },
    }];

    page.render();

    const card = dom.window.document.querySelector('[data-connection-id="backend-card-model"]');
    const text = card?.textContent || '';
    expect(text).toContain('7.0');
    expect(text).toContain('D:/Model/App7.exe');
    expect(text).toContain('后端模型下一步');
    expect(text).toContain('信号 OK');
    expect(text).not.toContain('old-version');
    expect(text).not.toContain('C:/Old/App.exe');
    expect(text).not.toContain('第四个不显示');
    expect(Array.from(card?.querySelectorAll('.connection-card-actions > [data-action]') || []).map((node) => node.getAttribute('data-action'))).toEqual(
      expect.arrayContaining(['agent_loop', 'launch', 'probe', 'publish']),
    );
  });

  it('opens a local software version drawer and targets selected versions', async () => {
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
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
    const calls: Array<{ method: string; path: string; body: any }> = [];

    dom.window.eval(pageCode);
    const page = dom.window.ShellConnectionPage;
    page._shell = {
      api: vi.fn(async (method: string, path: string, body: any) => {
        calls.push({ method, path, body });
        return { ok: true, json: { ok: true, result: { message: 'launched' }, drafts: [] } };
      }),
    };
    page.packages = [{
      id: 'multi-version-app',
      type: 'software_connection',
      name: 'Multi Version App',
      source: 'draft',
      connectionState: {
        maturity: 'strategy_draft',
        label: '策略草稿',
        publishEligible: false,
        blockedReason: '',
        nextAction: '选择一个本机版本继续',
        availableActions: ['agent_loop', 'launch', 'probe'],
      },
      connectionCardView: {
        id: 'multi-version-app',
        name: 'Multi Version App',
        statusLabel: '策略草稿',
        currentLocalVersion: {
          id: 'app-2024',
          label: 'App 2024',
          softwareVersion: '2024',
          executablePath: 'C:/App/2024/App.exe',
          source: 'manual',
          status: 'launchable',
        },
        localVersions: [
          {
            id: 'app-2024',
            label: 'App 2024',
            softwareVersion: '2024',
            executablePath: 'C:/App/2024/App.exe',
            source: 'manual',
            status: 'launchable',
          },
          {
            id: 'app-2026',
            label: 'App 2026',
            softwareVersion: '2026',
            executablePath: 'C:/App/2026/App.exe',
            source: 'process',
            status: 'detected',
          },
        ],
        nextActionLabel: '选择一个本机版本继续',
        maintenanceChips: [{ label: '未验证', tone: 'neutral' }],
        primaryActions: ['agent_loop', 'launch', 'probe'],
      },
      manifest: {},
    }];

    page.render();
    let card = dom.window.document.querySelector('[data-connection-id="multi-version-app"]');
    expect(card?.textContent || '').toContain('2024');
    card?.querySelector('[data-action="local_versions"]')?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    card = dom.window.document.querySelector('[data-connection-id="multi-version-app"]');
    expect(card?.querySelector('.connection-card-version-drawer')).toBeTruthy();
    expect(Array.from(card?.querySelectorAll('.connection-card-version-row') || []).map((node) => node.textContent || '').join('\n')).toContain('App 2026');

    card?.querySelector('[data-action="set_local_version"][data-local-version-id="app-2026"]')?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await Promise.resolve();
    card = dom.window.document.querySelector('[data-connection-id="multi-version-app"]');
    expect(card?.textContent || '').toContain('2026');
    expect(card?.textContent || '').toContain('C:/App/2026/App.exe');

    card?.querySelector('.connection-card-version-drawer [data-action="launch"][data-local-version-id="app-2026"]')?.dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    await Promise.resolve();
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/v1/capability-packages/drafts/multi-version-app/local-version',
          body: { localVersionId: 'app-2026', makeDefault: true },
        }),
      ]),
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/v1/capability-packages/multi-version-app/lifecycle',
          body: { action: 'launch', localVersionId: 'app-2026' },
        }),
      ]),
    );
  });

  it('runs page-level software discovery for discoverable connection cards', async () => {
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <button id="btnConnectionCreateWithCopilot"></button>
          <button id="btnConnectionImportTransfer"></button>
          <button id="btnConnectionsDiscoverRunning"></button>
          <div id="connectionsSummary"></div>
          <div id="connectionsInlineStatus"></div>
          <div id="connectionsEmpty" class="connections-empty"></div>
          <div id="connectionsList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });
    const calls: Array<{ method: string; path: string; body: any }> = [];

    dom.window.eval(pageCode);
    const page = dom.window.ShellConnectionPage;
    page.packages = [
      {
        id: 'maya',
        type: 'software_connection',
        name: 'Maya',
        source: 'draft',
        connectionState: {
          maturity: 'strategy_draft',
          label: '策略草稿',
          publishEligible: false,
          blockedReason: '',
          nextAction: '识别运行中进程',
          availableActions: ['agent_loop', 'discover_running'],
        },
        manifest: { hostId: 'maya' },
      },
      {
        id: 'unknown',
        type: 'software_connection',
        name: 'Unknown',
        source: 'draft',
        connectionState: {
          maturity: 'exploring',
          label: '正在探索连接方式',
          publishEligible: false,
          blockedReason: '',
          nextAction: '继续收集事实',
          availableActions: ['agent_loop'],
        },
        manifest: {},
      },
    ];
    page._shell = {
      api: vi.fn(async (method: string, path: string, body: any) => {
        calls.push({ method, path, body });
        if (path === '/v1/capability-packages/drafts') return { ok: true, json: { drafts: page.packages } };
        if (path === '/v1/capability-packages/cloud') return { ok: true, json: { packages: [], versions: [] } };
        return { ok: true, json: { ok: true, result: { message: '已识别 Maya 2024' } } };
      }),
    };
    page.bind(page._shell);
    expect(dom.window.document.getElementById('btnConnectionsDiscoverRunning')).toBeTruthy();
    await page.discoverRunningConnections();

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/v1/capability-packages/maya/lifecycle',
          body: { action: 'discover_running' },
        }),
      ]),
    );
    expect(calls.some((call) => call.path === '/v1/capability-packages/unknown/lifecycle')).toBe(false);
    expect(dom.window.document.getElementById('connectionsInlineStatus')?.textContent || '').toContain('识别完成');
  });

  it('submits verified software connections through the capability cloud version API', async () => {
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
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
    const calls: Array<{ method: string; path: string; body: unknown }> = [];

    dom.window.eval(pageCode);
    dom.window.prompt = vi
      .fn()
      .mockReturnValueOnce('Verified Maya command port strategy.')
      .mockReturnValueOnce('1.0.1');
    dom.window.alert = vi.fn();
    const page = dom.window.ShellConnectionPage;
    page.isAdmin = true;
    page._shell = {
      api: vi.fn(async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body });
        if (path === '/v1/capability-packages/drafts') return { ok: true, json: { drafts: [] } };
        if (path === '/v1/capability-packages/cloud') return { ok: true, json: { packages: [], versions: [] } };
        return { ok: true, json: { ok: true, version: { id: 'v1', semver: '1.0.1' } } };
      }),
    };

    await page.publishToCloud({
      id: 'codex-real-maya-probe',
      type: 'software_connection',
      name: 'Maya',
      source: 'draft',
      version: '1.0.0',
      governance: { cloudVersioned: true },
      connectionState: { publishEligible: true },
      manifest: { verifiedStrategyId: 'maya-command-port' },
    });

    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/v1/capability-packages/codex-real-maya-probe/cloud-versions',
      body: {
        semver: '1.0.1',
        versionNote: 'Verified Maya command port strategy.',
        isAdmin: true,
        actorRole: 'admin',
      },
    });
    expect(dom.window.alert).toHaveBeenCalledWith('已提交云端：v1.0.1');
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

  it('creates a capability package draft from a dropped executable path', async () => {
    const pageCode = readFileSync(join(process.cwd(), 'companion-desktop/shell/connection-page.js'), 'utf8');
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
    const calls: Array<{ method: string; path: string; body: any }> = [];

    dom.window.eval(pageCode);
    dom.window.alert = vi.fn();
    const page = dom.window.ShellConnectionPage;
    page.openCapabilityConversation = vi.fn();
    page._shell = {
      resolveDroppedConnectionPath: vi.fn(async () => ({
        ok: true,
        name: 'Unknown Paint',
        inputPath: 'C:/Tools/UnknownPaint.exe',
        targetPath: 'C:/Tools/UnknownPaint.exe',
        exeName: 'UnknownPaint.exe',
        targetKind: 'executable',
        versionHint: '4.2',
      })),
      api: vi.fn(async (method: string, path: string, body: any) => {
        calls.push({ method, path, body });
        if (path === '/v1/capability-packages/drafts') {
          return { ok: true, json: { ok: true, draft: { id: body.id, name: body.name, type: body.type, manifest: body.manifest } } };
        }
        if (path === '/v1/capability-packages/cloud') return { ok: true, json: { packages: [], versions: [] } };
        return { ok: true, json: { drafts: [] } };
      }),
    };

    await page.createConnectionFromDroppedPath('C:/Tools/UnknownPaint.exe');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/capability-packages/drafts',
      body: {
        id: 'unknown-paint',
        type: 'software_connection',
        name: 'Unknown Paint',
        appName: 'Unknown Paint',
        templateHint: 'shortcut_unknown_host',
        createdBy: 'drag-drop',
        manifest: {
          droppedFrom: 'connection_page',
          inputPath: 'C:/Tools/UnknownPaint.exe',
          executablePath: 'C:/Tools/UnknownPaint.exe',
          exeName: 'UnknownPaint.exe',
          targetKind: 'executable',
          softwareVersion: '4.2',
          versionHint: '4.2',
          currentLocalVersionId: expect.any(String),
          defaultLocalVersionId: expect.any(String),
          localVersions: [
            expect.objectContaining({
              label: 'Unknown Paint 4.2',
              softwareVersion: '4.2',
              executablePath: 'C:/Tools/UnknownPaint.exe',
              source: 'drag_drop',
              status: 'launchable',
            }),
          ],
        },
      },
    });
    expect(calls[0].body.version).toBeUndefined();
    expect(calls[0].body.manifest.currentLocalVersionId).toBe(calls[0].body.manifest.localVersions[0].id);
    expect(calls[0].body.manifest.defaultLocalVersionId).toBe(calls[0].body.manifest.localVersions[0].id);
    expect(page.openCapabilityConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unknown-paint', type: 'software_connection' }),
    );
    expect(dom.window.alert).toHaveBeenCalledWith('已创建连接草稿：Unknown Paint');
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
    expect(page).toContain("agent_loop: 'Copilot'");
    expect(page).toContain("conversation: '对话'");
    expect(page).toContain("discover_running: '识别运行'");
    expect(page).toContain("launch: '启动'");
    expect(page).toContain("install: '安装桥接'");
    expect(page).toContain("probe: '探测'");
    expect(page).toContain("close: '关闭'");
    expect(page).toContain("uninstall: '卸载'");
    expect(page).toContain("export: '导出'");
    expect(page).toContain("delete: '删除草稿'");
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
