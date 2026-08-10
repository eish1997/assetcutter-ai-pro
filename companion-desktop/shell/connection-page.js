/**
 * Connection page: capability-package first local connections.
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeCapabilityId(value) {
    return String(value || 'software-connection')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'software-connection';
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function compactText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback || '';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function recordOk(record) {
    return Boolean(record && typeof record === 'object' && record.ok === true);
  }

  function recordFailed(record) {
    return Boolean(record && typeof record === 'object' && record.ok === false);
  }

  function actionLabel(action) {
    const labels = {
      agent_loop: 'Copilot',
      conversation: '对话',
      discover_running: '识别运行',
      launch: '启动',
      close: '关闭',
      install: '安装桥接',
      probe: '探测',
      uninstall: '卸载',
      export: '导出',
      publish: '发布',
      version: '版本',
    };
    return labels[String(action || '')] || String(action || '');
  }

  function connectionStateFor(pkg) {
    if (pkg && pkg.connectionState && typeof pkg.connectionState === 'object') return pkg.connectionState;
    const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
    const hostId = compactText(manifest.hostId || manifest.softwareId, '');
    const hasPath = Boolean(compactText(manifest.executablePath || manifest.shortcutPath || manifest.inputPath, ''));
    const text = [pkg && pkg.id, pkg && pkg.name, manifest.appName, manifest.hostId, manifest.templateHint].join(' ').toLowerCase();
    const bridgeSupported = /\bphotoshop\b|extendscript_heartbeat|\bblender\b|blender_http|blender_startup|python_http/.test(text);
    const make = (maturity, label, availableActions, blockedReason, nextAction, publishEligible) => ({
      maturity,
      label,
      availableActions,
      blockedReason: blockedReason || '',
      nextAction,
      publishEligible: publishEligible === true,
    });
    const base = ['agent_loop', 'conversation', 'export'];
    const process = ['discover_running', 'launch', 'close'];
    const bridge = ['install', 'probe', 'uninstall'];
    if (recordOk(pkg && pkg.lastProbe)) {
      return make('connected', '已连接', base.concat(process, bridge), '', '已收到真实软件信号，可继续对话优化或由管理员提交云端版本。', true);
    }
    if (recordFailed(pkg && pkg.lastProbe)) {
      return make('probe_failed', '探测失败', base.concat(process, bridgeSupported ? bridge : []), '未收到真实软件连接信号。', '交给 Copilot 读取失败证据并继续修复。');
    }
    if (recordOk(pkg && pkg.lastInstall)) {
      return make('bridge_installed', '已安装待探测', base.concat(process, bridge), '连接脚本或插件已安装，但还没有真实探测成功。', '打开或重启目标软件，运行连接入口，然后执行真实探测。');
    }
    if (bridgeSupported) {
      return make('bridge_supported', '可安装连接', base.concat(process, bridge), '', '安装连接脚本或插件，然后在软件内加载并探测真实信号。');
    }
    if (hostId) {
      return make('template_missing', '模板待接入', base.concat(process), '当前软件还没有接入真实安装/探测模板。', '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。');
    }
    if (hasPath) {
      return make('path_ready', '已找到位置', base, '已记录软件位置，但尚未确认软件类型和真实连接方式。', '交给 Copilot 识别软件、补齐 hostId 和真实探测方式。');
    }
    return make('draft', '草稿', base, '尚未记录可启动路径、hostId 或真实连接模板。', '通过对话或拖入快捷方式补齐连接目标。');
  }

  function ensureStyles() {
    if (document.getElementById('connection-page-style')) return;
    const style = document.createElement('style');
    style.id = 'connection-page-style';
    style.textContent = `
      .connections-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
        max-width: 980px;
      }
      .connection-card {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .connection-card.is-focused {
        border-color: rgba(59, 130, 246, 0.62);
        background: rgba(37, 99, 235, 0.12);
      }
      .connection-card-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
      }
      .connection-card-title {
        min-width: 0;
        font-size: 14px;
        font-weight: 700;
        color: rgba(244, 244, 245, 0.96);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-status {
        flex: none;
        border: 1px solid rgba(59, 130, 246, 0.36);
        border-radius: 999px;
        color: #bfdbfe;
        background: rgba(59, 130, 246, 0.12);
        padding: 3px 7px;
        font-size: 10px;
        font-weight: 700;
      }
      .connection-card-desc {
        min-height: 34px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .connection-card-submeta {
        display: grid;
        gap: 5px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 7px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.12);
      }
      .connection-card-submeta-row {
        min-width: 0;
        display: flex;
        gap: 6px;
        align-items: baseline;
        color: rgba(212, 212, 216, 0.78);
        font-size: 11px;
        line-height: 1.35;
      }
      .connection-card-submeta-label {
        flex: 0 0 auto;
        color: rgba(161, 161, 170, 0.8);
        font-weight: 700;
      }
      .connection-card-submeta-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .connection-card-tag {
        padding: 3px 7px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(212, 212, 216, 0.84);
        background: rgba(255, 255, 255, 0.04);
        font-size: 10px;
        font-weight: 600;
      }
      .connection-card-availability {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .connection-card-availability-chip {
        padding: 3px 6px;
        border-radius: 6px;
        border: 1px solid rgba(34, 197, 94, 0.22);
        color: rgba(187, 247, 208, 0.9);
        background: rgba(22, 163, 74, 0.08);
        font-size: 10px;
        font-weight: 700;
      }
      .connection-card-result {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 7px;
        padding: 7px 8px;
        color: rgba(244, 244, 245, 0.88);
        background: rgba(255, 255, 255, 0.04);
        font-size: 11px;
        line-height: 1.4;
      }
      .connection-card-result.ok {
        border-color: rgba(34, 197, 94, 0.32);
        background: rgba(22, 163, 74, 0.08);
      }
      .connection-card-result.fail {
        border-color: rgba(239, 68, 68, 0.34);
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
      }
      .connection-card-events {
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.1);
      }
      .connection-card-template-draft {
        display: grid;
        gap: 5px;
        border: 1px solid rgba(250, 204, 21, 0.22);
        border-radius: 7px;
        padding: 8px;
        color: rgba(254, 249, 195, 0.92);
        background: rgba(202, 138, 4, 0.08);
        font-size: 11px;
        line-height: 1.35;
      }
      .connection-card-template-title {
        color: rgba(254, 240, 138, 0.96);
        font-weight: 800;
      }
      .connection-card-template-row {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .connection-card-events summary {
        cursor: pointer;
        padding: 7px 8px;
        color: rgba(212, 212, 216, 0.84);
        font-size: 11px;
        font-weight: 700;
      }
      .connection-card-event-list {
        display: grid;
        gap: 5px;
        padding: 0 8px 8px;
      }
      .connection-card-event {
        min-width: 0;
        display: grid;
        gap: 2px;
        color: rgba(212, 212, 216, 0.78);
        font-size: 11px;
        line-height: 1.35;
      }
      .connection-card-event.fail {
        color: #fecaca;
      }
      .connection-card-event-kind {
        font-weight: 700;
      }
      .connection-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .connection-card-action {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.045);
        color: rgba(244, 244, 245, 0.92);
        padding: 6px 9px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .connection-card-action:hover {
        border-color: rgba(59, 130, 246, 0.48);
        background: rgba(59, 130, 246, 0.11);
      }
      .connection-card-action.primary {
        border-color: rgba(59, 130, 246, 0.42);
        color: #dbeafe;
        background: rgba(37, 99, 235, 0.16);
      }
      .connection-card-action:disabled {
        opacity: 0.5;
        cursor: wait;
      }
      .connection-card-action.danger:hover {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(239, 68, 68, 0.1);
      }
      .connections-error {
        max-width: 720px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 8px;
        padding: 10px 12px;
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
        font-size: 12px;
      }
      .connections-empty-result {
        max-width: 720px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 8px;
        padding: 10px 12px;
        color: rgba(212, 212, 216, 0.82);
        background: rgba(255, 255, 255, 0.035);
        font-size: 12px;
      }
      #view-connections.connection-drop-active {
        outline: 1px solid rgba(59, 130, 246, 0.72);
        outline-offset: -6px;
        background: rgba(59, 130, 246, 0.045);
      }
      #view-connections.connection-drop-active .connections-empty {
        border-color: rgba(96, 165, 250, 0.72);
        background: rgba(37, 99, 235, 0.08);
      }
    `;
    document.head.appendChild(style);
  }

  window.ShellConnectionPage = {
    _shell: null,
    drafts: [],
    packages: [],
    isAdmin: false,
    listError: null,
    searchQuery: '',
    inlineStatus: '',
    busyId: '',
    cardResults: {},
    _reloadGen: 0,
    _dropBound: false,
    _dropDepth: 0,
    focusedConnectionId: '',

    openCreateConnectionCopilot() {
      const prompt = [
        '用户正在“连接”页面通过对话添加一个本机软件连接。',
        '请按 CapabilityPackage 主线创建 software_connection 草稿。',
        '优先调用 ac.capability.draft_create；不要把连接创建成 Workbench 文本资产。',
        '不要要求用户选择技术模板；根据软件名称自动推断连接方式。',
        '不要恢复旧 62 宿主默认列表；旧 host bridge 只能作为 legacy 参考。',
        '创建后应围绕同一个连接对象继续安装、探测、修复和发布。',
      ].join('\n');
      if (typeof window.__acOpenCopilotObjectSession === 'function') {
        void window.__acOpenCopilotObjectSession({
          type: 'capability',
          id: 'connection-draft',
          label: '新建连接',
          contextPrompt: prompt,
        });
        return;
      }
      if (typeof window.__acOpenCopilotPanel === 'function') {
        window.__acOpenCopilotPanel();
      }
    },

    capabilityContext(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      return [
        '当前对话绑定到一个连接能力包对象。',
        '能力包 ID: ' + (pkg.id || ''),
        '名称: ' + (pkg.name || pkg.id || ''),
        '类型: ' + (pkg.type || ''),
        '来源: ' + (pkg.source || ''),
        '草稿状态: ' + (pkg.draftStatus || ''),
        '目标软件: ' + (manifest.appName || pkg.name || ''),
        '连接提示: ' + (manifest.templateHint || ''),
        '生命周期: validate/install/launch/probe/close/uninstall/publish',
        '继续修改时围绕这个 CapabilityPackage 草稿进行，不要恢复旧 62 宿主 catalog。',
      ]
        .filter((line) => String(line || '').trim())
        .join('\n');
    },

    async fetchCapabilityContext(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return null;
      const r = await shell.api('GET', '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/context', null);
      if (!r || !r.ok || !r.json || !r.json.ok) return null;
      return r.json;
    },

    async openCapabilityConversation(pkg) {
      const context = await this.fetchCapabilityContext(pkg);
      const session = context && context.session && typeof context.session === 'object' ? context.session : {};
      const contextPrompt = context && typeof context.contextPrompt === 'string' ? context.contextPrompt : this.capabilityContext(pkg);
      if (typeof window.__acOpenCopilotObjectSession === 'function') {
        void window.__acOpenCopilotObjectSession({
          type: 'capability',
          id: session.id || pkg.id,
          sessionId: session.sessionId || '',
          label: session.label || pkg.name || pkg.id,
          contextPrompt,
        });
        return;
      }
      if (typeof window.__acOpenCopilotPanel === 'function') {
        window.__acOpenCopilotPanel();
      }
    },

    async fetchDrafts(shell) {
      if (!shell || typeof shell.api !== 'function') return [];
      const r = await shell.api('GET', '/v1/capability-packages/drafts', null);
      if (!r || !r.ok) {
        throw new Error((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '读取连接草稿失败');
      }
      const drafts = r.json && Array.isArray(r.json.drafts) ? r.json.drafts : [];
      return drafts.filter((pkg) => pkg && pkg.type === 'software_connection');
    },

    async refreshAdminState(shell) {
      if (!shell || typeof shell.accountStatus !== 'function') {
        this.isAdmin = false;
        return;
      }
      try {
        const status = await shell.accountStatus();
        const user = status && status.user && typeof status.user === 'object' ? status.user : {};
        this.isAdmin = Boolean(status && status.loggedIn && String(user.role || '') === 'admin');
      } catch {
        this.isAdmin = false;
      }
    },

    async fetchCloudPackages(shell) {
      if (!shell || typeof shell.api !== 'function') return { packages: [], versions: [] };
      const r = await shell.api('GET', '/v1/capability-packages/cloud', null);
      if (!r || !r.ok) return { packages: [], versions: [] };
      return {
        packages: r.json && Array.isArray(r.json.packages) ? r.json.packages : [],
        versions: r.json && Array.isArray(r.json.versions) ? r.json.versions : [],
      };
    },

    packageSignature(pkg) {
      if (!pkg || typeof pkg !== 'object') return '';
      return JSON.stringify({
        type: pkg.type,
        name: pkg.name,
        description: pkg.description,
        tags: Array.isArray(pkg.tags) ? pkg.tags : [],
        manifest: pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {},
        lifecycle: pkg.lifecycle && typeof pkg.lifecycle === 'object' ? pkg.lifecycle : {},
        governance: pkg.governance && typeof pkg.governance === 'object' ? pkg.governance : {},
      });
    },

    mergePackages(drafts, cloud) {
      const cloudPackages = Array.isArray(cloud && cloud.packages) ? cloud.packages : [];
      const versions = Array.isArray(cloud && cloud.versions) ? cloud.versions : [];
      const versionsById = new Map();
      for (const version of versions) {
        const id = String(version && version.packageId ? version.packageId : '').trim();
        if (!id) continue;
        if (!versionsById.has(id)) versionsById.set(id, []);
        versionsById.get(id).push(version);
      }
      const cloudById = new Map();
      for (const pkg of cloudPackages) {
        if (pkg && pkg.id && pkg.type === 'software_connection') cloudById.set(String(pkg.id), pkg);
      }
      const out = [];
      const seen = new Set();
      for (const draft of drafts || []) {
        const id = String(draft && draft.id ? draft.id : '').trim();
        if (!id) continue;
        seen.add(id);
        const activeCloudPackage = cloudById.get(id) || null;
        const cloudVersions = versionsById.get(id) || [];
        const merged = {
          ...draft,
          cloudVersions,
          activeCloudPackage,
          hasCloud: Boolean(activeCloudPackage || cloudVersions.length),
          cloudVersion: activeCloudPackage && activeCloudPackage.version,
          hasCloudMismatch: activeCloudPackage
            ? this.packageSignature(draft) !== this.packageSignature(activeCloudPackage)
            : true,
        };
        out.push({ ...merged, connectionState: connectionStateFor(merged) });
      }
      for (const pkg of cloudPackages) {
        const id = String(pkg && pkg.id ? pkg.id : '').trim();
        if (!id || seen.has(id) || pkg.type !== 'software_connection') continue;
        const merged = {
          ...pkg,
          draftStatus: 'cloud',
          cloudVersions: versionsById.get(id) || [],
          activeCloudPackage: pkg,
          hasCloud: true,
          cloudVersion: pkg.version,
          hasCloudMismatch: false,
        };
        out.push({ ...merged, connectionState: connectionStateFor(merged) });
      }
      return out;
    },

    canPublishPackage(pkg) {
      const schema = window.ShellCapabilityCardSchema;
      if (schema && typeof schema.canPublish === 'function') return schema.canPublish(pkg, { isAdmin: this.isAdmin });
      return Boolean(this.isAdmin && pkg && pkg.source === 'draft' && pkg.governance && pkg.governance.cloudVersioned === true);
    },

    latestEvent(pkg) {
      const events = asArray(pkg && pkg.events);
      const lastEvent = events.length ? events[events.length - 1] : null;
      if (lastEvent && typeof lastEvent === 'object') {
        return {
          ok: lastEvent.ok === true,
          kind: compactText(lastEvent.kind, 'event'),
          message: compactText(lastEvent.message, ''),
        };
      }
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      if (lastProbe) {
        const result = lastProbe.result && typeof lastProbe.result === 'object' ? lastProbe.result : {};
        return {
          ok: lastProbe.ok === true,
          kind: 'probe',
          message: compactText(result.message || lastProbe.message, lastProbe.ok ? '已收到真实连接信号' : '未收到真实连接信号'),
        };
      }
      const lastInstall = pkg && pkg.lastInstall && typeof pkg.lastInstall === 'object' ? pkg.lastInstall : null;
      if (lastInstall) {
        const result = lastInstall.result && typeof lastInstall.result === 'object' ? lastInstall.result : {};
        return {
          ok: lastInstall.ok === true,
          kind: 'install',
          message: compactText(result.message || lastInstall.message, lastInstall.ok ? '安装完成，仍需探测' : '安装未完成'),
        };
      }
      return null;
    },

    recentEvents(pkg) {
      const rows = [];
      const push = (kind, ok, message) => {
        rows.push({
          kind: compactText(kind, 'event'),
          ok: ok === true,
          message: compactText(message, ok === true ? '完成' : '未完成'),
        });
      };
      const lastInstall = pkg && pkg.lastInstall && typeof pkg.lastInstall === 'object' ? pkg.lastInstall : null;
      if (lastInstall) {
        const result = lastInstall.result && typeof lastInstall.result === 'object' ? lastInstall.result : {};
        push('install', lastInstall.ok === true, result.message || lastInstall.message);
      }
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      if (lastProbe) {
        const result = lastProbe.result && typeof lastProbe.result === 'object' ? lastProbe.result : {};
        push('probe', lastProbe.ok === true, result.message || lastProbe.message);
      }
      for (const event of asArray(pkg && pkg.events)) {
        if (!event || typeof event !== 'object') continue;
        push(event.kind, event.ok === true, event.message);
      }
      return rows.slice(-5).reverse();
    },

    latestTemplateDraft(pkg) {
      const events = asArray(pkg && pkg.events);
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || typeof event !== 'object' || event.kind !== 'connection_template_draft_created') continue;
        const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
        const templateDraft = detail.templateDraft && typeof detail.templateDraft === 'object' ? detail.templateDraft : null;
        if (templateDraft) return templateDraft;
      }
      return null;
    },

    connectionTargetLabel(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      return compactText(manifest.executablePath || manifest.shortcutPath || manifest.inputPath || manifest.targetDir || '', '未记录启动位置');
    },

    nextActionLabel(pkg, latest) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const hostId = compactText(manifest.hostId || manifest.softwareId, '');
      const lastProbe = pkg && pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      const connectionState = connectionStateFor(pkg);
      if (connectionState && connectionState.nextAction) return connectionState.nextAction;
      if (lastProbe && lastProbe.ok) return '已连接，可继续对话优化这个连接';
      if (latest && latest.ok === false) return '交给 Copilot 读取失败并继续修复';
      if (!hostId) return '补齐连接方式和真实探测信号';
      return '启动、安装或探测，直到收到真实信号';
    },

    matchesSearch(pkg) {
      const q = String(this.searchQuery || '').trim().toLowerCase();
      if (!q) return true;
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const haystack = [
        pkg && pkg.id,
        pkg && pkg.name,
        pkg && pkg.description,
        pkg && pkg.draftStatus,
        pkg && pkg.connectionState && pkg.connectionState.maturity,
        pkg && pkg.connectionState && pkg.connectionState.label,
        pkg && pkg.connectionState && pkg.connectionState.blockedReason,
        pkg && pkg.connectionState && pkg.connectionState.nextAction,
        pkg && pkg.connectionState && Array.isArray(pkg.connectionState.availableActions)
          ? pkg.connectionState.availableActions.join(' ')
          : '',
        manifest.appName,
        manifest.hostId,
        manifest.exeName,
        manifest.executablePath,
        manifest.shortcutPath,
        manifest.inputPath,
        ...asArray(pkg && pkg.tags),
      ]
        .map((item) => String(item || '').toLowerCase())
        .join('\n');
      return haystack.includes(q);
    },

    setCardResult(pkg, kind, message, ok) {
      const id = String(pkg && pkg.id ? pkg.id : '');
      if (!id) return;
      this.cardResults = {
        ...this.cardResults,
        [id]: {
          kind: compactText(kind, ''),
          message: compactText(message, ''),
          ok: ok === true,
        },
      };
    },

    lifecycleMessage(action, body, fallback) {
      const result = body && body.result && typeof body.result === 'object' ? body.result : {};
      return compactText(
        body && (body.message || body.error || result.message || body.nextAction),
        fallback || `${actionLabel(action)}已完成`,
      );
    },

    renderSummary(items, visibleItems) {
      const summary = $('connectionsSummary');
      const status = $('connectionsInlineStatus');
      if (!summary) return;
      const visible = Array.isArray(visibleItems) ? visibleItems.length : items.length;
      const connected = items.filter((pkg) => connectionStateFor(pkg).maturity === 'connected').length;
      const failed = items.filter((pkg) => {
        const latest = this.latestEvent(pkg);
        return latest && latest.ok === false;
      }).length;
      const cloud = items.filter((pkg) => pkg && pkg.hasCloud).length;
      summary.innerHTML =
        '<span class="connections-summary-pill">全部 ' +
        items.length +
        '</span>' +
        '<span class="connections-summary-pill good">已连接 ' +
        connected +
        '</span>' +
        '<span class="connections-summary-pill warn">待处理 ' +
        Math.max(0, items.length - connected) +
        '</span>' +
        '<span class="connections-summary-pill">云端 ' +
        cloud +
        '</span>' +
        (String(this.searchQuery || '').trim()
          ? '<span class="connections-summary-pill">筛选 ' + visible + '</span>'
          : '');
      if (status) {
        status.textContent = this.inlineStatus || (failed ? `${failed} 个连接有最近失败记录，可交给 Copilot 继续处理。` : '');
      }
    },

    renderCard(pkg) {
      const manifest = pkg && pkg.manifest && typeof pkg.manifest === 'object' ? pkg.manifest : {};
      const lastProbe = pkg.lastProbe && typeof pkg.lastProbe === 'object' ? pkg.lastProbe : null;
      const probeOk = Boolean(lastProbe && lastProbe.ok);
      const schema = window.ShellCapabilityCardSchema;
      const view =
        schema && typeof schema.view === 'function'
          ? schema.view(pkg, { isAdmin: this.isAdmin, templateHint: manifest.templateHint })
          : {
              title: pkg.name || pkg.id || '未命名连接',
              description: pkg.description || `${manifest.appName || pkg.name || '本机软件'} 连接草稿`,
              status: probeOk ? '已连接' : pkg.draftStatus || pkg.source || '草稿',
              tags: [pkg.type || 'software_connection'].concat(Array.isArray(pkg.tags) ? pkg.tags : []),
              actions: ['conversation', 'discover_running', 'launch', 'install', 'probe', 'close', 'uninstall', 'export'],
            };
      const tags = Array.isArray(view.tags) ? view.tags : [];
      const actions = Array.isArray(view.actions) ? view.actions : [];
      const hasAction = (name) => actions.includes(name);
      const latest = this.latestEvent(pkg);
      const target = this.connectionTargetLabel(pkg);
      const connectionState = connectionStateFor(pkg);
      const stateLabel = connectionState.label || connectionState.maturity || view.status || '草稿';
      const blockedReason = connectionState.blockedReason || '暂无阻塞';
      const availableActions = Array.isArray(connectionState.availableActions) ? connectionState.availableActions : [];
      const capabilitySummary = availableActions.length
        ? availableActions.map(actionLabel).join(' / ')
        : '等待补齐';
      const next = this.nextActionLabel(pkg, latest);
      const busy = this.busyId === String(pkg.id || '');
      const cardResult = this.cardResults[String(pkg.id || '')] || null;
      const recentEvents = this.recentEvents(pkg);
      const templateDraft = this.latestTemplateDraft(pkg);
      const availabilityHtml = availableActions.length
        ? '<div class="connection-card-availability">' +
          availableActions
            .filter((action) => ['discover_running', 'launch', 'install', 'probe', 'publish', 'agent_loop'].includes(action))
            .map((action) => '<span class="connection-card-availability-chip">' + esc(actionLabel(action)) + '</span>')
            .join('') +
          '</div>'
        : '';
      const resultHtml = cardResult
        ? '<div class="connection-card-result ' +
          (cardResult.ok ? 'ok' : 'fail') +
          '"><strong>' +
          esc(cardResult.kind) +
          '</strong>：' +
          esc(cardResult.message) +
          '</div>'
        : '';
      const eventsHtml =
        '<details class="connection-card-events">' +
        '<summary>最近事件 ' +
        recentEvents.length +
        '</summary>' +
        '<div class="connection-card-event-list">' +
        (recentEvents.length
          ? recentEvents
              .map(
                (event) =>
                  '<div class="connection-card-event ' +
                  (event.ok ? 'ok' : 'fail') +
                  '"><span class="connection-card-event-kind">' +
                  esc(event.kind) +
                  '</span><span>' +
                  esc(event.message) +
                  '</span></div>',
              )
              .join('')
          : '<div class="connection-card-event"><span>还没有运行记录</span></div>') +
        '</div></details>';
      const templateDraftHtml = templateDraft
        ? '<div class="connection-card-template-draft">' +
          '<div class="connection-card-template-title">模板草稿</div>' +
          '<div class="connection-card-template-row">类型：' +
          esc(templateDraft.kind || 'unknown') +
          '</div>' +
          '<div class="connection-card-template-row" title="' +
          esc(templateDraft.probeSignal || '') +
          '">真实信号：' +
          esc(templateDraft.probeSignal || '待补齐') +
          '</div>' +
          '<div class="connection-card-template-row" title="' +
          esc(asArray(templateDraft.requiredUserDirs).join(' / ')) +
          '">需要目录：' +
          esc(asArray(templateDraft.requiredUserDirs).join(' / ') || '待确认') +
          '</div>' +
          '<div class="connection-card-template-row" title="' +
          esc(asArray(templateDraft.safetyBoundaries).join(' / ')) +
          '">安全边界：' +
          esc(asArray(templateDraft.safetyBoundaries).join(' / ') || '未真实验收前不能发布') +
          '</div>' +
          '</div>'
        : '';
      const card = document.createElement('article');
      card.className = 'connection-card' + (this.focusedConnectionId === String(pkg.id || '') ? ' is-focused' : '');
      card.dataset.connectionId = String(pkg.id || '');
      card.innerHTML =
        '<div class="connection-card-head">' +
        '<div class="connection-card-title">' +
        esc(view.title) +
        '</div>' +
        '<span class="connection-card-status">' +
        esc(view.status) +
        '</span>' +
        '</div>' +
        '<div class="connection-card-desc">' +
        esc(view.description) +
        '</div>' +
        '<div class="connection-card-submeta">' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">位置</span><span class="connection-card-submeta-value" title="' +
        esc(target) +
        '">' +
        esc(target) +
        '</span></div>' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">最近</span><span class="connection-card-submeta-value">' +
        esc(latest ? `${latest.kind}${latest.message ? '：' + latest.message : ''}` : '还没有运行记录') +
        '</span></div>' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">状态</span><span class="connection-card-submeta-value">' +
        esc(stateLabel) +
        '</span></div>' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">阻塞</span><span class="connection-card-submeta-value" title="' +
        esc(blockedReason) +
        '">' +
        esc(blockedReason) +
        '</span></div>' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">能力</span><span class="connection-card-submeta-value" title="' +
        esc(capabilitySummary) +
        '">' +
        esc(capabilitySummary) +
        '</span></div>' +
        '<div class="connection-card-submeta-row"><span class="connection-card-submeta-label">下一步</span><span class="connection-card-submeta-value">' +
        esc(next) +
        '</span></div>' +
        '</div>' +
        '<div class="connection-card-meta">' +
        tags.map((tag) => '<span class="connection-card-tag">' + esc(tag) + '</span>').join('') +
        '</div>' +
        availabilityHtml +
        resultHtml +
        templateDraftHtml +
        eventsHtml +
        '<div class="connection-card-actions">' +
        (hasAction('agent_loop') ? '<button type="button" class="connection-card-action primary" data-action="agent_loop">Copilot 处理</button>' : '') +
        (hasAction('conversation') ? '<button type="button" class="connection-card-action" data-action="conversation">对话</button>' : '') +
        (hasAction('discover_running') ? '<button type="button" class="connection-card-action" data-action="discover_running">识别运行中</button>' : '') +
        (hasAction('launch') ? '<button type="button" class="connection-card-action" data-action="launch">启动</button>' : '') +
        (hasAction('install') ? '<button type="button" class="connection-card-action" data-action="install">安装</button>' : '') +
        (hasAction('probe') ? '<button type="button" class="connection-card-action" data-action="probe">探测</button>' : '') +
        (hasAction('close') ? '<button type="button" class="connection-card-action" data-action="close">关闭</button>' : '') +
        (hasAction('uninstall') ? '<button type="button" class="connection-card-action" data-action="uninstall">卸载</button>' : '') +
        (hasAction('export') ? '<button type="button" class="connection-card-action" data-action="export">导出</button>' : '') +
        (hasAction('version') ? '<button type="button" class="connection-card-action" data-action="version">版本</button>' : '') +
        (hasAction('publish') ? '<button type="button" class="connection-card-action" data-action="publish">提交云端</button>' : '') +
        (hasAction('delete') ? '<button type="button" class="connection-card-action danger" data-action="delete">删除草稿</button>' : '') +
        '</div>';
      if (busy) {
        for (const button of card.querySelectorAll('button')) button.disabled = true;
      }
      card.querySelector('[data-action="agent_loop"]')?.addEventListener('click', () => {
        void this.runConnectionAgentLoop(pkg);
      });
      card.querySelector('[data-action="conversation"]')?.addEventListener('click', () => {
        void this.openCapabilityConversation(pkg);
      });
      card.querySelector('[data-action="discover_running"]')?.addEventListener('click', () => {
        void this.runLifecycleAction(pkg, 'discover_running');
      });
      card.querySelector('[data-action="launch"]')?.addEventListener('click', () => {
        void this.runLifecycleAction(pkg, 'launch');
      });
      card.querySelector('[data-action="install"]')?.addEventListener('click', () => {
        void this.installDraft(pkg);
      });
      card.querySelector('[data-action="probe"]')?.addEventListener('click', () => {
        void this.probeDraft(pkg);
      });
      card.querySelector('[data-action="close"]')?.addEventListener('click', () => {
        void this.runLifecycleAction(pkg, 'close');
      });
      card.querySelector('[data-action="uninstall"]')?.addEventListener('click', () => {
        void this.uninstallDraft(pkg);
      });
      card.querySelector('[data-action="export"]')?.addEventListener('click', () => {
        void this.exportCapabilityTransfer(pkg);
      });
      card.querySelector('[data-action="version"]')?.addEventListener('click', () => {
        void this.chooseCloudVersion(pkg);
      });
      card.querySelector('[data-action="publish"]')?.addEventListener('click', () => {
        void this.publishToCloud(pkg);
      });
      card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        void this.deleteDraft(pkg);
      });
      return card;
    },

    render() {
      ensureStyles();
      const empty = $('connectionsEmpty');
      const list = $('connectionsList');
      if (!list || !empty) return;
      list.innerHTML = '';
      const visiblePackages = this.packages.filter((pkg) => this.matchesSearch(pkg));
      this.renderSummary(this.packages, visiblePackages);
      if (this.listError) {
        empty.classList.add('hidden');
        list.className = 'connections-list';
        const error = document.createElement('div');
        error.className = 'connections-error';
        error.textContent = this.listError;
        list.appendChild(error);
        return;
      }
      if (!this.packages.length) {
        empty.classList.remove('hidden');
        list.className = 'hidden';
        return;
      }
      if (!visiblePackages.length) {
        empty.classList.add('hidden');
        list.className = 'connections-list';
        const emptySearch = document.createElement('div');
        emptySearch.className = 'connections-empty-result';
        emptySearch.textContent = '没有匹配的连接，换个关键词试试。';
        list.appendChild(emptySearch);
        return;
      }
      empty.classList.add('hidden');
      list.className = 'connections-list';
      for (const pkg of visiblePackages) {
        list.appendChild(this.renderCard(pkg));
      }
      if (this.focusedConnectionId) {
        const focused = list.querySelector('[data-connection-id="' + cssEscape(this.focusedConnectionId) + '"]');
        if (focused && typeof focused.scrollIntoView === 'function') {
          focused.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    },

    focusConnection(connectionId) {
      this.focusedConnectionId = String(connectionId || '').trim();
      this.render();
      if (!this.focusedConnectionId) return false;
      const card = document.querySelector('[data-connection-id="' + cssEscape(this.focusedConnectionId) + '"]');
      if (!card) {
        this.setInlineStatus('未找到连接草稿：' + this.focusedConnectionId);
        return false;
      }
      this.setInlineStatus('已定位连接：' + this.focusedConnectionId);
      return true;
    },

    async reload(shell) {
      const gen = ++this._reloadGen;
      try {
        const activeShell = shell || this._shell;
        await this.refreshAdminState(activeShell);
        const [drafts, cloud] = await Promise.all([this.fetchDrafts(activeShell), this.fetchCloudPackages(activeShell)]);
        if (gen !== this._reloadGen) return;
        this.drafts = drafts;
        this.packages = this.mergePackages(drafts, cloud);
        this.listError = null;
      } catch (e) {
        if (gen !== this._reloadGen) return;
        this.drafts = [];
        this.packages = [];
        this.listError = e instanceof Error ? e.message : String(e);
      }
      this.render();
    },

    setInlineStatus(message) {
      this.inlineStatus = String(message || '');
      const status = $('connectionsInlineStatus');
      if (status) status.textContent = this.inlineStatus;
    },

    async runConnectionAgentLoop(pkg) {
      const shell = this._shell;
      if (!shell || !pkg || !pkg.id) return;
      this.busyId = String(pkg.id || '');
      this.setInlineStatus(`Copilot 正在接管“${pkg.name || pkg.id}”这个连接对象。`);
      this.render();
      try {
        const context = await this.fetchCapabilityContext(pkg);
        const session = context && context.session && typeof context.session === 'object' ? context.session : {};
        const connectionState = context && context.connectionState && typeof context.connectionState === 'object'
          ? context.connectionState
          : connectionStateFor(pkg);
        const sessionId = String(session.sessionId || (pkg.conversation && pkg.conversation.sessionId) || `capability:software_connection:${pkg.id}`);
        const prompt = [
          `继续处理连接：${pkg.name || pkg.id}`,
          `连接 ID: ${pkg.id}`,
          `当前成熟度: ${connectionState.maturity || 'unknown'} / ${connectionState.label || ''}`,
          `阻塞原因: ${connectionState.blockedReason || 'none'}`,
          `下一步: ${connectionState.nextAction || ''}`,
          '请优先调用 ac.capability.connection_loop_run。',
          '授权权限: context.read, process.discover, process.launch, bridge.install, connection.probe, event.write, conversation.open。',
          '目标：识别当前运行状态，必要时启动或安装，然后探测真实连接信号；失败时把失败证据写回这个连接对象，并给出下一步。',
          '不要使用旧 62 宿主 catalog，不要把文件存在或安装记录当作连接成功，不要 mock probe 成功。',
        ].join('\n');
        if (typeof window.__acOpenCopilotObjectSession === 'function') {
          void window.__acOpenCopilotObjectSession({
            type: 'capability',
            id: session.id || pkg.id,
            sessionId,
            label: session.label || pkg.name || pkg.id,
            contextPrompt: (context && context.contextPrompt) || this.capabilityContext(pkg),
          });
        }
        if (shell.agentSession && typeof shell.agentSession.send === 'function') {
          const sent = await shell.agentSession.send(prompt, sessionId);
          if (!sent || sent.ok === false) {
            this.setInlineStatus('已打开对象对话，但自动发送失败，请在右侧继续对话处理。');
          } else {
            this.setInlineStatus('Copilot 已开始处理连接，完成后会把事件写回这个连接对象。');
          }
        } else {
          this.setInlineStatus('已打开对象对话，请在右侧让 Copilot 继续处理这个连接。');
        }
      } catch (e) {
        this.setInlineStatus('Copilot 处理入口打开失败：' + (e instanceof Error ? e.message : String(e)));
      } finally {
        this.busyId = '';
        await this.reload(shell);
      }
    },

    async deleteDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      const ok = window.confirm(`删除“${pkg.name || pkg.id}”这个本地连接草稿？`);
      if (!ok) return;
      const r = await shell.api('DELETE', '/v1/capability-packages/drafts/' + encodeURIComponent(pkg.id), null);
      if (!r || !r.ok) {
        window.alert('删除失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
    },

    async createConnectionFromDroppedPath(rawPath) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      if (typeof shell.resolveDroppedConnectionPath !== 'function') {
        window.alert('当前版本还不支持拖拽创建连接。');
        return;
      }
      const resolved = await shell.resolveDroppedConnectionPath({ path: rawPath });
      if (!resolved || !resolved.ok) {
        window.alert('无法创建连接：' + ((resolved && (resolved.message || resolved.error)) || '请拖入软件快捷方式或 exe 文件'));
        return;
      }
      const name = String(resolved.name || '').trim() || String(resolved.exeName || '').replace(/\.exe$/i, '') || '本机软件';
      const hostId = String(resolved.hostId || '').trim();
      const id = normalizeCapabilityId(hostId || name);
      const manifest = {
        droppedFrom: 'connection_page',
        inputPath: resolved.inputPath || rawPath,
        shortcutPath: resolved.shortcutPath || '',
        executablePath: resolved.targetPath || '',
        exeName: resolved.exeName || '',
        targetKind: resolved.targetKind || '',
        ...(hostId ? { hostId } : {}),
      };
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/drafts',
        {
          id,
          type: 'software_connection',
          name,
          appName: name,
          description: `从拖入的${resolved.shortcutPath ? '快捷方式' : '可执行文件'}创建的本机软件连接草稿。`,
          tags: ['本机软件', '拖拽创建'],
          templateHint: hostId ? 'shortcut_known_host' : 'shortcut_unknown_host',
          manifest,
          createdBy: 'drag-drop',
        },
        { timeoutMs: 30000 },
      );
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('创建连接失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
      const draft = r.json.draft || { id, name, type: 'software_connection', manifest };
      window.alert('已创建连接草稿：' + (draft.name || name));
      void this.openCapabilityConversation(draft);
    },

    async handleDroppedConnectionFiles(files) {
      const shell = this._shell;
      if (!shell) return;
      const paths =
        typeof shell.droppedFilePaths === 'function'
          ? shell.droppedFilePaths(files)
          : Array.from(files || []).map((file) => file && file.path).filter(Boolean);
      const first = Array.isArray(paths) ? paths.find(Boolean) : '';
      if (!first) {
        window.alert('没有读取到拖入文件路径。');
        return;
      }
      await this.createConnectionFromDroppedPath(first);
    },

    bindDropCreate(shell) {
      if (this._dropBound) return;
      const target = $('view-connections');
      if (!target) return;
      this._dropBound = true;
      const setActive = (active) => {
        target.classList.toggle('connection-drop-active', active);
      };
      target.addEventListener('dragenter', (ev) => {
        this._dropDepth += 1;
        ev.preventDefault();
        setActive(true);
      });
      target.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      });
      target.addEventListener('dragleave', () => {
        this._dropDepth = Math.max(0, this._dropDepth - 1);
        if (this._dropDepth === 0) setActive(false);
      });
      target.addEventListener('drop', (ev) => {
        ev.preventDefault();
        this._dropDepth = 0;
        setActive(false);
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || !files.length) return;
        void this.handleDroppedConnectionFiles(files);
      });
    },

    async runLifecycleAction(pkg, action) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, actionLabel(action), '处理中...', true);
      this.setInlineStatus(`${actionLabel(action)}“${pkg.name || pkg.id}”中...`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/lifecycle',
        { action },
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage(action, body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, actionLabel(action), message || '执行失败', false);
        this.setInlineStatus(`${actionLabel(action)}未完成，可交给 Copilot 继续处理。`);
        this.busyId = '';
        await this.reload(shell);
        void this.openCapabilityConversation(pkg);
        return;
      }
      this.setCardResult(pkg, actionLabel(action), message || '执行完成', true);
      this.setInlineStatus(`${actionLabel(action)}已完成。`);
      this.busyId = '';
      await this.reload(shell);
    },

    async installDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      let targetDir = '';
      if (typeof shell.pickPath === 'function') {
        const picked = await shell.pickPath({ pick: 'folder', title: `选择 ${pkg.name || pkg.id} 脚本目录或安装目录` });
        if (!picked || picked.canceled) return;
        if (!picked.ok || !picked.path) {
          window.alert('没有选择安装位置');
          return;
        }
        targetDir = String(picked.path || '').trim();
      }
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '安装桥接', '安装中...', true);
      this.setInlineStatus(`正在安装“${pkg.name || pkg.id}”的连接脚本。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/install',
        targetDir ? { targetDir } : {},
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('install', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '安装桥接', message || '安装失败', false);
        this.setInlineStatus('安装未完成，可交给 Copilot 读取失败证据继续处理。');
        this.busyId = '';
        await this.reload(shell);
        void this.openCapabilityConversation(pkg);
        return;
      }
      this.setCardResult(pkg, '安装桥接', message || '安装完成，仍需真实探测。', true);
      this.setInlineStatus('安装完成，下一步需要打开目标软件并探测真实信号。');
      this.busyId = '';
      await this.reload(shell);
      void this.openCapabilityConversation(pkg);
    },

    async probeDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '探测', '探测真实连接信号中...', true);
      this.setInlineStatus(`正在探测“${pkg.name || pkg.id}”的真实连接信号。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/probe',
        {},
        { timeoutMs: 30000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('probe', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '探测', message || '未收到真实连接信号', false);
        this.setInlineStatus('探测未收到真实信号，可交给 Copilot 继续修复。');
        this.busyId = '';
        await this.reload(shell);
        return;
      }
      this.setCardResult(pkg, '探测', message || '已收到真实连接信号', true);
      this.setInlineStatus('探测成功，连接已收到真实信号。');
      this.busyId = '';
      await this.reload(shell);
    },

    async uninstallDraft(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      const ok = window.confirm(`卸载“${pkg.name || pkg.id}”已记录的连接脚本？`);
      if (!ok) return;
      this.busyId = String(pkg.id || '');
      this.setCardResult(pkg, '卸载', '卸载中...', true);
      this.setInlineStatus(`正在卸载“${pkg.name || pkg.id}”的连接脚本。`);
      this.render();
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/uninstall',
        {},
        { timeoutMs: 60000 },
      );
      const body = (r && r.json) || {};
      const message = this.lifecycleMessage('uninstall', body, r && r.text);
      if (!r || !r.ok) {
        this.setCardResult(pkg, '卸载', message || '卸载失败', false);
        this.setInlineStatus('卸载未完成，可继续对话处理。');
        this.busyId = '';
        await this.reload(shell);
        return;
      }
      this.setCardResult(pkg, '卸载', message || '卸载完成', true);
      this.setInlineStatus('卸载完成。');
      this.busyId = '';
      await this.reload(shell);
    },

    async exportCapabilityTransfer(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (typeof shell.saveTextFile !== 'function') {
        window.alert('当前壳版本缺少保存文件能力，请重启或更新本地伴侣。');
        return;
      }
      const r = await shell.api('GET', '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/export', null, {
        timeoutMs: 30000,
      });
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('导出失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      const saved = await shell.saveTextFile({
        title: '导出连接能力包',
        defaultPath: normalizeCapabilityId(pkg.id || pkg.name) + '.assetcutter-capability.json',
        text: JSON.stringify(r.json.bundle, null, 2),
      });
      if (!saved || saved.canceled) return;
      if (!saved.ok) {
        window.alert('保存失败：' + (saved.error || '未知错误'));
        return;
      }
      window.alert('已导出：' + saved.path);
    },

    async importCapabilityTransfer() {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function') return;
      if (typeof shell.pickPath !== 'function' || typeof shell.readTextFile !== 'function') {
        window.alert('当前壳版本缺少导入能力，请重启或更新本地伴侣。');
        return;
      }
      const picked = await shell.pickPath({ pick: 'file', title: '选择能力包 JSON' });
      const filePath = picked && picked.ok && picked.path ? picked.path : '';
      if (!filePath || picked.canceled) return;
      const read = await shell.readTextFile({ path: filePath });
      if (!read || !read.ok) {
        window.alert('读取失败：' + ((read && read.error) || '未知错误'));
        return;
      }
      let bundle = null;
      try {
        bundle = JSON.parse(String(read.text || ''));
      } catch {
        window.alert('导入失败：不是有效的 JSON 文件。');
        return;
      }
      const r = await shell.api('POST', '/v1/capability-packages/import', { bundle }, { timeoutMs: 30000 });
      if (!r || !r.ok || !r.json || !r.json.ok) {
        window.alert('导入失败：' + ((r && r.json && (r.json.message || r.json.error)) || (r && r.text) || '未知错误'));
        return;
      }
      await this.reload(shell);
      const draft = r.json.draft || {};
      window.alert('已导入连接草稿：' + (draft.name || draft.id || '能力包'));
      if (draft && draft.id) void this.openCapabilityConversation(draft);
    },

    async publishToCloud(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (!this.isAdmin) {
        window.alert('当前账号不是管理员。');
        return;
      }
      const note = window.prompt('填写本次云端版本说明', '');
      if (note == null) return;
      if (!String(note).trim()) {
        window.alert('版本说明不能为空。');
        return;
      }
      const semver = window.prompt('填写版本号', pkg.version || pkg.cloudVersion || '1.0.0');
      if (semver == null) return;
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions',
        {
          semver: String(semver || '').trim(),
          versionNote: String(note || '').trim(),
          isAdmin: true,
          actorRole: 'admin',
        },
        { timeoutMs: 60000 },
      );
      if (!r || !r.ok) {
        const body = (r && r.json) || {};
        const missing = Array.isArray(body.missingGates) ? body.missingGates.join(', ') : '';
        window.alert('提交失败：' + (body.message || body.error || (r && r.text) || missing || '未知错误'));
        return;
      }
      const version = r.json && r.json.version;
      window.alert('已提交云端' + (version && version.semver ? '：v' + version.semver : '。'));
      await this.reload(shell);
    },

    async chooseCloudVersion(pkg) {
      const shell = this._shell;
      if (!shell || typeof shell.api !== 'function' || !pkg || !pkg.id) return;
      if (!this.isAdmin) {
        window.alert('当前账号不是管理员。');
        return;
      }
      const versions = Array.isArray(pkg.cloudVersions) ? pkg.cloudVersions : [];
      if (!versions.length) {
        window.alert('还没有云端版本。');
        return;
      }
      const picker = window.ShellCapabilityVersionPicker;
      const version =
        picker && typeof picker.pick === 'function'
          ? await picker.pick(pkg, versions, { title: '选择云端版本 - ' + (pkg.name || pkg.id || '') })
          : versions[0];
      if (!version || !version.id) {
        window.alert('没有选择有效版本。');
        return;
      }
      const r = await shell.api(
        'POST',
        '/v1/capability-packages/' + encodeURIComponent(pkg.id) + '/cloud-versions/' + encodeURIComponent(version.id) + '/activate',
        { isAdmin: true, actorRole: 'admin' },
        { timeoutMs: 30000 },
      );
      if (!r || !r.ok) {
        const body = (r && r.json) || {};
        window.alert('切换失败：' + (body.message || body.error || (r && r.text) || '未知错误'));
        return;
      }
      window.alert('已切换到云端版本 v' + (version.semver || ''));
      await this.reload(shell);
    },

    bind(shell) {
      this._shell = shell;
      this.bindDropCreate(shell);
      $('btnConnectionCreateWithCopilot')?.addEventListener('click', () => {
        this.openCreateConnectionCopilot();
      });
      $('btnConnectionImportTransfer')?.addEventListener('click', () => {
        void this.importCapabilityTransfer();
      });
      $('connectionsSearch')?.addEventListener('input', (ev) => {
        this.searchQuery = String((ev && ev.target && ev.target.value) || '');
        this.render();
      });
      window.addEventListener('assetcutter:capability-created', (ev) => {
        const detail = ev && ev.detail && typeof ev.detail === 'object' ? ev.detail : {};
        if (detail.type !== 'software_connection') return;
        void this.reload(this._shell || shell);
      });
    },

    async onViewShown(shell) {
      this._shell = shell;
      await this.reload(shell);
    },
  };
})();

