/**
 * Tools → 桥接管理：Maya Command Port 一键安装 / 探测 / 卸载。
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parsePort(el) {
    const n = Number(el && el.value != null ? el.value : 7001);
    if (!Number.isFinite(n) || n < 1 || n > 65535) return 7001;
    return Math.floor(n);
  }

  window.ShellToolsBridges = {
    _shell: null,
    _mayaStatus: null,
    _probe: null,
    _busy: false,
    _selectedVersionIds: null,

    showSection(section) {
      const next = section === 'rack' ? 'rack' : 'bridges';
      document.querySelectorAll('.tools-section-nav a[data-tools-section]').forEach((link) => {
        const on = link.getAttribute('data-tools-section') === next;
        link.classList.toggle('active', on);
        if (on) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      document.querySelectorAll('.tools-section-panel[data-tools-section-panel]').forEach((panel) => {
        const on = panel.getAttribute('data-tools-section-panel') === next;
        panel.classList.toggle('is-active', on);
        panel.hidden = !on;
      });
      return next;
    },

    bind(shell) {
      this._shell = shell;
      document.querySelectorAll('.tools-section-nav a[data-tools-section]').forEach((link) => {
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          const sec = this.showSection(link.getAttribute('data-tools-section'));
          if (sec === 'bridges') void this.reload(shell);
          else if (window.ShellToolsPage) void window.ShellToolsPage.reloadAll(shell);
        });
      });
      $('btnBridgesRefresh')?.addEventListener('click', () => void this.reload(shell));
    },

    async onViewShown(shell) {
      this._shell = shell;
      this.showSection('bridges');
      await this.reload(shell);
    },

    async reload(shell) {
      if (this._busy) return;
      this._shell = shell || this._shell;
      if (!this._shell) return;
      await this.refreshMaya(this._shell);
      this.render();
    },

    async refreshMaya(shell) {
      let statusR;
      try {
        statusR = await shell.api('GET', '/v1/bridges/maya', null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || '加载失败');
        const offline = /ECONNREFUSED|ECONNRESET|fetch failed|network|timeout/i.test(msg);
        this._mayaStatus = {
          error: offline
            ? '本机伴侣未就绪（' + msg + '）。请确认桌面壳已启动本地伴侣，或托盘「重启本地伴侣」后再刷新。'
            : msg,
          versions: [],
          defaultPort: 7001,
          port: 7001,
          installed: false,
          bridgeSourcePath: null,
          companionOffline: offline,
        };
        this._probe = null;
        return;
      }
      if (statusR.ok && statusR.json) {
        this._mayaStatus = statusR.json;
        if (!this._selectedVersionIds) {
          this._selectedVersionIds = new Set(
            (statusR.json.versions || []).map((v) => v.id).filter(Boolean),
          );
        }
      } else {
        const errText =
          (statusR.json && (statusR.json.message || statusR.json.error)) || statusR.error || '加载失败';
        const offline = /ECONNREFUSED|ECONNRESET|Companion|18765/i.test(String(errText));
        this._mayaStatus = {
          error: offline
            ? '本机伴侣未就绪（' + errText + '）。请托盘「重启本地伴侣」或先关掉占用 18765 的旧进程后再试。'
            : errText,
          versions: [],
          defaultPort: 7001,
          port: 7001,
          installed: false,
          bridgeSourcePath: null,
          companionOffline: offline,
        };
        this._probe = null;
        return;
      }

      const port = this._mayaStatus.port || this._mayaStatus.defaultPort || 7001;
      const probeR = await shell.api(
        'GET',
        '/v1/script-connectors?mayaHost=127.0.0.1&mayaPort=' + encodeURIComponent(String(port)) + '&bustCache=1',
        null,
      );
      this._probe = probeR.ok && probeR.json ? probeR.json : null;
    },

    mayaConnector() {
      const list = this._probe && Array.isArray(this._probe.connectors) ? this._probe.connectors : [];
      return list.find((c) => c && (c.targetType === 'maya' || c.id === 'maya.command_port@v1')) || null;
    },

    mayaUiState() {
      const st = this._mayaStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const hasMarker = versions.some((v) => v.hasUserSetupMarker);
      const maya = this.mayaConnector();
      const connected = Boolean(maya && maya.status === 'ok');
      const occupied = Boolean(maya && maya.status === 'occupied');
      const probeErr = maya && maya.message ? String(maya.message) : '';

      if (connected) {
        return { key: 'connected', label: '已连接', pill: 'is-ok', detail: 'Command Port 可探测' };
      }
      if (occupied) {
        return {
          key: 'occupied',
          label: '忙碌中',
          pill: 'is-warn',
          detail: probeErr || 'Maya 正在执行脚本，探针暂不可用（属正常）',
        };
      }
      if (hasMarker || st.installed) {
        return {
          key: 'pending',
          label: '已写入 · 待重启',
          pill: 'is-warn',
          detail: probeErr
            ? '已安装桥接，但当前连不上：' + probeErr + '。请打开/重启 Maya 后再探测。'
            : '已写入 userSetup。请打开或重启 Maya，再点「探测连接」。',
        };
      }
      if (!versions.length) {
        return {
          key: 'no_dir',
          label: '未发现 Maya',
          pill: 'is-err',
          detail: '未找到 Documents/maya/*/scripts。可手动选择 scripts 目录后安装。',
        };
      }
      return {
        key: 'not_installed',
        label: '未安装',
        pill: '',
        detail: '一键安装会复制 Script Hub Bridge 并写入 userSetup（启动时开端口）。',
      };
    },

    render() {
      const host = $('bridgesList');
      if (!host) return;
      const st = this._mayaStatus || {};
      const versions = Array.isArray(st.versions) ? st.versions : [];
      const ui = this.mayaUiState();
      const port = st.port || st.defaultPort || 7001;
      const selected = this._selectedVersionIds || new Set();

      let versionsHtml = '';
      if (versions.length) {
        versionsHtml =
          '<ul class="bridge-versions" id="mayaBridgeVersions">' +
          versions
            .map((v) => {
              const checked = selected.has(v.id) ? ' checked' : '';
              const marks = [];
              if (v.hasUserSetupMarker) marks.push('已写入');
              if (v.hasBridgePy) marks.push('有 bridge.py');
              const mark = marks.length ? ' · ' + marks.join(' · ') : '';
              const dirHint = v.scriptsDir ? '<div class="bridge-version-path">' + esc(v.scriptsDir) + '</div>' : '';
              return (
                '<li><label><input type="checkbox" data-maya-version="' +
                esc(v.id) +
                '"' +
                checked +
                ' /> <span>' +
                esc(v.label) +
                '</span><span style="color:var(--muted)">' +
                esc(mark) +
                '</span>' +
                dirHint +
                '</label></li>'
              );
            })
            .join('') +
          '</ul>';
      } else {
        versionsHtml = '<p class="bridge-meta">暂无检测到的版本目录</p>';
      }

      const dirs = versions.map((v) => v.scriptsDir).filter(Boolean);
      const metaLines = [];
      if (st.error) metaLines.push('错误：' + st.error);
      if (!st.companionOffline) {
        if (st.bridgeSourcePath) metaLines.push('安装源：' + st.bridgeSourcePath);
        else metaLines.push('安装源：未找到 script_hub_bridge.py（需安装含桥接资源的桌面壳 ≥0.2.3）');
        if (st.install && st.install.installedAt) {
          metaLines.push('上次安装：' + st.install.installedAt + ' · port ' + (st.install.port || port));
        }
        if (dirs[0]) metaLines.push('示例路径：' + dirs[0]);
        metaLines.push(ui.detail);
      }

      host.innerHTML =
        '<article class="bridge-card" data-bridge-id="maya">' +
        '<div class="bridge-card-head">' +
        '<div><h2 class="bridge-card-title">Maya</h2>' +
        '<p class="bridge-card-sub">Command Port 桥（默认 127.0.0.1:7001）。装完需重启 Maya。</p></div>' +
        '<span class="bridge-status-pill ' +
        esc(ui.pill) +
        '">' +
        esc(ui.label) +
        '</span></div>' +
        '<div class="bridge-row">' +
        '<label class="bridge-field-label" for="mayaBridgePort">端口</label>' +
        '<input type="number" class="bridge-port-input" id="mayaBridgePort" min="1" max="65535" value="' +
        esc(String(port)) +
        '" />' +
        '</div>' +
        '<div><div class="bridge-card-sub" style="margin-bottom:6px">安装到版本</div>' +
        versionsHtml +
        '</div>' +
        '<p class="bridge-meta">' +
        esc(metaLines.join('\n')) +
        '</p>' +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn primary" id="btnMayaBridgeInstall">一键安装</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgeProbe">探测连接</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgePickDir">选择 scripts…</button>' +
        '<button type="button" class="bridge-btn" id="btnMayaBridgeOpenDir"' +
        (dirs[0] ? '' : ' disabled') +
        '>打开目录</button>' +
        '<button type="button" class="bridge-btn danger" id="btnMayaBridgeUninstall"' +
        (ui.key === 'not_installed' || ui.key === 'no_dir' ? ' disabled' : '') +
        '>卸载标记</button>' +
        '</div></article>' +
        '<article class="bridge-card is-disabled" data-bridge-id="unreal">' +
        '<div class="bridge-card-head">' +
        '<div><h2 class="bridge-card-title">Unreal</h2>' +
        '<p class="bridge-card-sub">占位：后续接入 Remote Execution / 伴侣 script-connectors。</p></div>' +
        '<span class="bridge-status-pill">后续</span></div>' +
        '<div class="bridge-actions">' +
        '<button type="button" class="bridge-btn" disabled>一键安装</button>' +
        '<button type="button" class="bridge-btn" disabled>探测连接</button>' +
        '</div></article>';

      this.bindMayaCardActions();
    },

    selectedVersionsFromDom() {
      const ids = [];
      document.querySelectorAll('#mayaBridgeVersions input[data-maya-version]').forEach((el) => {
        if (el.checked) ids.push(el.getAttribute('data-maya-version'));
      });
      this._selectedVersionIds = new Set(ids);
      return ids;
    },

    bindMayaCardActions() {
      const shell = this._shell;
      if (!shell) return;

      document.querySelectorAll('#mayaBridgeVersions input[data-maya-version]').forEach((el) => {
        el.addEventListener('change', () => this.selectedVersionsFromDom());
      });

      $('btnMayaBridgeInstall')?.addEventListener('click', () => void this.installMaya(shell));
      $('btnMayaBridgeProbe')?.addEventListener('click', () => void this.probeMaya(shell));
      $('btnMayaBridgeUninstall')?.addEventListener('click', () => void this.uninstallMaya(shell));
      $('btnMayaBridgeOpenDir')?.addEventListener('click', () => void this.openScriptsDir(shell));
      $('btnMayaBridgePickDir')?.addEventListener('click', () => void this.pickScriptsDir(shell));
    },

    async installMaya(shell) {
      if (this._busy) return;
      const versions = this.selectedVersionsFromDom();
      const port = parsePort($('mayaBridgePort'));
      if (!versions.length && !(this._mayaStatus && this._mayaStatus.versions && this._mayaStatus.versions.length)) {
        // Allow install via pick-only path: ask user to pick
        const ok = window.confirm('未勾选版本。是否改为选择一个 Maya scripts 目录进行安装？');
        if (!ok) return;
        await this.pickScriptsDir(shell, { installAfter: true, port });
        return;
      }
      if (!versions.length) {
        window.alert('请至少勾选一个 Maya 版本，或使用「选择 scripts…」。');
        return;
      }
      this._busy = true;
      try {
        const r = await shell.api('POST', '/v1/bridges/maya/install', { versions, port });
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '安装失败');
          return;
        }
        window.alert((r.json && r.json.message) || '安装完成。请重启或打开 Maya，再点「探测连接」。');
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async uninstallMaya(shell) {
      if (this._busy) return;
      if (!window.confirm('确定移除 userSetup 中的 AssetCutter Maya Bridge 标记块？\n（保留 script_hub_bridge.py）')) {
        return;
      }
      const versions = this.selectedVersionsFromDom();
      this._busy = true;
      try {
        const body = versions.length ? { versions } : {};
        const r = await shell.api('POST', '/v1/bridges/maya/uninstall', body);
        if (!r.ok) {
          window.alert((r.json && (r.json.message || r.json.error)) || r.error || '卸载失败');
          return;
        }
        window.alert((r.json && r.json.message) || '已卸载标记块');
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },

    async probeMaya(shell) {
      if (this._busy) return;
      const port = parsePort($('mayaBridgePort'));
      this._busy = true;
      try {
        const probeR = await shell.api(
          'GET',
          '/v1/script-connectors?mayaHost=127.0.0.1&mayaPort=' + encodeURIComponent(String(port)) + '&bustCache=1',
          null,
        );
        this._probe = probeR.ok && probeR.json ? probeR.json : null;
        this.render();
        const ui = this.mayaUiState();
        if (ui.key === 'connected') window.alert('探测成功：Maya Command Port 已连接。');
        else window.alert(ui.detail);
      } finally {
        this._busy = false;
      }
    },

    async openScriptsDir(shell) {
      const versions = Array.isArray(this._mayaStatus && this._mayaStatus.versions)
        ? this._mayaStatus.versions
        : [];
      const selected = this.selectedVersionsFromDom();
      let dir =
        (selected[0] && versions.find((v) => v.id === selected[0]) && versions.find((v) => v.id === selected[0]).scriptsDir) ||
        (versions[0] && versions[0].scriptsDir) ||
        '';
      if (!dir) {
        window.alert('没有可打开的 scripts 目录');
        return;
      }
      if (typeof shell.openFolderPath !== 'function') {
        window.alert('当前壳不支持打开文件夹');
        return;
      }
      const r = await shell.openFolderPath(dir);
      if (r && r.ok === false) window.alert('无法打开：' + (r.error || dir));
    },

    async pickScriptsDir(shell, opts) {
      opts = opts || {};
      if (typeof shell.pickPath !== 'function') {
        window.alert('当前壳不支持选择路径');
        return;
      }
      const r = await shell.pickPath({ pick: 'directory', title: '选择 Maya scripts 目录' });
      if (!r || r.canceled || !r.path) return;
      const port = opts.port != null ? opts.port : parsePort($('mayaBridgePort'));
      if (opts.installAfter === false) {
        // Just remember as selected extra — install immediately for practicality.
      }
      this._busy = true;
      try {
        const ir = await shell.api('POST', '/v1/bridges/maya/install', {
          scriptsDirs: [r.path],
          port,
        });
        if (!ir.ok) {
          window.alert((ir.json && (ir.json.message || ir.json.error)) || ir.error || '安装失败');
          return;
        }
        window.alert((ir.json && ir.json.message) || '安装完成。请重启或打开 Maya，再点「探测连接」。');
        this._selectedVersionIds = null;
        await this.refreshMaya(shell);
        this.render();
      } finally {
        this._busy = false;
      }
    },
  };
})();
