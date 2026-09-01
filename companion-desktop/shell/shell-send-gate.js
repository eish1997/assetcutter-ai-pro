(function () {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function compactText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || (fallback == null ? '' : String(fallback));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function fingerHasCargo(finger) {
    if (!finger || typeof finger !== 'object') return false;
    return Boolean(
      compactText(finger.selectedRelPath, '') ||
        compactText(finger.selectedAssetId, '') ||
        compactText(finger.selectedDisplayKey, ''),
    );
  }

  function listReadyTargets(finger) {
    const hosts = asArray(finger && finger.connectedHosts);
    return hosts
      .filter((h) => h && h.ready && compactText(h.id, ''))
      .map((h) => ({
        id: compactText(h.id, ''),
        title: compactText(h.sendTitle, compactText(h.title, compactText(h.id, '目标地点'))),
        localVersionId: compactText(h.localVersionId, ''),
      }));
  }

  function sendGateUiState(finger, targets) {
    if (!fingerHasCargo(finger)) return 'hidden';
    if (!targets.length) return 'idle_no_routes';
    if (targets.length === 1) return 'ready_one';
    return 'ready_many';
  }

  function ensureSendGateStyles() {
    const styleId = 'shell-send-gate-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #shellSendGate {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 0;
        max-width: min(420px, 46vw);
        pointer-events: none;
        -webkit-app-region: no-drag;
      }
      #shellSendGate.is-hidden { display: none; }
      #shellSendGate .shell-send-gate-btn,
      #shellSendGate .shell-send-gate-menu > summary {
        pointer-events: auto;
        -webkit-app-region: no-drag;
        height: 22px;
        padding: 0 10px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(244, 244, 245, 0.94);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        list-style: none;
      }
      #shellSendGate .shell-send-gate-btn:hover:not(:disabled),
      #shellSendGate .shell-send-gate-menu > summary:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(148, 163, 184, 0.32);
      }
      #shellSendGate .shell-send-gate-btn:disabled {
        opacity: 0.45;
        cursor: default;
      }
      #shellSendGate .shell-send-gate-menu > summary::-webkit-details-marker { display: none; }
      #shellSendGate .shell-send-gate-menu-panel {
        position: absolute;
        top: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        min-width: 160px;
        padding: 4px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: #0f0f12;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        z-index: 200;
      }
      #shellSendGate .shell-send-gate-menu {
        position: relative;
        pointer-events: auto;
      }
      #shellSendGate .shell-send-gate-menu-panel button {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        background: transparent;
        color: rgba(244, 244, 245, 0.92);
        font-size: 11px;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
      }
      #shellSendGate .shell-send-gate-menu-panel button:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      #shellSendGate .shell-send-gate-status {
        pointer-events: none;
        font-size: 10px;
        color: rgba(161, 161, 170, 0.92);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 180px;
      }
      #shellSendGate .shell-send-gate-status.is-error { color: rgba(252, 165, 165, 0.95); }
      #shellSendGate .shell-send-gate-status.is-ok { color: rgba(134, 239, 172, 0.95); }
    `;
    document.head.appendChild(style);
  }

  window.ShellSendGate = {
    _shell: null,
    _finger: null,
    _sending: false,
    _status: '',
    _statusTone: '',
    _statusTimer: 0,
    _pollTimer: 0,

    setStatus(message, tone) {
      this._status = String(message || '').trim();
      this._statusTone = tone === 'error' || tone === 'ok' ? tone : '';
      if (this._statusTimer) window.clearTimeout(this._statusTimer);
      if (this._status) {
        this._statusTimer = window.setTimeout(() => {
          this._status = '';
          this._statusTone = '';
          this.render();
        }, 2400);
      }
      this.render();
    },

    async refreshFinger() {
      const shell = this._shell;
      if (!shell || typeof shell.getWorkspaceFinger !== 'function') {
        this._finger = null;
        this.render();
        return;
      }
      try {
        const r = await shell.getWorkspaceFinger();
        this._finger = r && r.ok && r.finger && typeof r.finger === 'object' ? r.finger : null;
      } catch {
        this._finger = null;
      }
      this.render();
    },

    async navigateToMap() {
      const shell = this._shell;
      if (shell && typeof shell.setShellView === 'function') {
        try {
          await shell.setShellView('connections');
        } catch {
          /* ignore */
        }
      }
    },

    async sendToHost(hostId, localVersionId) {
      const shell = this._shell;
      if (!shell || typeof shell.sendToCurrentHost !== 'function') {
        this.setStatus('当前版本还不支持发送。', 'error');
        return;
      }
      if (this._sending) return;
      this._sending = true;
      this.render();
      try {
        const payload = {};
        const hid = String(hostId || '').trim();
        const vid = String(localVersionId || '').trim();
        if (hid) payload.hostId = hid;
        if (vid) payload.localVersionId = vid;
        const r = await shell.sendToCurrentHost(payload);
        if (!r || r.ok === false) {
          const hint =
            r && r.suggestSurface === 'connections'
              ? '路线未通，请先去地图添加地点。'
              : (r && r.error) || '发送失败';
          this.setStatus(hint, 'error');
          if (r && r.suggestSurface === 'connections') void this.navigateToMap();
          return;
        }
        this.setStatus('已发送。', 'ok');
      } catch (e) {
        this.setStatus(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        this._sending = false;
        this.render();
      }
    },

    render() {
      ensureSendGateStyles();
      const root = document.getElementById('shellSendGate');
      if (!root) return;
      const finger = this._finger && typeof this._finger === 'object' ? this._finger : {};
      const targets = listReadyTargets(finger);
      const state = sendGateUiState(finger, targets);
      root.classList.toggle('is-hidden', state === 'hidden');
      if (state === 'hidden') {
        root.innerHTML = '';
        return;
      }

      let controlHtml = '';
      if (state === 'idle_no_routes') {
        controlHtml =
          '<button type="button" class="shell-send-gate-btn" data-send-gate-action="map" title="先去地图添加地点">发送到</button>';
      } else if (state === 'ready_one') {
        const host = targets[0];
        controlHtml =
          '<button type="button" class="shell-send-gate-btn" data-send-gate-action="send" data-host-id="' +
          esc(host.id) +
          '"' +
          (host.localVersionId ? ' data-local-version-id="' + esc(host.localVersionId) + '"' : '') +
          (this._sending ? ' disabled' : '') +
          '>发送到 ' +
          esc(host.title) +
          '</button>';
      } else {
        controlHtml =
          '<details class="shell-send-gate-menu">' +
          '<summary class="shell-send-gate-btn"' +
          (this._sending ? ' aria-disabled="true"' : '') +
          '>发送到 ▾</summary>' +
          '<div class="shell-send-gate-menu-panel">' +
          targets
            .map(
              (host) =>
                '<button type="button" data-send-gate-action="send" data-host-id="' +
                esc(host.id) +
                '"' +
                (host.localVersionId ? ' data-local-version-id="' + esc(host.localVersionId) + '"' : '') +
                '">' +
                esc(host.title) +
                '</button>',
            )
            .join('') +
          '</div></details>';
      }

      const statusHtml = this._status
        ? '<span class="shell-send-gate-status' +
          (this._statusTone === 'error' ? ' is-error' : this._statusTone === 'ok' ? ' is-ok' : '') +
          '">' +
          esc(this._status) +
          '</span>'
        : '';

      root.innerHTML = controlHtml + statusHtml;

      root.querySelector('[data-send-gate-action="map"]')?.addEventListener('click', () => {
        void this.navigateToMap();
      });
      for (const button of root.querySelectorAll('[data-send-gate-action="send"]')) {
        button.addEventListener('click', () => {
          const hostId = String(button.getAttribute('data-host-id') || '').trim();
          const localVersionId = String(button.getAttribute('data-local-version-id') || '').trim();
          const menu = root.querySelector('.shell-send-gate-menu');
          if (menu) menu.removeAttribute('open');
          void this.sendToHost(hostId, localVersionId);
        });
      }
    },

    bind(shell) {
      this._shell = shell;
      void this.refreshFinger();
      if (this._pollTimer) window.clearInterval(this._pollTimer);
      this._pollTimer = window.setInterval(() => {
        void this.refreshFinger();
      }, 2000);
      if (shell && typeof shell.onWorkspaceFingerChanged === 'function') {
        shell.onWorkspaceFingerChanged((finger) => {
          this._finger = finger && typeof finger === 'object' ? finger : null;
          this.render();
        });
      }
    },
  };
})();
