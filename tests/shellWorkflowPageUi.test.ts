import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('workflow page UI', () => {
  it('wires a first-class local Workflow shell page', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');

    expect(html).toContain('data-view="workflow"');
    expect(html).toContain('id="view-workflow"');
    expect(html).toContain('id="workflowSearch"');
    expect(html).toContain('id="workflowSummary"');
    expect(html).toContain('id="workflowInlineStatus"');
    expect(html).toContain('id="workflowList"');
    expect(html).toContain('id="workflowHistory"');
    expect(html).toContain('id="workflowHistoryEmpty"');
    expect(html).toContain('id="workflowHistoryList"');
    expect(html).toContain('<script src="workflow-page.js"></script>');
    expect(html).toContain("workflow: $('view-workflow')");
    expect(html).toContain('window.ShellWorkflowPage.onViewShown(shell)');
    expect(html).toContain('window.ShellWorkflowPage.bind(shell)');
    expect(main).toContain("view === 'workflow'");
    expect(main).toContain("'workbench' | 'workflow' | 'tools' | 'connections' | 'settings'");
    expect(main).toContain("if (view === 'scripts') return 'workflow';");
    expect(html).not.toContain('data-view="scripts"');
  });

  it('loads WorkflowSkill records and runs through local companion workflow APIs', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');

    expect(page).toContain('window.ShellWorkflowPage');
    expect(page).toContain("shell.api('GET', '/v1/workflows/skills'");
    expect(page).toContain("shell.api('GET', '/v1/workflows/runs'");
    expect(page).toContain("shell.api('GET', '/v1/workflows/drafts'");
    expect(page).toContain("shell.api('GET', '/v1/workflows/pins'");
    expect(page).toContain("'/v1/workflows/pins'");
    expect(page).toContain("versionPolicy: { kind: 'follow_default' }");
    expect(page).toContain("shell.api('DELETE', '/v1/workflows/pins/' + encodeURIComponent(existing.id)");
    expect(page).toContain("'/v1/workflows/' + encodeURIComponent(workflow.id) + '/preflight'");
    expect(page).toContain("'/v1/workflows/' + encodeURIComponent(workflow.id) + '/run'");
    expect(page).toContain("'/v1/workflows/runs/' + encodeURIComponent(run.id) + '/save-draft'");
    expect(page).toContain("'/v1/workflows/runs/' + encodeURIComponent(run.id) + '/repair-session'");
    expect(page).toContain('reusedFromRunId');
    expect(page).toContain('saved_as_draft_id');
    expect(page).toContain('repair_actions');
    expect(page).toContain('replay_snapshot_id');
    expect(page).toContain('artifacts');
    expect(page).toContain('__acOpenCopilotObjectSession');
    expect(page).not.toContain('ScriptHub Workflow Runtime');
    expect(page).not.toContain('workflow_run_blocked');
  });

  it('renders empty, succeeded, and failed Workflow run history states', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      systemContract: { validation: { status: 'validated' } },
    }];
    page.historyRuns = [];
    page.render();

    expect(dom.window.document.getElementById('workflowHistoryEmpty')?.className).not.toContain('hidden');
    expect(dom.window.document.getElementById('workflowHistoryList')?.textContent).toBe('');

    page.historyRuns = [
      {
        id: 'run_success',
        workflow_id: 'workflow.maya.export_selection_fbx',
        workflow_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
        status: 'succeeded',
        finished_at: '2026-08-10T14:00:02.000Z',
        artifacts: [{ uri: 'project://exports/hero.fbx', metadata: { bytes: 512 } }],
      },
      {
        id: 'run_failed',
        workflow_id: 'workflow.maya.export_selection_fbx',
        workflow_version: '0.1.0',
        status: 'preflight_failed',
        created_at: '2026-08-10T14:01:00.000Z',
        artifacts: [],
        preflight_results: [{ status: 'failed', message: '请先在 Maya 中选择对象' }],
        repair_actions: [{ title: '选择 Maya 对象' }],
      },
    ];
    page.render();

    const historyText = dom.window.document.getElementById('workflowHistoryList')?.textContent || '';
    expect(dom.window.document.getElementById('workflowHistoryEmpty')?.className).toContain('hidden');
    expect(historyText).toContain('导出 Maya 选中对象');
    expect(historyText).toContain('成功');
    expect(historyText).toContain('project://exports/hero.fbx');
    expect(historyText).toContain('512 bytes');
    expect(historyText).toContain('workflow.maya.export_selection_fbx@0.1.0');
    expect(historyText).toContain('检查未通过');
    expect(historyText).toContain('请先在 Maya 中选择对象');
    expect(historyText).toContain('0.1.0');
  });

  it('renders passed, warning, and failed preflight results on workflow cards', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      systemContract: { validation: { status: 'validated' } },
    }];
    page.preflightByWorkflowId.set('workflow.maya.export_selection_fbx', {
      status: 'failed',
      repair_actions: [{ id: 'select_maya_objects', title: '选择 Maya 对象' }],
      results: [
        { check_id: 'maya_connector_online', message: 'Maya Connector 已连接。', status: 'passed' },
        { check_id: 'output_conflict_resolved', message: '目标文件已存在。', status: 'warning' },
        {
          check_id: 'maya_selection_non_empty',
          message: '当前没有选择 Maya 对象。',
          repair_action_id: 'select_maya_objects',
          status: 'failed',
        },
      ],
    });
    page.render();

    const text = dom.window.document.getElementById('workflowList')?.textContent || '';
    expect(text).toContain('运行前检查');
    expect(text).toContain('通过');
    expect(text).toContain('提醒');
    expect(text).toContain('未通过');
    expect(text).toContain('Maya Connector 已连接');
    expect(text).toContain('目标文件已存在');
    expect(text).toContain('当前没有选择 Maya 对象');
    expect(text).toContain('选择 Maya 对象');
  });

  it('renders connector dependency summaries on workflow cards', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      connectorSummaries: [{
        id: 'maya_connector',
        title: 'Maya Connector',
        label: '连接未配置',
        status: 'unknown',
      }],
      systemContract: { validation: { status: 'validated' } },
    }];
    page.render();

    const text = dom.window.document.getElementById('workflowList')?.textContent || '';
    expect(text).toContain('Maya Connector');
    expect(text).toContain('连接未配置');
    expect(text).toContain('未知');
  });

  it('opens workflow detail with draft, validated, connector, and recent run states', () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      version: '0.1.0',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      aiContract: {
        inputSchema: {
          properties: {
            file_name: { type: 'string' },
            output_dir: { type: 'string' },
          },
        },
      },
      connectorSummaries: [{
        id: 'maya_connector',
        title: 'Maya Connector',
        label: '已连接',
        status: 'ok',
      }],
      systemContract: { validation: { status: 'validated' } },
    }];
    page.drafts = [
      {
        id: 'draft_ready',
        name: '准备验收草稿',
        status: 'draft',
        definition: { executor_ref: { id: 'workflow.maya.export_selection_fbx' } },
        source: { kind: 'run', run_id: 'run_success' },
      },
      {
        id: 'draft_blocked',
        name: '受阻草稿',
        status: 'blocked',
        definition: { executor_ref: { id: 'workflow.maya.export_selection_fbx' } },
        source: { kind: 'conversation' },
      },
    ];
    page.historyRuns = [{
      id: 'run_success',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'succeeded',
      finished_at: '2026-08-11T10:00:00.000Z',
      artifacts: [],
    }];
    page.render();

    expect(dom.window.document.getElementById('workflowList')?.textContent || '').not.toContain('草稿与状态');
    dom.window.document.querySelector('[data-action="detail"]')?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const text = dom.window.document.getElementById('workflowList')?.textContent || '';
    expect(text).toContain('草稿与状态');
    expect(text).toContain('稳定: validated');
    expect(text).toContain('准备验收草稿: draft');
    expect(text).toContain('受阻草稿: blocked');
    expect(text).toContain('Maya Connector · 已连接');
    expect(text).toContain('成功 / run_success');
    expect(text).toContain('file_name, output_dir');
  });

  it('renders and toggles home and connection Workflow pins', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: {
            pin: {
              id: 'pin_home_export',
              workflow_id: 'workflow.maya.export_selection_fbx',
              scope: { kind: 'home' },
              version_policy: { kind: 'follow_default' },
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: {
            pin: {
              id: 'pin_connection_maya_export',
              workflow_id: 'workflow.maya.export_selection_fbx',
              scope: { kind: 'connection', connection_id: 'maya' },
              version_policy: { kind: 'follow_default' },
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: {
            pins: [{
              id: 'pin_connection_maya_export',
              workflow_id: 'workflow.maya.export_selection_fbx',
              scope: { kind: 'connection', connection_id: 'maya' },
              version_policy: { kind: 'follow_default' },
            }],
          },
        }),
    };
    page._shell = shell;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      connectorSummaries: [{ capabilityPackageId: 'maya', title: 'Maya Connector', label: '已连接', status: 'ok' }],
      systemContract: { validation: { status: 'validated' } },
    }];
    page.historyRuns = [];
    page.pins = [];
    page.render();

    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('固定到首页');
    await page.togglePin(page.workflows[0], { kind: 'home' });
    expect(shell.api).toHaveBeenNthCalledWith(
      1,
      'POST',
      '/v1/workflows/pins',
      {
        scope: { kind: 'home' },
        versionPolicy: { kind: 'follow_default' },
        workflowId: 'workflow.maya.export_selection_fbx',
      },
      { timeoutMs: 30000 },
    );
    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('固定: 首页');

    await page.togglePin(page.workflows[0], { kind: 'connection', connection_id: 'maya' });
    expect(shell.api).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/v1/workflows/pins',
      {
        scope: { kind: 'connection', connection_id: 'maya' },
        versionPolicy: { kind: 'follow_default' },
        workflowId: 'workflow.maya.export_selection_fbx',
      },
      { timeoutMs: 30000 },
    );
    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('固定: 连接:maya');

    await page.togglePin(page.workflows[0], { kind: 'home' });
    expect(shell.api).toHaveBeenNthCalledWith(
      3,
      'DELETE',
      '/v1/workflows/pins/pin_home_export',
      null,
      { timeoutMs: 30000 },
    );
    expect(page.workflows).toHaveLength(1);
    expect(page.pins.map((pin) => pin.id)).toEqual(['pin_connection_maya_export']);
  });

  it('shows pinned workflow status and runs pinned entries through preflight first', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: {
            preflight: {
              status: 'passed',
              repair_actions: [],
              results: [{ check_id: 'maya_connector_online', message: 'Maya Connector 已连接。', status: 'passed' }],
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: {
            result: {
              id: 'run_pinned',
              workflow_id: 'workflow.maya.export_selection_fbx',
              workflow_version_id: 'workflow.maya.export_selection_fbx@0.1.0',
              status: 'succeeded',
              output: { fbx_path: 'project://exports/pinned.fbx' },
              artifacts: [],
            },
          },
        }),
    };
    page._shell = shell;
    const workflow = {
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      connectorSummaries: [{ capabilityPackageId: 'maya', title: 'Maya Connector', label: '已连接', status: 'ok' }],
      systemContract: { validation: { status: 'validated' } },
    };
    page.workflows = [workflow];
    page.pins = [{
      id: 'pin_home_export',
      workflow_id: 'workflow.maya.export_selection_fbx',
      scope: { kind: 'home' },
      version_policy: { kind: 'follow_default' },
    }];
    page.historyRuns = [{
      id: 'run_previous',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'succeeded',
      artifacts: [],
    }];
    page.render();

    const text = dom.window.document.getElementById('workflowList')?.textContent || '';
    expect(text).toContain('固定: 首页 · follow default · 最近 成功 · 连接 已连接');
    expect(text).toContain('运行固定项');
    const card = dom.window.document.querySelector('[data-workflow-id="workflow.maya.export_selection_fbx"]');
    await page.runWorkflow(workflow, card);

    expect(shell.api).toHaveBeenNthCalledWith(
      1,
      'POST',
      '/v1/workflows/workflow.maya.export_selection_fbx/preflight',
      { params: { file_name: 'selected_asset', output_dir: 'project://exports', overwrite: false } },
      { timeoutMs: 60000 },
    );
    expect(shell.api).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/v1/workflows/workflow.maya.export_selection_fbx/run',
      { params: { file_name: 'selected_asset', output_dir: 'project://exports', overwrite: false } },
      { timeoutMs: 120000 },
    );
  });

  it('maps supported RepairAction records to buttons and leaves unknown actions as text', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <a data-view="connections"></a>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn().mockResolvedValue({
        ok: true,
        json: {
          preflight: {
            status: 'passed',
            repair_actions: [],
            results: [{ check_id: 'maya_connector_online', message: 'Maya Connector 已连接。', status: 'passed' }],
          },
        },
      }),
      setShellView: vi.fn().mockResolvedValue({ ok: true }),
    };
    page._shell = shell;
    const workflow = {
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      connectorSummaries: [{ capabilityPackageId: 'maya', title: 'Maya Connector', label: '连接未配置', status: 'unknown' }],
      systemContract: { validation: { status: 'validated' } },
    };
    dom.window.ShellConnectionPage = { focusConnection: vi.fn() };
    page.workflows = [workflow];
    page.preflightByWorkflowId.set('workflow.maya.export_selection_fbx', {
      status: 'failed',
      repair_actions: [
        { id: 'confirm_overwrite_or_rename', title: '允许覆盖或改名', actionType: 'confirm', suggestedInputPatch: { overwrite: true } },
        { id: 'reconnect_maya_connector', title: '重新连接 Maya Connector', actionType: 'reconnect' },
        { id: 'unknown_repair', title: '未知修复', actionType: 'open_folder' },
      ],
      results: [{
        check_id: 'output_conflict_resolved',
        message: '目标 FBX 已存在。',
        repair_action_id: 'confirm_overwrite_or_rename',
        status: 'failed',
      }],
    });
    page.render();

    const list = dom.window.document.getElementById('workflowList');
    const text = list?.textContent || '';
    expect(text).toContain('允许覆盖或改名');
    expect(text).toContain('打开连接');
    expect(text).toContain('未知修复');
    expect(list?.querySelectorAll('.workflow-repair-action')).toHaveLength(2);

    const card = list?.querySelector('[data-workflow-id="workflow.maya.export_selection_fbx"]');
    await page.handleRepairAction(workflow, card, page.preflightByWorkflowId.get('workflow.maya.export_selection_fbx').repair_actions[0]);
    expect(card?.querySelector<HTMLInputElement>('[data-field="overwrite"]')?.checked).toBe(true);
    expect(shell.api).toHaveBeenCalledWith(
      'POST',
      '/v1/workflows/workflow.maya.export_selection_fbx/preflight',
      expect.objectContaining({ params: expect.objectContaining({ overwrite: true }) }),
      { timeoutMs: 60000 },
    );

    await page.handleRepairAction(workflow, card, { id: 'reconnect_maya_connector', title: '重新连接 Maya Connector', actionType: 'reconnect' });
    expect(shell.setShellView).toHaveBeenCalledWith('connections');
    expect(dom.window.ShellConnectionPage.focusConnection).toHaveBeenCalledWith('maya');
  });

  it('creates a repair session from a failed workflow result', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn().mockResolvedValue({
        ok: true,
        json: {
          repairSession: {
            id: 'repair_run_failed',
          },
        },
      }),
    };
    const opened = vi.fn();
    dom.window.__acOpenCopilotObjectSession = opened;
    page._shell = shell;
    page.workflows = [{
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      systemContract: { validation: { status: 'validated' } },
    }];
    page.historyRuns = [{
      id: 'run_failed',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'failed',
      error: { code: 'maya_command_timeout', message: 'Maya timeout', recoverable: true },
      repair_actions: [{ id: 'retry_or_restart_maya_connector', title: '重试或重启 Maya Connector' }],
      artifacts: [],
    }];
    page.render();

    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('修复会话');
    await page.createRepairSession(page.workflows[0], page.historyRuns[0]);

    expect(shell.api).toHaveBeenCalledWith(
      'POST',
      '/v1/workflows/runs/run_failed/repair-session',
      {},
      { timeoutMs: 30000 },
    );
    expect(dom.window.document.getElementById('workflowInlineStatus')?.textContent || '').toContain('已创建修复会话');
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow',
      id: 'workflow.maya.export_selection_fbx',
    }));
  });

  it('renders Artifact result panels and wires open/copy actions', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn().mockResolvedValue({
        ok: true,
        json: {
          draft: {
            id: 'draft_run_success',
            name: 'Maya FBX 草稿',
          },
          run: {
            id: 'run_success',
            workflow_id: 'workflow.maya.export_selection_fbx',
            status: 'succeeded',
            saved_as_draft_id: 'draft_run_success',
            artifacts: [{
              id: 'artifact_run_success',
              local_path: 'F:/exports/hero.fbx',
              metadata: { bytes: 2048 },
              status: 'created',
              uri: 'project://exports/hero.fbx',
            }],
          },
        },
      }),
      openFolderPath: vi.fn().mockResolvedValue({ ok: true }),
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    page._shell = shell;
    const workflow = {
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      systemContract: { validation: { status: 'validated' } },
    };
    page.workflows = [workflow];
    page.historyRuns = [{
      id: 'run_success',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'succeeded',
      finished_at: '2026-08-10T14:00:02.000Z',
      artifacts: [{
        id: 'artifact_run_success',
        local_path: 'F:/exports/hero.fbx',
        metadata: { bytes: 2048 },
        status: 'created',
        uri: 'project://exports/hero.fbx',
      }],
    }];
    page.render();

    const list = dom.window.document.getElementById('workflowList');
    const text = list?.textContent || '';
    expect(text).toContain('产物');
    expect(text).toContain('可用');
    expect(text).toContain('F:/exports/hero.fbx');
    expect(text).toContain('2.0 KB');
    expect(text).toContain('打开位置');
    expect(text).toContain('复制路径');
    expect(text).toContain('保存为工作流');
    expect(text).toContain('再次运行');

    const card = list?.querySelector('[data-workflow-id="workflow.maya.export_selection_fbx"]');
    const artifact = page.runsByWorkflowId.get('workflow.maya.export_selection_fbx').artifacts[0];
    await page.handleArtifactAction(workflow, card, artifact, 'open');
    expect(shell.openFolderPath).toHaveBeenCalledWith('F:/exports/hero.fbx');
    await page.handleArtifactAction(workflow, card, artifact, 'copy');
    expect(writeText).toHaveBeenCalledWith('F:/exports/hero.fbx');
    await page.handleArtifactAction(workflow, card, artifact, 'save-draft');
    expect(shell.api).toHaveBeenCalledWith(
      'POST',
      '/v1/workflows/runs/run_success/save-draft',
      { name: 'Maya FBX 草稿' },
      { timeoutMs: 30000 },
    );
    expect(dom.window.document.getElementById('workflowInlineStatus')?.textContent || '').toContain('已保存为工作流草稿');
    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('已保存草稿');

    page.historyRuns = [{
      id: 'run_missing',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'succeeded',
      finished_at: '2026-08-10T14:03:02.000Z',
      artifacts: [{
        id: 'artifact_missing',
        local_path: 'F:/exports/missing.fbx',
        metadata: { bytes: 0 },
        status: 'missing',
        uri: 'project://exports/missing.fbx',
      }],
    }];
    page.render();
    expect(dom.window.document.getElementById('workflowList')?.textContent || '').toContain('文件失效');
    expect(dom.window.document.querySelector('[data-artifact-action="open"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('reuses ReplaySnapshot params from history and sends source run id on rerun', async () => {
    const code = readFileSync(join(process.cwd(), 'companion-desktop/shell/workflow-page.js'), 'utf8');
    const dom = new JSDOM(`
      <html>
        <head></head>
        <body>
          <div id="workflowSummary"></div>
          <div id="workflowInlineStatus"></div>
          <div id="workflowEmpty" class="workflow-empty"></div>
          <div id="workflowList"></div>
          <div id="workflowHistoryMeta"></div>
          <div id="workflowHistoryEmpty"></div>
          <div id="workflowHistoryList"></div>
        </body>
      </html>
    `, { runScripts: 'outside-only' });

    dom.window.eval(code);
    const page = dom.window.ShellWorkflowPage;
    const shell = {
      api: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: {
            preflight: {
              status: 'passed',
              repair_actions: [],
              results: [{ check_id: 'maya_connector_online', message: 'Maya Connector 已连接。', status: 'passed' }],
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: {
            preflight: {
              status: 'passed',
              repair_actions: [],
              results: [{ check_id: 'maya_connector_online', message: 'Maya Connector 已连接。', status: 'passed' }],
            },
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          json: {
            result: {
              id: 'run_reuse_new',
              workflow_id: 'workflow.maya.export_selection_fbx',
              status: 'succeeded',
              reused_from_run_id: 'run_source',
              artifacts: [],
            },
          },
        }),
    };
    page._shell = shell;
    const workflow = {
      id: 'workflow.maya.export_selection_fbx',
      name: 'Maya FBX',
      status: 'available',
      userSummary: { title: '导出 Maya 选中对象', outputSummary: 'FBX' },
      systemContract: { validation: { status: 'validated' } },
    };
    const sourceRun = {
      id: 'run_source',
      workflow_id: 'workflow.maya.export_selection_fbx',
      status: 'succeeded',
      replay_snapshot: {
        normalized_input: {
          file_name: 'hero.fbx',
          output_dir: 'project://exports',
          overwrite: true,
        },
      },
      artifacts: [],
    };
    page.workflows = [workflow];
    page.historyRuns = [sourceRun];
    page.render();

    await page.reuseRun(sourceRun);
    const card = dom.window.document.querySelector('[data-workflow-id="workflow.maya.export_selection_fbx"]');
    expect(card?.querySelector<HTMLInputElement>('[data-field="file_name"]')?.value).toBe('hero.fbx');
    expect(card?.querySelector<HTMLInputElement>('[data-field="output_dir"]')?.value).toBe('project://exports');
    expect(card?.querySelector<HTMLInputElement>('[data-field="overwrite"]')?.checked).toBe(true);
    expect(shell.api).toHaveBeenNthCalledWith(
      1,
      'POST',
      '/v1/workflows/workflow.maya.export_selection_fbx/preflight',
      { params: { file_name: 'hero.fbx', output_dir: 'project://exports', overwrite: true } },
      { timeoutMs: 60000 },
    );

    await page.runWorkflow(workflow, card);
    expect(shell.api).toHaveBeenNthCalledWith(
      3,
      'POST',
      '/v1/workflows/workflow.maya.export_selection_fbx/run',
      {
        params: { file_name: 'hero.fbx', output_dir: 'project://exports', overwrite: true },
        reusedFromRunId: 'run_source',
      },
      { timeoutMs: 120000 },
    );
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
});
