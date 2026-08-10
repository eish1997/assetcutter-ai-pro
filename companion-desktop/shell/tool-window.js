/**
 * Shell tool workspace: one BrowserWindow, many tool tabs.
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

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function formatError(code, message) {
    const c = String(code || '').trim();
    const base = ERROR_MESSAGES[c] || c || '未知错误';
    const detail = message && String(message).trim() && String(message).trim() !== c ? String(message).trim() : '';
    return detail ? base + '：' + detail : base;
  }

  function toolIdsFromQuery() {
    const q = new URLSearchParams(window.location.search);
    const raw = String(q.get('toolId') || '').trim();
    return raw ? [raw] : [];
  }

  function runTimeoutMs(tool) {
    const n = Number(tool && tool.run && tool.run.timeoutMs);
    if (Number.isFinite(n) && n >= 1000) return Math.min(Math.floor(n), DEFAULT_RUN_TIMEOUT_MS);
    return DEFAULT_RUN_TIMEOUT_MS;
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

  function shortIcon(name, id) {
    const raw = String(name || id || 'T').trim();
    const ascii = raw.match(/[a-zA-Z0-9]/);
    return (ascii ? ascii[0] : raw[0] || 'T').toUpperCase();
  }

  async function init() {
    const api = window.companionToolWindow;
    if (!api) return;

    const workspace = $('toolWorkspace');
    const navList = $('toolNavList');
    const panelsEl = $('toolPanels');
    const titleEl = $('titlebarToolName');
    const verEl = $('toolModuleVersion');
    const tabs = new Map();
    let activeToolId = '';
    let detailsHidden = false;
    let pinned = false;

    $('btnToolMin').addEventListener('click', () => void api.minimize());
    $('btnToolClose').addEventListener('click', () => void api.close());

    const pinBtn = $('btnToolPin');
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

    function setWorkspaceTitle(tab) {
      if (!tab) {
        document.title = '工具';
        titleEl.textContent = '工具';
        verEl.setAttribute('hidden', '');
        verEl.textContent = '';
        return;
      }
      const title = tab.title || tab.toolId;
      document.title = title;
      titleEl.textContent = title;
      const v = tab.tool && tab.tool.semver ? 'v' + tab.tool.semver : '';
      verEl.textContent = v;
      if (v) verEl.removeAttribute('hidden');
      else verEl.setAttribute('hidden', '');
    }

    function setDetailsHidden(hidden) {
      detailsHidden = Boolean(hidden);
      workspace.classList.toggle('details-hidden', detailsHidden);
      document.body.classList.toggle('details-hidden', detailsHidden);
      if (typeof api.setDetailsCollapsed === 'function') {
        void api.setDetailsCollapsed(detailsHidden).catch(() => {});
      }
    }

    function createTabShell(toolId) {
      const navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.className = 'tool-nav-item';
      navBtn.innerHTML =
        '<span class="tool-nav-icon">' + esc(shortIcon('', toolId)) + '</span><span class="tool-nav-name">' + esc(toolId) + '</span>';
      const navIcon = navBtn.querySelector('.tool-nav-icon');
      const navName = navBtn.querySelector('.tool-nav-name');

      const panel = document.createElement('div');
      panel.className = 'tool-panel';
      panel.innerHTML =
        '<div class="tool-body">' +
        '<div class="tool-load-error hidden"></div>' +
        '<div class="tool-module-body"></div>' +
        '<div class="tool-module-actions"></div>' +
        '<pre class="tool-module-log hidden"></pre>' +
        '</div>';

      navList.appendChild(navBtn);
      panelsEl.appendChild(panel);

      const tab = {
        toolId,
        navBtn,
        navIcon,
        navName,
        panel,
        loadError: panel.querySelector('.tool-load-error'),
        bodyEl: panel.querySelector('.tool-module-body'),
        actionsEl: panel.querySelector('.tool-module-actions'),
        logEl: panel.querySelector('.tool-module-log'),
        fieldState: {},
        panelSpec: null,
        tool: {},
        permissions: [],
        contentRev: -1,
        hotPollTimer: null,
        running: false,
        enableHotPoll: false,
        toolOrigin: null,
        reportingFix: false,
        clickTimer: null,
        title: toolId,
      };

      navBtn.addEventListener('click', () => {
        if (tab.clickTimer) clearTimeout(tab.clickTimer);
        tab.clickTimer = setTimeout(() => {
          tab.clickTimer = null;
          if (activeToolId === toolId) {
            setDetailsHidden(!detailsHidden);
          } else {
            activateTool(toolId, true);
          }
        }, 220);
      });
      navBtn.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        if (tab.clickTimer) {
          clearTimeout(tab.clickTimer);
          tab.clickTimer = null;
        }
        closeToolTab(toolId);
      });
      return tab;
    }

    function activateTool(toolId, showDetails) {
      if (!tabs.has(toolId)) return;
      activeToolId = toolId;
      for (const [id, tab] of tabs) {
        const active = id === toolId;
        tab.navBtn.classList.toggle('active', active);
        tab.panel.classList.toggle('active', active);
      }
      if (showDetails) setDetailsHidden(false);
      setWorkspaceTitle(tabs.get(toolId));
    }

    function closeToolTab(toolId) {
      const tab = tabs.get(toolId);
      if (!tab) return;
      if (tab.clickTimer) clearTimeout(tab.clickTimer);
      if (tab.hotPollTimer) clearInterval(tab.hotPollTimer);
      tab.navBtn.remove();
      tab.panel.remove();
      tabs.delete(toolId);
      if (activeToolId === toolId) {
        const next = Array.from(tabs.keys()).pop() || '';
        if (next) activateTool(next, !detailsHidden);
        else {
          setDetailsHidden(false);
          setWorkspaceTitle(null);
        }
      }
      if (!tabs.size) void api.close();
    }

    function ensureDraftBanner(tab) {
      let el = tab.panel.querySelector('.tool-draft-banner');
      if (el) return el;
      el = document.createElement('div');
      el.className = 'tool-draft-banner hidden';
      el.style.cssText =
        'margin:0 0 12px;padding:8px 10px;border-radius:8px;border:1px solid rgba(250,204,21,0.35);background:rgba(113,63,18,0.35);color:#fde68a;font-size:11px;line-height:1.45;';
      const body = tab.bodyEl;
      if (body && body.parentNode) body.parentNode.insertBefore(el, body);
      return el;
    }

    function setDraftBanner(tab, text) {
      const el = ensureDraftBanner(tab);
      const t = String(text || '').trim();
      if (!t) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
      }
      el.textContent = t;
      el.classList.remove('hidden');
    }

    function setActionsBusy(tab, busy) {
      tab.running = busy;
      tab.actionsEl.querySelectorAll('button').forEach((btn) => {
        btn.disabled = busy;
      });
    }

    async function autoSendFailureToCopilot(tab, payload) {
      if (typeof api.reportRunFailure !== 'function') return;
      if (tab.reportingFix) return;
      tab.reportingFix = true;
      try {
        window.ShellToolsModule.appendLog(tab.logEl, '正在把报错发给 Copilot 自动修复…\n');
        const r = await api.reportRunFailure({
          toolId: tab.toolId,
          toolName: (tab.tool && tab.tool.name) || tab.toolId,
          origin: tab.toolOrigin,
          ...payload,
        });
        if (r && r.skipped) window.ShellToolsModule.appendLog(tab.logEl, '相同报错刚发过，已跳过重复发送\n');
        else if (r && r.ok) window.ShellToolsModule.appendLog(tab.logEl, '已发给 Copilot，请在右侧看修复进度\n');
        else window.ShellToolsModule.appendLog(tab.logEl, '自动发送失败，可手动粘贴日志\n');
      } catch (e) {
        window.ShellToolsModule.appendLog(tab.logEl, '自动发送失败：' + (e instanceof Error ? e.message : String(e)) + '\n');
      } finally {
        tab.reportingFix = false;
      }
    }

    function mergeFieldDefaults(tab, nextPanel) {
      for (const sec of nextPanel.sections || []) {
        for (const field of sec.fields || []) {
          if (Object.prototype.hasOwnProperty.call(tab.fieldState, field.id)) continue;
          if (field.type === 'toggle') tab.fieldState[field.id] = Boolean(field.default);
          else if (field.default != null) tab.fieldState[field.id] = field.default;
          else if (field.type === 'path' || field.type === 'text' || field.type === 'select') tab.fieldState[field.id] = '';
        }
      }
      const ids = new Set();
      for (const sec of nextPanel.sections || []) {
        for (const field of sec.fields || []) ids.add(field.id);
      }
      for (const key of Object.keys(tab.fieldState)) {
        if (!ids.has(key)) delete tab.fieldState[key];
      }
    }

    function bindActions(tab) {
      const canPickPath = tab.permissions.includes('path.pick') && typeof api.pickPath === 'function';
      const canOpenPath = typeof api.openFolderPath === 'function';
      const timeoutMs = runTimeoutMs(tab.tool);

      window.ShellToolsModule.renderPanelFields(
        tab.bodyEl,
        tab.panelSpec,
        tab.fieldState,
        { pickPath: canPickPath ? (opts) => api.pickPath(opts) : undefined },
        (next) => Object.assign(tab.fieldState, next),
      );

      window.ShellToolsModule.renderActions(tab.actionsEl, tab.panelSpec, async (act) => {
        if (tab.running) return;
        if (act.kind === 'openPath') {
          const pathVal = firstPathFieldValue(tab.panelSpec, tab.fieldState);
          if (!pathVal) {
            window.ShellToolsModule.appendLog(tab.logEl, '请先选择路径\n');
            return;
          }
          if (!canOpenPath) {
            window.ShellToolsModule.appendLog(tab.logEl, '当前环境不支持打开路径\n');
            return;
          }
          try {
            const openR = await api.openFolderPath(pathVal);
            if (!openR || !openR.ok) window.ShellToolsModule.appendLog(tab.logEl, '无法打开路径\n');
          } catch (e) {
            window.ShellToolsModule.appendLog(tab.logEl, '打开失败：' + (e instanceof Error ? e.message : String(e)) + '\n');
          }
          return;
        }

        if (act.kind !== 'run' && act.kind !== 'open_in_host') return;
        setActionsBusy(tab, true);
        window.ShellToolsModule.clearLog(tab.logEl);
        window.ShellToolsModule.appendLog(tab.logEl, (act.kind === 'open_in_host' ? '正在注入…' : '运行中…') + '\n');
        try {
          const path =
            act.kind === 'open_in_host'
              ? '/v1/shell-tools/' + encodeURIComponent(tab.toolId) + '/open-in-host'
              : '/v1/shell-tools/' + encodeURIComponent(tab.toolId) + '/run';
          const body =
            act.kind === 'open_in_host'
              ? {
                  host: String(act.host || 'maya').trim().toLowerCase() || 'maya',
                  mayaHost: typeof tab.fieldState.mayaHost === 'string' ? tab.fieldState.mayaHost.trim() : undefined,
                  mayaPort: typeof tab.fieldState.mayaPort === 'string' ? tab.fieldState.mayaPort.trim() : undefined,
                }
              : { actionId: act.id, params: tab.fieldState };
          const runR = await api.api('POST', path, body, { timeoutMs: act.kind === 'open_in_host' ? Math.max(timeoutMs, 90000) : timeoutMs });
          if (!runR.ok) {
            const err = runR.json && runR.json.error ? runR.json.error : '';
            const msg = runR.json && runR.json.message ? runR.json.message : '';
            window.ShellToolsModule.appendLog(tab.logEl, '失败：' + formatError(err, msg) + '\n');
            void autoSendFailureToCopilot(tab, {
              actionId: act.id,
              error: err,
              message: msg,
              params: tab.fieldState,
              stdout: runR.json && runR.json.stdout,
              stderr: runR.json && runR.json.stderr,
              exitCode: runR.json && runR.json.exitCode,
            });
            return;
          }
          const j = runR.json || {};
          if (j.message) window.ShellToolsModule.appendLog(tab.logEl, j.message + '\n');
          if (j.stdout) window.ShellToolsModule.appendLog(tab.logEl, j.stdout + (j.stdout.endsWith('\n') ? '' : '\n'));
          if (j.stderr) window.ShellToolsModule.appendLog(tab.logEl, j.stderr + (j.stderr.endsWith('\n') ? '' : '\n'));
          if (j.ok === false) {
            window.ShellToolsModule.appendLog(tab.logEl, '退出码 ' + j.exitCode + '\n');
            void autoSendFailureToCopilot(tab, {
              actionId: act.id,
              error: 'non_zero_exit',
              message: '脚本退出码非 0',
              params: tab.fieldState,
              stdout: j.stdout,
              stderr: j.stderr,
              exitCode: j.exitCode,
            });
          } else {
            window.ShellToolsModule.appendLog(tab.logEl, '完成\n');
          }
        } finally {
          setActionsBusy(tab, false);
        }
      });
    }

    function applyPayload(tab, json) {
      tab.panelSpec = json.panel;
      tab.tool = json.tool || {};
      tab.permissions = Array.isArray(json.permissions) ? json.permissions : [];
      tab.contentRev = typeof json.contentRev === 'number' ? json.contentRev : 0;
      tab.toolOrigin = json.origin || null;
      tab.title = tab.panelSpec.title || tab.tool.name || tab.toolId;
      tab.navName.textContent = tab.title;
      tab.navIcon.textContent = shortIcon(tab.title, tab.toolId);
      tab.navBtn.title = tab.title;
      tab.navBtn.setAttribute('aria-label', tab.title);
      tab.loadError.classList.add('hidden');
      mergeFieldDefaults(tab, tab.panelSpec);
      bindActions(tab);
      if (json.draftError) setDraftBanner(tab, '草稿无效，仍显示上一可用版：' + String(json.draftError));
      else if (json.origin === 'authored' || json.origin === 'import') setDraftBanner(tab, tab.running ? '已保存；新脚本将用于下次运行' : '');
      else setDraftBanner(tab, '');
      tab.enableHotPoll = json.origin === 'authored' || json.origin === 'import' || Boolean(json.watching);
      if (activeToolId === tab.toolId) setWorkspaceTitle(tab);
    }

    async function loadTool(tab, isHot) {
      const r = await api.api('GET', '/v1/shell-tools/' + encodeURIComponent(tab.toolId), null);
      if (!r.ok || !r.json || !r.json.panel) {
        if (!isHot) {
          const err = r.json && r.json.error ? r.json.error : '';
          tab.loadError.textContent = formatError(err, r.json && r.json.message);
          tab.loadError.classList.remove('hidden');
        }
        return false;
      }
      const nextRev = typeof r.json.contentRev === 'number' ? r.json.contentRev : 0;
      const draftErr = r.json.draftError || null;
      if (isHot) {
        if (draftErr) {
          setDraftBanner(tab, '草稿无效，仍显示上一可用版：' + String(draftErr));
          return true;
        }
        if (nextRev === tab.contentRev) return true;
        if (tab.running) {
          setDraftBanner(tab, '已保存；新脚本将用于下次运行，空闲时刷新');
          return true;
        }
      }
      applyPayload(tab, r.json);
      return true;
    }

    async function pollHot(tab) {
      if (!tab.enableHotPoll) return;
      try {
        const hot = await api.api('GET', '/v1/shell-tools/authored/' + encodeURIComponent(tab.toolId) + '/hot', null);
        if (hot.ok && hot.json) {
          if (hot.json.draftError) setDraftBanner(tab, '草稿无效，仍显示上一可用版：' + String(hot.json.draftError));
          else if (typeof hot.json.contentRev === 'number' && hot.json.contentRev !== tab.contentRev) await loadTool(tab, true);
          else if (!hot.json.draftError && !tab.running) {
            const el = tab.panel.querySelector('.tool-draft-banner');
            if (el && el.textContent && el.textContent.indexOf('下次运行') >= 0) setDraftBanner(tab, '');
          }
        }
      } catch {
        /* ignore poll errors */
      }
    }

    async function addTool(toolIdRaw) {
      const toolId = String(toolIdRaw || '').trim();
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(toolId)) return;
      let tab = tabs.get(toolId);
      if (tab) {
        activateTool(toolId, true);
        return;
      }
      tab = createTabShell(toolId);
      tabs.set(toolId, tab);
      activateTool(toolId, true);
      await loadTool(tab, false);
      if (tab.enableHotPoll && !tab.hotPollTimer) {
        tab.hotPollTimer = setInterval(() => void pollHot(tab), HOT_POLL_MS);
      }
    }

    window.addEventListener('beforeunload', () => {
      for (const tab of tabs.values()) {
        if (tab.hotPollTimer) clearInterval(tab.hotPollTimer);
      }
    });

    if (typeof api.onOpenTool === 'function') {
      api.onOpenTool((payload) => void addTool(payload && payload.toolId));
    }
    if (typeof api.onCloseTool === 'function') {
      api.onCloseTool((payload) => closeToolTab(payload && payload.toolId));
    }

    for (const id of toolIdsFromQuery()) await addTool(id);
  }

  void init();
})();
