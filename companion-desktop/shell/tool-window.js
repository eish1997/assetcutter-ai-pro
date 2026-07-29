/**
 * Standalone shell tool window (one tool per BrowserWindow).
 * Authored tools poll contentRev and auto-refresh panel without a reload button.
 */
(function () {
  'use strict';

  const DEFAULT_RUN_TIMEOUT_MS = 600000;
  const HOT_POLL_MS = 800;

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

  function ensureDraftBanner() {
    let el = $('toolDraftBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'toolDraftBanner';
    el.className = 'tool-draft-banner hidden';
    el.style.cssText =
      'margin:0 0 12px;padding:8px 10px;border-radius:8px;border:1px solid rgba(250,204,21,0.35);background:rgba(113,63,18,0.35);color:#fde68a;font-size:11px;line-height:1.45;';
    const body = $('toolModuleBody');
    if (body && body.parentNode) body.parentNode.insertBefore(el, body);
    return el;
  }

  function setDraftBanner(text) {
    const el = ensureDraftBanner();
    const t = String(text || '').trim();
    if (!t) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = t;
    el.classList.remove('hidden');
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
    let panel = null;
    let tool = {};
    let permissions = [];
    let contentRev = -1;
    let hotPollTimer = null;
    let running = false;
    let enableHotPoll = false;
    let toolOrigin = null;
    let reportingFix = false;

    const logEl = $('toolModuleLog');
    const actionsEl = $('toolModuleActions');

    function setActionsBusy(busy) {
      running = busy;
      if (!actionsEl) return;
      actionsEl.querySelectorAll('button').forEach((btn) => {
        btn.disabled = busy;
      });
    }

    async function autoSendFailureToCopilot(payload) {
      if (typeof api.reportRunFailure !== 'function') return;
      if (reportingFix) return;
      reportingFix = true;
      try {
        window.ShellToolsModule.appendLog(logEl, '正在把报错发给 Copilot 自动修复…\n');
        const r = await api.reportRunFailure({
          toolId,
          toolName: (tool && tool.name) || toolId,
          origin: toolOrigin,
          ...payload,
        });
        if (r && r.skipped) {
          window.ShellToolsModule.appendLog(logEl, '相同报错刚发过，已跳过重复发送\n');
        } else if (r && r.ok) {
          window.ShellToolsModule.appendLog(logEl, '已发给 Copilot，请在右侧看修复进度\n');
        } else {
          window.ShellToolsModule.appendLog(
            logEl,
            '自动发送失败：' + (r && r.error ? r.error : '未知错误') + '（可手动粘贴日志）\n',
          );
        }
      } catch (e) {
        window.ShellToolsModule.appendLog(
          logEl,
          '自动发送失败：' + (e instanceof Error ? e.message : String(e)) + '\n',
        );
      } finally {
        reportingFix = false;
      }
    }

    function mergeFieldDefaults(nextPanel) {
      for (const sec of nextPanel.sections || []) {
        for (const field of sec.fields || []) {
          if (Object.prototype.hasOwnProperty.call(fieldState, field.id)) continue;
          if (field.type === 'toggle') fieldState[field.id] = Boolean(field.default);
          else if (field.default != null) fieldState[field.id] = field.default;
          else if (field.type === 'path' || field.type === 'text' || field.type === 'select') fieldState[field.id] = '';
        }
      }
      // Drop state for removed fields
      const ids = new Set();
      for (const sec of nextPanel.sections || []) {
        for (const field of sec.fields || []) ids.add(field.id);
      }
      for (const key of Object.keys(fieldState)) {
        if (!ids.has(key)) delete fieldState[key];
      }
    }

    function bindActions() {
      const canPickPath = permissions.includes('path.pick') && typeof api.pickPath === 'function';
      const canOpenPath = typeof api.openFolderPath === 'function';
      const timeoutMs = runTimeoutMs(tool);

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
              const msg = openR.json && openR.json.message ? openR.json.message : '';
              window.ShellToolsModule.appendLog(
                logEl,
                '失败：' + formatError(err, msg) + '\n',
              );
              void autoSendFailureToCopilot({
                actionId: act.id,
                error: err,
                message: msg,
                params: fieldState,
              });
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
            const msg = runR.json && runR.json.message ? runR.json.message : '';
            window.ShellToolsModule.appendLog(logEl, '失败：' + formatError(err, msg) + '\n');
            void autoSendFailureToCopilot({
              actionId: act.id,
              error: err,
              message: msg,
              params: fieldState,
              stdout: runR.json && runR.json.stdout,
              stderr: runR.json && runR.json.stderr,
              exitCode: runR.json && runR.json.exitCode,
            });
            return;
          }
          const j = runR.json || {};
          if (j.stdout) window.ShellToolsModule.appendLog(logEl, j.stdout + (j.stdout.endsWith('\n') ? '' : '\n'));
          if (j.stderr) window.ShellToolsModule.appendLog(logEl, j.stderr + (j.stderr.endsWith('\n') ? '' : '\n'));
          if (j.ok === false) {
            window.ShellToolsModule.appendLog(logEl, '退出码 ' + j.exitCode + '\n');
            void autoSendFailureToCopilot({
              actionId: act.id,
              error: 'non_zero_exit',
              message: '脚本退出码非 0',
              params: fieldState,
              stdout: j.stdout,
              stderr: j.stderr,
              exitCode: j.exitCode,
            });
          } else window.ShellToolsModule.appendLog(logEl, '完成\n');
        } finally {
          setActionsBusy(false);
        }
      });
    }

    function applyPayload(json) {
      panel = json.panel;
      tool = json.tool || {};
      permissions = Array.isArray(json.permissions) ? json.permissions : [];
      contentRev = typeof json.contentRev === 'number' ? json.contentRev : 0;
      toolOrigin = json.origin || null;
      const title = panel.title || tool.name || toolId;
      document.title = title;
      $('titlebarToolName').textContent = title;
      const verEl = $('toolModuleVersion');
      if (verEl) {
        const v = tool.semver ? 'v' + tool.semver : '';
        verEl.textContent = v;
        if (v) verEl.removeAttribute('hidden');
        else verEl.setAttribute('hidden', '');
      }
      $('toolLoadError').classList.add('hidden');
      mergeFieldDefaults(panel);
      bindActions();
      if (json.draftError) {
        setDraftBanner('草稿无效，仍显示上一可用版：' + String(json.draftError));
      } else if (json.origin === 'authored' || json.origin === 'import') {
        setDraftBanner(running ? '已保存；新脚本将用于下次运行' : '');
      } else {
        setDraftBanner('');
      }
      enableHotPoll = json.origin === 'authored' || json.origin === 'import' || Boolean(json.watching);
    }

    async function loadTool(isHot) {
      const r = await api.api('GET', '/v1/shell-tools/' + encodeURIComponent(toolId), null);
      if (!r.ok || !r.json || !r.json.panel) {
        if (!isHot) {
          const err = r.json && r.json.error ? r.json.error : '';
          $('titlebarToolName').textContent = '无法加载';
          $('toolLoadError').textContent = formatError(err, r.json && r.json.message);
          $('toolLoadError').classList.remove('hidden');
        }
        return false;
      }
      const nextRev = typeof r.json.contentRev === 'number' ? r.json.contentRev : 0;
      const draftErr = r.json.draftError || null;
      if (isHot) {
        if (draftErr) {
          setDraftBanner('草稿无效，仍显示上一可用版：' + String(draftErr));
          return true;
        }
        if (nextRev === contentRev) return true;
        if (running) {
          setDraftBanner('已保存；新脚本将用于下次运行（UI 将在空闲时刷新）');
          // Still refresh UI when not mid-run field edits — but skip full rebind while running
          return true;
        }
      }
      applyPayload(r.json);
      return true;
    }

    const ok = await loadTool(false);
    if (!ok) return;

    async function pollHot() {
      if (!enableHotPoll) return;
      try {
        const hot = await api.api('GET', '/v1/shell-tools/authored/' + encodeURIComponent(toolId) + '/hot', null);
        if (hot.ok && hot.json) {
          if (hot.json.draftError) {
            setDraftBanner('草稿无效，仍显示上一可用版：' + String(hot.json.draftError));
          } else if (typeof hot.json.contentRev === 'number' && hot.json.contentRev !== contentRev) {
            await loadTool(true);
          } else if (!hot.json.draftError && !running) {
            // clear transient banner
            const el = $('toolDraftBanner');
            if (el && el.textContent && el.textContent.indexOf('下次运行') >= 0) setDraftBanner('');
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }

    if (enableHotPoll) {
      hotPollTimer = setInterval(() => void pollHot(), HOT_POLL_MS);
      window.addEventListener('beforeunload', () => {
        if (hotPollTimer) clearInterval(hotPollTimer);
      });
    }
  }

  void init();
})();
