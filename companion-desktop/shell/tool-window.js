/**
 * Standalone shell tool window (one tool per BrowserWindow).
 */
(function () {
  'use strict';

  const DEFAULT_RUN_TIMEOUT_MS = 600000;

  const ERROR_MESSAGES = {
    tool_not_found: '未找到该工具（可能已卸载）',
    tool_invalid_manifest: '工具包清单无效，请重新安装',
    permission_denied: '缺少权限，无法执行此操作',
    run_not_configured: '该工具未配置运行命令',
    run_timeout: '运行超时',
    invalid_params: '参数不完整或路径无效',
    maya_not_connected: '无法连接 Maya Command Port',
    maya_not_configured: '该工具未配置 Maya 入口',
    host_unsupported: '暂不支持该宿主',
    MAYA_NOT_CONNECTED: '无法连接 Maya Command Port',
    MAYA_EXEC_TIMEOUT: 'Maya 执行超时',
    MAYA_RUNTIME_ERROR: 'Maya 执行失败',
  };

  function formatError(code, message) {
    const c = String(code || '').trim();
    const base = ERROR_MESSAGES[c] || c || '未知错误';
    const detail = message && String(message).trim() && String(message).trim() !== c ? String(message).trim() : '';
    return detail ? base + '：' + detail : base;
  }

  function toolIdFromQuery() {
    const q = new URLSearchParams(window.location.search);
    return String(q.get('toolId') || '').trim();
  }

  function $(id) {
    return document.getElementById(id);
  }

  function firstPathFieldValue(panel, fieldState) {
    for (const sec of panel.sections || []) {
      for (const field of sec.fields || []) {
        if (field.type === 'path') {
          const v = fieldState[field.id];
          if (typeof v === 'string' && v.trim()) return v.trim();
        }
      }
    }
    return '';
  }

  function runTimeoutMs(tool) {
    const n = Number(tool && tool.run && tool.run.timeoutMs);
    if (Number.isFinite(n) && n >= 1000) return Math.min(Math.floor(n), DEFAULT_RUN_TIMEOUT_MS);
    return DEFAULT_RUN_TIMEOUT_MS;
  }

  async function init() {
    const api = window.companionToolWindow;
    if (!api) {
      $('toolLoadError').textContent = '窗口 API 未就绪';
      $('toolLoadError').classList.remove('hidden');
      return;
    }

    const toolId = toolIdFromQuery();
    if (!toolId) {
      $('toolLoadError').textContent = '缺少 toolId 参数';
      $('toolLoadError').classList.remove('hidden');
      return;
    }

    $('btnToolMin').addEventListener('click', () => void api.minimize());
    $('btnToolClose').addEventListener('click', () => void api.close());

    const pinBtn = $('btnToolPin');
    let pinned = false;
    try {
      const pinState = await api.getPin();
      if (pinState && pinState.ok) pinned = Boolean(pinState.pinned);
    } catch {
      /* ignore */
    }
    function applyPinUi() {
      pinBtn.classList.toggle('pinned', pinned);
      pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      pinBtn.title = pinned ? '取消置顶' : '置顶';
      pinBtn.setAttribute('aria-label', pinned ? '取消置顶' : '置顶');
    }
    applyPinUi();
    pinBtn.addEventListener('click', async () => {
      pinned = !pinned;
      try {
        const r = await api.togglePin(pinned);
        if (r && r.ok) pinned = Boolean(r.pinned);
      } catch {
        pinned = !pinned;
      }
      applyPinUi();
    });

    const fieldState = {};
    const r = await api.api('GET', '/v1/shell-tools/' + encodeURIComponent(toolId), null);
    if (!r.ok || !r.json || !r.json.panel) {
      const err = r.json && r.json.error ? r.json.error : '';
      $('toolModuleTitle').textContent = '无法加载';
      $('toolLoadError').textContent = formatError(err, r.json && r.json.message);
      $('toolLoadError').classList.remove('hidden');
      return;
    }

    const panel = r.json.panel;
    const tool = r.json.tool || {};
    const title = panel.title || tool.name || toolId;
    const permissions = Array.isArray(r.json.permissions) ? r.json.permissions : [];
    const canPickPath = permissions.includes('path.pick') && typeof api.pickPath === 'function';
    const canOpenPath = typeof api.openFolderPath === 'function';
    const timeoutMs = runTimeoutMs(tool);

    document.title = title;
    $('titlebarToolName').textContent = title;
    $('toolModuleTitle').textContent = title;
    $('toolModuleVersion').textContent = 'v' + (tool.semver || '—');

    const logEl = $('toolModuleLog');
    const actionsEl = $('toolModuleActions');
    let running = false;

    function setActionsBusy(busy) {
      running = busy;
      if (!actionsEl) return;
      actionsEl.querySelectorAll('button').forEach((btn) => {
        btn.disabled = busy;
      });
    }

    window.ShellToolsModule.renderPanelFields(
      $('toolModuleBody'),
      panel,
      fieldState,
      { pickPath: canPickPath ? (opts) => api.pickPath(opts) : undefined },
      (next) => {
        Object.assign(fieldState, next);
      },
    );
    window.ShellToolsModule.renderActions(actionsEl, panel, async (act) => {
      if (running) return;
      if (act.kind === 'openPath') {
        const pathVal = firstPathFieldValue(panel, fieldState);
        if (!pathVal) {
          window.ShellToolsModule.appendLog(logEl, '请先选择路径\n');
          return;
        }
        if (!canOpenPath) {
          window.ShellToolsModule.appendLog(logEl, '当前环境不支持打开路径\n');
          return;
        }
        try {
          const openR = await api.openFolderPath(pathVal);
          if (!openR || !openR.ok) {
            window.ShellToolsModule.appendLog(logEl, '无法打开路径\n');
          }
        } catch (e) {
          window.ShellToolsModule.appendLog(
            logEl,
            '打开失败：' + (e instanceof Error ? e.message : String(e)) + '\n',
          );
        }
        return;
      }
      if (act.kind === 'open_in_host') {
        const host = String(act.host || 'maya').trim().toLowerCase() || 'maya';
        setActionsBusy(true);
        window.ShellToolsModule.clearLog(logEl);
        window.ShellToolsModule.appendLog(logEl, '正在注入 ' + host + '…\n');
        try {
          const mayaHost =
            typeof fieldState.mayaHost === 'string' && fieldState.mayaHost.trim()
              ? fieldState.mayaHost.trim()
              : undefined;
          const mayaPortRaw =
            typeof fieldState.mayaPort === 'string' && fieldState.mayaPort.trim()
              ? fieldState.mayaPort.trim()
              : undefined;
          const openR = await api.api(
            'POST',
            '/v1/shell-tools/' + encodeURIComponent(toolId) + '/open-in-host',
            {
              host: host,
              mayaHost: mayaHost,
              mayaPort: mayaPortRaw,
            },
            { timeoutMs: Math.max(timeoutMs, 90000) },
          );
          if (!openR.ok) {
            const err = openR.json && openR.json.error ? openR.json.error : '';
            window.ShellToolsModule.appendLog(
              logEl,
              '失败：' + formatError(err, openR.json && openR.json.message) + '\n',
            );
            return;
          }
          const j = openR.json || {};
          if (j.message) window.ShellToolsModule.appendLog(logEl, j.message + '\n');
          if (j.stdout) window.ShellToolsModule.appendLog(logEl, j.stdout + (j.stdout.endsWith('\n') ? '' : '\n'));
          window.ShellToolsModule.appendLog(logEl, '完成\n');
        } finally {
          setActionsBusy(false);
        }
        return;
      }
      if (act.kind !== 'run') return;
      setActionsBusy(true);
      window.ShellToolsModule.clearLog(logEl);
      window.ShellToolsModule.appendLog(logEl, '运行中…\n');
      try {
        const runR = await api.api(
          'POST',
          '/v1/shell-tools/' + encodeURIComponent(toolId) + '/run',
          {
            actionId: act.id,
            params: fieldState,
          },
          { timeoutMs },
        );
        if (!runR.ok) {
          const err = runR.json && runR.json.error ? runR.json.error : '';
          window.ShellToolsModule.appendLog(logEl, '失败：' + formatError(err, runR.json && runR.json.message) + '\n');
          return;
        }
        const j = runR.json || {};
        if (j.stdout) window.ShellToolsModule.appendLog(logEl, j.stdout + (j.stdout.endsWith('\n') ? '' : '\n'));
        if (j.stderr) window.ShellToolsModule.appendLog(logEl, j.stderr + (j.stderr.endsWith('\n') ? '' : '\n'));
        if (j.ok === false) window.ShellToolsModule.appendLog(logEl, '退出码 ' + j.exitCode + '\n');
        else window.ShellToolsModule.appendLog(logEl, '完成\n');
      } finally {
        setActionsBusy(false);
      }
    });
  }

  void init();
})();
