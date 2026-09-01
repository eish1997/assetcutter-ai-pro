import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function loadPage(htmlExtra = '') {
  const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
  const dom = new JSDOM(
    `
      <html>
        <head></head>
        <body>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty">
            <div class="workflow-empty-title">还没有技能</div>
            <div class="workflow-empty-sub">把刚才那套整理成技能</div>
            <button type="button" id="btnReplayCompileWithButlerEmpty">整理成技能</button>
          </div>
          <button type="button" id="btnReplayCompileWithButler">整理成技能</button>
          <input type="search" id="skillSearchInput" />
          <div id="skillFilterRow">
            <button type="button" class="tools-filter-chip active" data-skill-filter-source="all">全部</button>
            <button type="button" class="tools-filter-chip" data-skill-filter-source="mine">我的</button>
            <button type="button" class="tools-filter-chip" data-skill-filter-source="local">本地</button>
            <button type="button" class="tools-filter-chip" data-skill-filter-source="cloud">云端</button>
          </div>
          <div id="workflowList"></div>
          ${htmlExtra}
        </body>
      </html>
    `,
    { runScripts: 'outside-only' },
  );
  dom.window.eval(code);
  return { dom, page: dom.window.ShellWorkflowPage };
}

const sampleWorkflow = {
  id: 'workflow.maya.export_selection_fbx',
  name: 'Maya FBX',
  status: 'available',
  userSummary: {
    title: '导出 Maya 选中对象',
    inputSummary: '输入输出目录、文件名和是否允许覆盖。',
    outputSummary: '得到 FBX 文件。',
  },
  aiContract: {
    inputSchema: {
      properties: {
        output_dir: { type: 'string' },
        file_name: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
    },
  },
  systemContract: { validation: { status: 'validated' } },
};

describe('workflow page UI', () => {
  it('wires the replay room while keeping the workflow shell view', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const rooms = readFileSync(join(process.cwd(), 'companion-desktop/shell-rooms.cjs'), 'utf8');

    expect(html).toContain('data-view="workflow"');
    expect(html).toContain('id="view-workflow"');
    expect(html).toContain('aria-label="技能"');
    expect(html).toContain('title="技能"');
    expect(html).toContain('<h1>技能</h1>');
    expect(html).toContain('把刚才那套整理成技能');
    expect(html).toContain('id="btnReplayCompileWithButler"');
    expect(html).toContain('id="btnReplayCompileWithButlerEmpty"');
    expect(html).toContain('id="workflowInlineStatus"');
    expect(html).toContain('id="workflowList"');
    expect(html).toContain('id="skillSearchInput"');
    expect(html).toContain('id="skillFilterRow"');
    expect(html).toContain('data-skill-filter-source="all"');
    expect(html).toContain('data-skill-filter-source="mine"');
    expect(html).toContain('data-skill-filter-source="local"');
    expect(html).toContain('data-skill-filter-source="cloud"');
    expect(html).toContain('<script src="workflow-page.js"></script>');
    expect(html).toContain("workflow: $('view-workflow')");
    expect(html).toContain('window.ShellWorkflowPage.onViewShown(shell)');
    expect(html).toContain('window.ShellWorkflowPage.bind(shell)');
    expect(html).not.toContain('id="workflowSearch"');
    expect(html).not.toContain('id="workflowHistory"');
    expect(html).not.toContain('id="workflowHistoryEmpty"');
    expect(html).not.toContain('id="workflowHistoryList"');
    expect(html).not.toContain('data-view="scripts"');
    expect(main).toContain("require('./shell-rooms.cjs')");
    expect(rooms).toContain("shellView: 'workflow'");
    expect(rooms).toContain("if (v === 'scripts') return 'workflow'");
  });

  it('loads skills and last runs without posting run/preflight from the page', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');

    expect(page).toContain('window.ShellWorkflowPage');
    expect(page).toContain("shell.api('GET', '/v1/workflows/skills'");
    expect(page).toContain("shell.api('GET', '/v1/workflows/runs'");
    expect(page).toContain("kind: 'replay_run'");
    expect(page).toContain("kind: 'replay_compile'");
    expect(page).toContain("replayKind === 'manual'");
    expect(page).toContain("replayKind === 'skill'");
    expect(page).toContain('compileReplayWithButler');
    expect(page).toContain('openDshHandoff');
    expect(page).toContain("'/v1/workflows/skills/' + encodeURIComponent(id)");
    expect(page).toContain("'/v1/workflows/skills/' + encodeURIComponent(id) + '/cloud'");
    expect(page).toContain("'/v1/workflows/skills/' + encodeURIComponent(id) + '/install-cloud'");
    expect(page).toContain('data-action="remove"');
    expect(page).toContain('data-action="publish"');
    expect(page).toContain('data-action="install"');
    expect(page).not.toContain("'/v1/workflows/' + encodeURIComponent(workflow.id) + '/run'");
    expect(page).not.toContain("'/v1/workflows/' + encodeURIComponent(workflow.id) + '/preflight'");
    expect(page).not.toContain('workflow-run-form');
    expect(page).not.toContain('workflow-preflight');
    expect(page).not.toContain('workflow-connectors');
    expect(page).not.toContain('workflow-detail');
    expect(page).not.toContain('workflow-history');
    expect(page).not.toContain('ScriptHub Workflow Runtime');
  });

  it('renders a description-and-execute card from userSummary', () => {
    const { page } = loadPage();
    const html = page.renderReplayCardHtml(sampleWorkflow, { status: 'succeeded' });
    expect(html).toContain('导出 Maya 选中对象');
    expect(html).toContain('输入输出目录、文件名和是否允许覆盖。');
    expect(html).toContain('得到 FBX 文件。');
    expect(html).toContain('执行');
    expect(html).toContain('成功');
    expect(html).not.toContain('data-action="remove"');
    expect(html).not.toContain('data-action="publish"');
    expect(html).not.toContain('data-action="install"');
    expect(html).not.toContain('workflow-run-form');
    expect(html).not.toContain('workflow-preflight');
    expect(html).not.toContain('workflow-connectors');
    expect(html).not.toContain('workflow-detail');
    expect(html).not.toContain('workflow-history');
  });

  it('lists replay cards and empty-state copy without history or forms', () => {
    const { dom, page } = loadPage();
    page.workflows = [sampleWorkflow];
    page.historyRuns = [{ id: 'run_success', workflow_id: sampleWorkflow.id, status: 'failed' }];
    page.indexRuns();
    page.render();

    const text = dom.window.document.getElementById('workflowList')?.textContent || '';
    expect(text).toContain('导出 Maya 选中对象');
    expect(text).toContain('得到 FBX 文件');
    expect(text).toContain('执行');
    expect(text).toContain('失败');
    expect(text).not.toContain('运行前检查');
    expect(text).not.toContain('固定到首页');
    expect(dom.window.document.getElementById('workflowEmpty')?.className).toContain('hidden');
    expect(dom.window.document.querySelector('.workflow-run-form')).toBeNull();
    expect(dom.window.document.querySelector('.workflow-preflight')).toBeNull();
    expect(dom.window.document.getElementById('workflowHistory')).toBeNull();
  });

  it('shows the butler empty-state when there are no replay items', () => {
    const { dom, page } = loadPage();
    page.workflows = [];
    page.render();
    const empty = dom.window.document.getElementById('workflowEmpty');
    expect(empty?.className).not.toContain('hidden');
    expect(empty?.textContent).toContain('把刚才那套整理成技能');
    expect(empty?.querySelector('#btnReplayCompileWithButlerEmpty')).toBeTruthy();
  });

  it('empty-state and toolbar compile doors hand the same replay_compile payload', async () => {
    const { page, dom } = loadPage();
    const openDshHandoff = vi.fn().mockResolvedValue({ ok: true });
    page.bind({ openDshHandoff });
    const payload = page.buildReplayCompileHandoff();
    expect(payload.kind).toBe('replay_compile');
    expect(payload.domain).toBe('replay');
    expect(payload.composerText).toBe('把刚才那套整理成技能');

    await page.compileReplayWithButler();
    expect(openDshHandoff).toHaveBeenCalledTimes(1);
    expect(openDshHandoff.mock.calls[0][0].kind).toBe('replay_compile');
    expect(dom.window.document.getElementById('workflowInlineStatus')?.textContent).toContain(
      '已填入管家输入框，确认后点发送即可。',
    );
  });

  it('execute hands the frozen replay to the butler', async () => {
    const { page } = loadPage();
    const openDshHandoff = vi.fn().mockResolvedValue({ ok: true });
    page._shell = { openDshHandoff };
    const payload = page.buildReplayHandoff(sampleWorkflow);
    expect(payload.kind).toBe('replay_run');
    expect(payload.replayId).toBe('workflow.maya.export_selection_fbx');
    expect(payload.slots).toEqual(['output_dir', 'file_name', 'overwrite']);
    expect(payload.suggestedMessage).toContain('replay_run');

    await page.executeReplay(sampleWorkflow);
    expect(openDshHandoff).toHaveBeenCalledTimes(1);
    expect(openDshHandoff.mock.calls[0][0].kind).toBe('replay_run');
    expect(openDshHandoff.mock.calls[0][0].replayId).toBe(sampleWorkflow.id);
    expect(page.inlineStatus).toContain('已填入管家输入框，确认后点发送即可。');
  });

  it('keeps workflow capability cards runnable', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/capability-card-schema.js'), 'utf8');
    const sandbox: { window: Record<string, any> } = { window: {} };
    vm.runInNewContext(code, sandbox);
    const schema = sandbox.window.ShellCapabilityCardSchema;

    expect(schema.actions({ id: 'workflow.maya.export_selection_fbx', type: 'workflow', source: 'draft' }, { isAdmin: false })).toEqual([
      'conversation',
      'validate',
      'run',
      'export',
      'delete',
    ]);
  });

  it('filters shelf, local, and cloud cards and searches name/id/prompt', () => {
    const { page } = loadPage();
    const shelf = {
      id: 'example-unreal-connection',
      name: '示例：Unreal 连接',
      origin: 'example',
      hasLocal: true,
      hasCloud: false,
      skillPrompt: 'connection_probe Unreal',
      userSummary: { title: '示例：Unreal 连接', inputSummary: '查地点并探活' },
    };
    const executor = {
      ...sampleWorkflow,
      origin: 'executor',
      hasLocal: true,
      hasCloud: false,
    };
    const cloudOnly = {
      id: 'cloud-skill',
      name: '云端技能',
      origin: 'cloud',
      hasLocal: false,
      hasCloud: true,
      skillPrompt: 'install me',
      userSummary: { title: '云端技能', inputSummary: '从云端安装' },
    };
    expect(page.skillMatchesFilters(shelf, { filterSource: 'mine' })).toBe(true);
    expect(page.skillMatchesFilters(executor, { filterSource: 'mine' })).toBe(false);
    expect(page.skillMatchesFilters(executor, { filterSource: 'local' })).toBe(true);
    expect(page.skillMatchesFilters(cloudOnly, { filterSource: 'local' })).toBe(false);
    expect(page.skillMatchesFilters(cloudOnly, { filterSource: 'cloud' })).toBe(true);
    expect(page.skillMatchesFilters(shelf, { filterSource: 'all', searchQuery: 'unreal' })).toBe(true);
    expect(page.skillMatchesFilters(shelf, { filterSource: 'all', searchQuery: 'maya' })).toBe(false);
    expect(page.skillMatchesFilters(shelf, { filterSource: 'all', searchQuery: 'connection_probe' })).toBe(true);

    page.workflows = [shelf, executor, cloudOnly];
    page.filterSource = 'mine';
    expect(page.getFilteredWorkflows().map((row) => row.id)).toEqual(['example-unreal-connection']);
    page.filterSource = 'cloud';
    expect(page.getFilteredWorkflows().map((row) => row.id)).toEqual(['cloud-skill']);
    page.filterSource = 'all';
    page.searchQuery = 'FBX';
    expect(page.getFilteredWorkflows().map((row) => row.id)).toEqual([sampleWorkflow.id]);
  });

  it('renders remove/publish on shelf cards and install on cloud-only cards', () => {
    const { page } = loadPage();
    const shelfHtml = page.renderReplayCardHtml({
      id: 'example-unreal-connection',
      name: '示例：Unreal 连接',
      removable: true,
      publishable: true,
      installable: false,
      userSummary: { title: '示例：Unreal 连接', inputSummary: '查地点并探活' },
    });
    expect(shelfHtml).toContain('data-action="remove"');
    expect(shelfHtml).toContain('data-action="publish"');
    expect(shelfHtml).not.toContain('data-action="install"');
    const cloudHtml = page.renderReplayCardHtml({
      id: 'cloud-skill',
      name: '云端技能',
      removable: false,
      publishable: false,
      installable: true,
      userSummary: { title: '云端技能', inputSummary: '从云端安装' },
    });
    expect(cloudHtml).toContain('data-action="install"');
    expect(cloudHtml).not.toContain('data-action="remove"');
    expect(cloudHtml).not.toContain('data-action="publish"');
  });

  it('shows no-match copy when filters hide every skill', () => {
    const { dom, page } = loadPage();
    page.workflows = [{ ...sampleWorkflow, origin: 'executor', hasLocal: true, hasCloud: false }];
    page.filterSource = 'cloud';
    page.render();
    expect(dom.window.document.getElementById('workflowEmpty')?.className).toContain('hidden');
    expect(dom.window.document.getElementById('workflowList')?.textContent).toContain('无匹配技能');
  });

  it('binds search and source chips to re-render', () => {
    const { dom, page } = loadPage();
    page.workflows = [
      { id: 'example-unreal-connection', name: '示例：Unreal 连接', origin: 'example', hasLocal: true, hasCloud: false, userSummary: { title: '示例：Unreal 连接' } },
      { ...sampleWorkflow, origin: 'executor', hasLocal: true, hasCloud: false },
    ];
    page.bind({});
    const search = dom.window.document.getElementById('skillSearchInput');
    search.value = 'Unreal';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(page.searchQuery).toBe('Unreal');
    expect(dom.window.document.getElementById('workflowList')?.textContent).toContain('示例：Unreal 连接');
    expect(dom.window.document.getElementById('workflowList')?.textContent).not.toContain('导出 Maya 选中对象');
    dom.window.document.querySelector('[data-skill-filter-source="mine"]').click();
    expect(page.filterSource).toBe('mine');
    expect(dom.window.document.querySelector('[data-skill-filter-source="mine"]')?.className).toContain('active');
  });
});
